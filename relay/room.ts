/**
 * A room (phase 4, M30): orders the players' commands, keeps the city between sessions and catches
 * players up. The same class runs in the local relay (Node), in a Cloudflare Durable Object and in a
 * host's browser for peer-to-peer; each gives it connections and a store. It runs no timers: time
 * moves when the pacer's game sends `clock`, so an online room can sleep between messages.
 *
 * The city itself is opaque here: snapshots arrive as compressed parts from a player's game and are
 * kept and passed on as they are. Commands are checked for shape only; the sim decides what they mean.
 */
import type { Stamped } from '../src/sim/lockstep';
import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  parseClientMsg,
  type ClientMsg,
  type PlayerInfo,
  type RoomInfo,
  type RoomMsg,
  type SnapshotMeta,
  type Speed,
} from './protocol';

export interface Conn {
  send(msg: RoomMsg): void;
  close(code: number, reason: string): void;
}

export interface StoredSnapshot {
  meta: SnapshotMeta;
  parts: string[];
}

/** What a room keeps between sessions. Synchronous, as a Durable Object's SQLite is. */
export interface RoomStore {
  loadMeta(): RoomMeta | null;
  saveMeta(meta: RoomMeta): void;
  /** Events since the stored snapshot, in order. */
  loadEvents(): Stamped[];
  appendEvent(e: Stamped): void;
  /** Store a snapshot and drop the events it already holds (seq ≤ its seq). */
  saveSnapshot(s: StoredSnapshot): void;
  loadSnapshot(): StoredSnapshot | null;
}

export interface RoomMeta {
  info: RoomInfo;
  players: { id: number; name: string; color: number; host: boolean; secret: string; tick: number }[];
  nextPlayer: number;
  seq: number;
  allowed: number;
  kicked: number[];
  /** The stored snapshot's sequence number, or null before the first. */
  snapshotSeq: number | null;
}

export interface RoomEnv {
  /** Milliseconds, for rate limits and how often to save (never for the city's time). */
  now(): number;
  random(): number;
}

interface Player {
  id: number;
  name: string;
  color: number;
  host: boolean;
  secret: string;
  tick: number;
  visible: boolean;
  joining: boolean;
  conn: Conn | null;
}

interface ConnState {
  player: number;
  tokens: number;
  chatTokens: number;
  last: number;
}

/** How far the pacer may move time in one message (30 game minutes). */
export const MAX_CLOCK_STEP = 30 * 60;
/** A joining player is in step once within this many ticks of the frontier (the city keeps moving). */
const CAUGHT_UP = 120;
/** Checksums kept for comparing (game hours). */
const KEEP_SUMS = 48;
/** Messages per second a player may send, and a burst. */
const RATE = 30;
const BURST = 90;
/** Save the room's clock at most this often while it runs (ms); always on pause and when all leave. */
const META_EVERY = 15_000;
/** Take a snapshot this often while the city runs (ms), so a returning player catches up quickly. */
export const SNAPSHOT_EVERY = 10 * 60_000;

export class Room {
  info: RoomInfo;
  private players = new Map<number, Player>();
  private conns = new Map<Conn, ConnState>();
  private nextPlayer = 1;
  private seq = -1;
  allowed = 0;
  private events: Stamped[] = [];
  private kicked = new Set<number>();
  /** Snapshot parts arriving, by snapshot id. */
  private incoming = new Map<string, { meta: SnapshotMeta; parts: (string | null)[]; from: number }>();
  /** Players waiting for the next snapshot, and why. */
  private waiting = new Map<number, 'join' | 'resync'>();
  /** A settle asked of the pacer and not yet answered. */
  private settleAsked: { seq: number; taker: number } | null = null;
  /** Hourly checksums by tick: player → sum. */
  private sums = new Map<number, Map<number, string>>();
  private metaSaved = 0;
  private snapshotSeq: number | null = null;
  private lastSnapshot = 0;
  /** Messages this room has received, for the free-plan accounting in tests. */
  received = 0;

  constructor(
    code: string,
    kind: RoomInfo['kind'],
    private readonly store: RoomStore,
    private readonly env: RoomEnv,
  ) {
    this.info = { code, kind, locked: false, chat: true, speed: 1, pacer: 0, cityName: '' };
    const meta = store.loadMeta();
    if (meta) this.restore(meta);
  }

  /** Does the room hold a city yet? */
  get exists(): boolean {
    return this.players.size > 0;
  }

  get online(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.conn) n++;
    return n;
  }

  private restore(meta: RoomMeta): void {
    this.info = { ...meta.info, pacer: 0 };
    for (const p of meta.players)
      this.players.set(p.id, { ...p, visible: false, joining: false, conn: null });
    this.nextPlayer = meta.nextPlayer;
    this.seq = meta.seq;
    this.allowed = meta.allowed;
    this.kicked = new Set(meta.kicked);
    this.snapshotSeq = meta.snapshotSeq;
    this.events = this.store.loadEvents();
    for (const e of this.events) if (e.seq > this.seq) this.seq = e.seq;
  }

  /**
   * After a Durable Object wakes from hibernation: put a socket back with the player it carried.
   * Its game is in step (it was before the room slept).
   */
  reattach(conn: Conn, player: number): void {
    const p = this.players.get(player);
    if (!p) return conn.close(4000, 'gone');
    p.conn = conn;
    p.visible = true;
    this.conns.set(conn, { player, tokens: BURST, chatTokens: 3, last: this.env.now() });
    this.choosePacer();
  }

  private saveMeta(): void {
    this.metaSaved = this.env.now();
    this.store.saveMeta({
      info: this.info,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        host: p.host,
        secret: p.secret,
        tick: p.tick,
      })),
      nextPlayer: this.nextPlayer,
      seq: this.seq,
      allowed: this.allowed,
      kicked: [...this.kicked],
      snapshotSeq: this.snapshotSeq,
    });
  }

  // ---------------------------------------------------------------- connections

  open(conn: Conn): void {
    this.conns.set(conn, { player: 0, tokens: BURST, chatTokens: 3, last: this.env.now() });
  }

  closed(conn: Conn): void {
    const st = this.conns.get(conn);
    this.conns.delete(conn);
    if (!st?.player) return;
    const p = this.players.get(st.player);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    this.waiting.delete(p.id);
    this.choosePacer();
    this.broadcastPlayers();
    this.broadcastRoom();
    if (!this.online) this.saveMeta();
  }

  message(conn: Conn, raw: string): void {
    this.received++;
    const st = this.conns.get(conn);
    if (!st) return;
    // A token bucket per connection: a burst is fine, a flood is dropped, a torrent closes it.
    const now = this.env.now();
    st.tokens = Math.min(BURST, st.tokens + ((now - st.last) / 1000) * RATE);
    st.chatTokens = Math.min(3, st.chatTokens + (now - st.last) / 1000);
    st.last = now;
    st.tokens--;
    if (st.tokens < -BURST) return this.reject(conn, 'rate', 'Too many messages');
    if (st.tokens < 0) return;
    const msg = parseClientMsg(raw);
    if (!msg) return this.reject(conn, 'bad-message', 'A message the room could not read');
    if (msg.t === 'hello') return this.hello(conn, msg);
    const p = st.player ? this.players.get(st.player) : null;
    if (!p) return this.reject(conn, 'bad-message', 'Say hello first');
    this.handle(p, st, msg);
  }

  private reject(conn: Conn, code: Extract<RoomMsg, { t: 'error' }>['code'], text: string): void {
    conn.send({ t: 'error', code, text });
    conn.close(4000, code);
    this.closed(conn);
  }

  private hello(conn: Conn, m: Extract<ClientMsg, { t: 'hello' }>): void {
    if (m.v !== PROTOCOL_VERSION)
      return this.reject(
        conn,
        'version',
        'This room runs a different version of Citybloom: reload to update',
      );
    const st = this.conns.get(conn)!;
    if (st.player) return;
    if (m.create) {
      if (this.exists) return this.reject(conn, 'exists', 'That room code is taken');
      const p = this.addPlayer(conn, m.name, m.color, true);
      this.info.cityName = m.create.cityName;
      this.info.pacer = p.id;
      p.joining = true;
      conn.send(this.welcome(p, 'upload'));
      this.saveMeta();
      return;
    }
    if (!this.exists) return this.reject(conn, 'no-room', 'No room with that code');
    if (m.rejoin) {
      const p = this.players.get(m.rejoin.id);
      if (p && p.secret === m.rejoin.secret && !this.kicked.has(p.id)) {
        // The same player on a new connection: the old one is stale.
        if (p.conn && p.conn !== conn) {
          const old = p.conn;
          this.conns.delete(old);
          old.close(4001, 'replaced');
        }
        p.conn = conn;
        p.name = m.name;
        p.color = m.color;
        st.player = p.id;
        const first = this.events[0]?.seq ?? this.seq + 1;
        if (m.rejoin.seq >= first - 1 && !this.waiting.has(p.id)) {
          p.joining = false;
          conn.send(this.welcome(p, 'events'));
          conn.send({ t: 'ev', list: this.events.filter((e) => e.seq > m.rejoin!.seq), allow: this.allowed });
        } else {
          p.joining = true;
          conn.send(this.welcome(p, 'snapshot'));
          this.serveSnapshot(p, 'join');
        }
        this.choosePacer();
        this.broadcastPlayers();
        this.broadcastRoom();
        return;
      }
      if (p && this.kicked.has(p.id))
        return this.reject(conn, 'kicked', 'The host removed you from this room');
    }
    if (this.info.locked) return this.reject(conn, 'locked', 'The host has locked this room');
    if (this.online >= MAX_PLAYERS)
      return this.reject(conn, 'full', `This room is full (${MAX_PLAYERS} players)`);
    const p = this.addPlayer(conn, m.name, m.color, false);
    p.joining = true;
    conn.send(this.welcome(p, 'snapshot'));
    this.broadcast({ t: 'notice', text: `${p.name} is joining` }, p.id);
    this.serveSnapshot(p, 'join');
    this.broadcastPlayers();
    this.saveMeta();
  }

  private addPlayer(conn: Conn, name: string, color: number, host: boolean): Player {
    const secret = Array.from({ length: 4 }, () => Math.floor(this.env.random() * 2 ** 32).toString(36)).join(
      '',
    );
    const p: Player = {
      id: this.nextPlayer++,
      name,
      color,
      host,
      secret,
      tick: this.allowed,
      visible: true,
      joining: false,
      conn,
    };
    this.players.set(p.id, p);
    this.conns.get(conn)!.player = p.id;
    return p;
  }

  private welcome(p: Player, join: 'upload' | 'snapshot' | 'events'): RoomMsg {
    return { t: 'welcome', you: p.id, secret: p.secret, room: this.info, players: this.playerList(), join };
  }

  // ---------------------------------------------------------------- messages

  private handle(p: Player, st: ConnState, m: ClientMsg): void {
    switch (m.t) {
      case 'cmd': {
        if (m.cmd.type === 'cheat') {
          p.conn?.send({ t: 'refused', ref: m.ref, reason: 'Cheats are off in a shared city' });
          return;
        }
        this.order({ kind: 'cmd', cmd: m.cmd as never, by: p.id, ref: m.ref });
        return;
      }
      case 'clock': {
        if (p.id !== this.info.pacer) return;
        if (m.allow <= this.allowed || m.allow > this.allowed + MAX_CLOCK_STEP) return;
        this.allowed = m.allow;
        this.broadcastEvents([]);
        const now = this.env.now();
        if (now - this.metaSaved > META_EVERY) this.saveMeta();
        if (now - this.lastSnapshot > SNAPSHOT_EVERY && this.events.length) this.askSettle('snapshot');
        return;
      }
      case 'status': {
        const moved = p.tick !== m.tick;
        p.tick = m.tick;
        if (moved) this.broadcast({ t: 'ticks', ticks: [[p.id, p.tick]] }, p.id);
        if (p.joining && !this.waiting.has(p.id) && m.tick >= this.allowed - CAUGHT_UP) {
          p.joining = false;
          this.broadcastPlayers();
        }
        if (p.visible !== m.visible) {
          p.visible = m.visible;
          this.choosePacer();
          this.broadcastPlayers();
        }
        if (m.sums) for (const [tick, sum] of m.sums) this.checkSum(p, tick, sum);
        return;
      }
      case 'snap':
        this.snapPart(p, m);
        return;
      case 'speed':
        this.setSpeed(m.speed);
        return;
      case 'chat':
        if (!this.info.chat || st.chatTokens < 1) return;
        st.chatTokens--;
        this.broadcast({ t: 'chat', from: p.id, text: m.text });
        return;
      case 'admin':
        if (!p.host) return;
        this.admin(m.action, m.player);
        return;
      case 'bye':
        if (p.conn) {
          const c = p.conn;
          c.close(1000, 'bye');
          this.closed(c);
        }
        return;
    }
  }

  setSpeed(speed: Speed): void {
    if (this.info.speed === speed) return;
    this.info.speed = speed;
    this.broadcastRoom();
    if (speed === 0) this.saveMeta();
  }

  private admin(action: 'lock' | 'unlock' | 'chatOff' | 'chatOn' | 'kick', player?: number): void {
    if (action === 'lock' || action === 'unlock') this.info.locked = action === 'lock';
    else if (action === 'chatOff' || action === 'chatOn') this.info.chat = action === 'chatOn';
    else if (action === 'kick' && player) {
      const target = this.players.get(player);
      if (!target || target.host) return;
      this.kicked.add(player);
      if (target.conn) {
        target.conn.send({ t: 'error', code: 'kicked', text: 'The host removed you from this room' });
        const c = target.conn;
        c.close(4000, 'kicked');
        this.closed(c);
      }
      this.players.delete(player);
      this.broadcast({ t: 'notice', text: `${target.name} was removed by the host` });
      this.broadcastPlayers();
    }
    this.broadcastRoom();
    this.saveMeta();
  }

  /** Stamp an event at the frontier and send it to everyone in step. */
  private order(ev: Stamped['ev']): Stamped {
    const e: Stamped = { tick: this.allowed, seq: ++this.seq, ev };
    this.events.push(e);
    this.store.appendEvent(e);
    this.broadcastEvents([e]);
    return e;
  }

  private broadcastEvents(list: Stamped[]): void {
    const msg: RoomMsg = { t: 'ev', list, allow: this.allowed };
    for (const p of this.players.values()) if (p.conn && !this.waiting.has(p.id)) p.conn.send(msg);
  }

  private broadcast(msg: RoomMsg, except = 0): void {
    for (const p of this.players.values()) if (p.conn && p.id !== except) p.conn.send(msg);
  }

  private playerList(): PlayerInfo[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      online: !!p.conn,
      host: p.host,
      tick: p.tick,
      visible: p.visible,
      joining: p.joining,
    }));
  }

  private broadcastPlayers(): void {
    this.broadcast({ t: 'players', list: this.playerList() });
  }

  private broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.info });
  }

  /**
   * The pacer: the host while their game is in front, else the first player whose game is, else
   * anyone online and in step. Background tabs are slowed by the browser, so they don't keep time.
   */
  private choosePacer(): void {
    const ready = [...this.players.values()].filter((p) => p.conn && !p.joining).sort((a, b) => a.id - b.id);
    const pick =
      ready.find((p) => p.host && p.visible) ??
      ready.find((p) => p.visible) ??
      ready.find((p) => p.host) ??
      ready[0];
    const id = pick?.id ?? 0;
    if (id !== this.info.pacer) {
      this.info.pacer = id;
      this.broadcastRoom();
    }
  }

  // ---------------------------------------------------------------- snapshots

  /** Ask the pacer's game to settle and save the city at the frontier. */
  private askSettle(reason: 'snapshot' | 'autosave'): boolean {
    const taker = this.info.pacer;
    if (!taker) return false;
    if (this.settleAsked && this.settleAsked.taker === taker) return true;
    const e = this.order({ kind: 'settle', taker, reason });
    this.settleAsked = { seq: e.seq, taker };
    this.lastSnapshot = this.env.now();
    return true;
  }

  /** Get a player the city: a fresh snapshot from the pacer if anyone's playing, else the stored one. */
  private serveSnapshot(p: Player, reason: 'join' | 'resync'): void {
    this.waiting.set(p.id, reason);
    if (this.info.pacer && this.info.pacer !== p.id && this.askSettle('snapshot')) return;
    const stored = this.snapshotSeq === null ? null : this.store.loadSnapshot();
    if (!stored) return this.reject(p.conn!, 'gone', 'This room has no city yet: ask the host to open it');
    this.sendSnapshot(p, stored, reason);
  }

  private sendSnapshot(p: Player, s: StoredSnapshot, reason: 'join' | 'resync'): void {
    this.waiting.delete(p.id);
    if (!p.conn) return;
    s.parts.forEach((data, part) => p.conn!.send({ t: 'snap', meta: s.meta, part, data, reason }));
    p.conn.send({ t: 'ev', list: this.events.filter((e) => e.seq > s.meta.seq), allow: this.allowed });
    p.joining = true;
  }

  private snapPart(p: Player, m: Extract<ClientMsg, { t: 'snap' }>): void {
    const upload = p.host && this.seq === -1 && this.snapshotSeq === null;
    const asked = this.settleAsked && this.settleAsked.taker === p.id && m.meta.seq === this.settleAsked.seq;
    if (!upload && !asked) return;
    let inc = this.incoming.get(m.meta.id);
    if (!inc) {
      inc = { meta: m.meta, parts: new Array<string | null>(m.meta.parts).fill(null), from: p.id };
      this.incoming.set(m.meta.id, inc);
    }
    if (inc.from !== p.id || inc.meta.parts !== m.meta.parts) return;
    inc.parts[m.part] = m.data;
    if (inc.parts.some((x) => x === null)) return;
    this.incoming.delete(m.meta.id);
    const snap: StoredSnapshot = { meta: inc.meta, parts: inc.parts as string[] };
    this.store.saveSnapshot(snap);
    this.snapshotSeq = snap.meta.seq;
    this.events = this.events.filter((e) => e.seq > snap.meta.seq);
    this.lastSnapshot = this.env.now();
    if (upload) {
      // The city the room was made from: time starts where it stands.
      this.allowed = snap.meta.tick;
      this.seq = snap.meta.seq;
      this.info.cityName = snap.meta.cityName;
      p.joining = false;
      p.tick = snap.meta.tick;
      p.conn?.send({ t: 'ev', list: [], allow: this.allowed });
      this.choosePacer();
      this.broadcastRoom();
      this.broadcastPlayers();
    } else {
      this.settleAsked = null;
      for (const [id, reason] of [...this.waiting]) {
        const w = this.players.get(id);
        if (w) this.sendSnapshot(w, snap, reason);
      }
      this.broadcastPlayers();
    }
    this.saveMeta();
  }

  // ---------------------------------------------------------------- out of step

  /** Compare a player's hourly checksum with the pacer's; resync whoever disagrees with the pacer. */
  private checkSum(p: Player, tick: number, sum: string): void {
    let at = this.sums.get(tick);
    if (!at) {
      at = new Map();
      this.sums.set(tick, at);
      if (this.sums.size > KEEP_SUMS) this.sums.delete(this.sums.keys().next().value!);
    }
    at.set(p.id, sum);
    const ref = at.get(this.info.pacer);
    if (ref === undefined) return;
    for (const [id, s] of at) {
      if (id === this.info.pacer || s === ref) continue;
      const q = this.players.get(id);
      if (!q?.conn || this.waiting.has(id) || q.joining) continue;
      this.broadcast({ t: 'resync', player: id, text: `${q.name}'s game fell out of step; catching up` });
      q.joining = true;
      this.serveSnapshot(q, 'resync');
      this.broadcastPlayers();
    }
  }
}

/** A store in memory (the local relay's default, a host's browser, tests). */
export class MemoryStore implements RoomStore {
  meta: RoomMeta | null = null;
  events: Stamped[] = [];
  snapshot: StoredSnapshot | null = null;
  /** Rows written and read, as a Durable Object's SQLite would count them. */
  rowsWritten = 0;
  rowsRead = 0;
  loadMeta() {
    this.rowsRead++;
    return this.meta ? (JSON.parse(JSON.stringify(this.meta)) as RoomMeta) : null;
  }
  saveMeta(meta: RoomMeta) {
    this.rowsWritten++;
    this.meta = JSON.parse(JSON.stringify(meta)) as RoomMeta;
  }
  loadEvents() {
    this.rowsRead += this.events.length;
    return this.events.slice();
  }
  appendEvent(e: Stamped) {
    this.rowsWritten++;
    this.events.push(e);
  }
  saveSnapshot(s: StoredSnapshot) {
    this.rowsWritten += s.parts.length + 1;
    this.snapshot = s;
    this.events = this.events.filter((e) => e.seq > s.meta.seq);
  }
  loadSnapshot() {
    if (this.snapshot) this.rowsRead += this.snapshot.parts.length + 1;
    return this.snapshot;
  }
}
