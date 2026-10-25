/**
 * A room (phase 4, M30): orders the players' commands, keeps the city between sessions and catches
 * players up. The same class runs in the local relay (Node), in a Cloudflare Durable Object and in a
 * host's browser for peer-to-peer; each gives it connections and a store. Time moves when the
 * pacer's game sends `clock`. Its one timer writes the events it holds as a batch (F8: a row per
 * batch, not per command), so an online room sleeps whenever it has nothing unsaved.
 *
 * It keeps within Cloudflare's free plan under abuse (F8): every connection is rate limited, commands
 * and the host's controls more tightly; one snapshot is held in flight, of at most
 * `MAX_SNAPSHOT_PARTS`; the room stops writing at a daily row budget; and it says when it may be
 * forgotten (`expiresAt`).
 *
 * The city itself is opaque here: snapshots arrive as compressed parts from a player's game and are
 * kept and passed on as they are. Commands are checked for shape only; the sim decides what they mean.
 */
import type { Stamped } from '../src/sim/lockstep';
import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  makeSecret,
  parseClientMsg,
  type ClientMsg,
  type PlayerInfo,
  type RoomInfo,
  type RoomMsg,
  type SnapshotMeta,
  type AdminAction,
  type Speed,
} from './protocol';
import { may, roomRefusal, type SharedRules } from '../src/sim/rules';
import { checkCommand } from '../src/sim/commandCheck';
import { DAY_MS, DailyRows, TokenBucket, dailyLimitText, type RowBudget } from './limits';

export interface Conn {
  send(msg: RoomMsg): void;
  close(code: number, reason: string): void;
  /** The player this connection now is (a Durable Object keeps it on the socket through hibernation). */
  bind?(player: number): void;
  /**
   * May this connection make a room (F8)? Online, only a socket opened with `?create=1`, so the
   * Worker knows a creation when it sees one; left out (loopback, peer-to-peer, tests), it may.
   */
  mayCreate?: boolean;
}

export interface StoredSnapshot {
  meta: SnapshotMeta;
  parts: string[];
}

/** What a room keeps between sessions. Synchronous, as a Durable Object's SQLite is. */
export interface RoomStore {
  loadMeta(): RoomMeta | null;
  saveMeta(meta: RoomMeta): void;
  /**
   * Events since the stored snapshot, in order (a batch the snapshot cut through may bring a few it
   * already holds; the room drops those).
   */
  loadEvents(): Stamped[];
  /** Keep a batch of events, in order, as one row. */
  appendEvents(list: Stamped[]): void;
  /** Store a snapshot and drop the batches it holds whole (every seq ≤ its seq). */
  saveSnapshot(s: StoredSnapshot): void;
  loadSnapshot(): StoredSnapshot | null;
  /** Forget the room (it expired). */
  deleteAll(): void;
  /** Rows written so far, as a Durable Object's SQLite counts them (the free plan's limit). */
  readonly rowsWritten: number;
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
  /**
   * Sequence numbers handed out up to here (F8). Events are written in batches, so a room that's
   * lost (a deploy, a crash) loses its last few; their numbers are never handed out again.
   */
  seqReserved?: number;
  /** Numbers players may have seen whose events were lost, as (after, upTo] ranges. */
  lost?: [number, number][];
  /** When the room's record was last saved (ms): it expires a while after (F8). */
  lastActive?: number;
  /** Rows written today (F8). */
  budget?: RowBudget;
}

export interface RoomEnv {
  /** Milliseconds, for rate limits and how often to save (never for the city's time). */
  now(): number;
  /**
   * Run `fn` once after `ms`; returns a cancel. Online rooms pass `setTimeout`: a pending timer keeps
   * a Durable Object awake, so events waiting for their batch are never lost to hibernation. Left
   * out, every event is written at once.
   */
  later?(ms: number, fn: () => void): () => void;
}

/** What one connection may send, and what the room may write (F8). */
export interface RoomLimits {
  /** Messages a second per connection and a burst: past it they're dropped; past twice it, closed. */
  rate: number;
  burst: number;
  /** Commands a second per connection and a burst: past it, refused ("Slow down a little"). */
  cmdRate: number;
  cmdBurst: number;
  /** Speed, rules and admin changes a second per connection, and a burst. */
  ctlRate: number;
  ctlBurst: number;
  /** Rows the room may write in a UTC day. */
  dailyRows: number;
  /** How long a room nobody comes back to is kept (ms). */
  ttl: number;
  /** Connections at once (players and sockets yet to say hello). */
  maxConns: number;
}

/**
 * Online defaults. An honest game sends about 8 messages a second at most (progress 1, clock 2,
 * presence 4, the odd command); a four-player eight-hour day writes well under a tenth of the budget.
 */
export const ROOM_LIMITS: RoomLimits = {
  rate: 20,
  burst: 80,
  cmdRate: 8,
  cmdBurst: 40,
  ctlRate: 2,
  ctlBurst: 10,
  dailyRows: 5000,
  ttl: 60 * DAY_MS,
  maxConns: 24,
};

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
  /** Every message; commands; speed, rules and admin; chat. */
  all: TokenBucket;
  cmds: TokenBucket;
  ctl: TokenBucket;
  chat: TokenBucket;
  /** Order of opening, to drop the oldest silent socket when full. */
  n: number;
}

/** A snapshot arriving in parts. */
interface Incoming {
  meta: SnapshotMeta;
  parts: (string | null)[];
  got: number;
  from: number;
}

/** How far the pacer may move time in one message (30 game minutes). */
export const MAX_CLOCK_STEP = 30 * 60;
/** A joining player is in step once within this many ticks of the frontier (the city keeps moving). */
const CAUGHT_UP = 120;
/** How long to wait for the pacer's snapshot before falling back to the stored one (ms). */
const SETTLE_WAIT = 8_000;
/** Checksums kept for comparing (game hours). */
const KEEP_SUMS = 48;
/** Save the room's clock at most this often while it runs (ms); always on pause and when all leave. */
const META_EVERY = 60_000;
/** Events wait at most this long for their batch while the city runs (ms)… */
const BATCH_RUNNING = 30_000;
/** …and this long when it stands still or nobody keeps time, so the room can soon sleep. */
const BATCH_STILL = 2_000;
/** A batch is written at once at this many events or characters (a row stays well under 2 MB). */
const BATCH_EVENTS = 100;
const BATCH_CHARS = 256_000;
/** Sequence numbers reserved at a time (a row per this many events). */
const SEQ_BLOCK = 256;
/** Past the day's budget, the record is still saved as the room empties, but at most this often. */
const OVER_BUDGET_SAVE = 10 * 60_000;
const SLOW_DOWN = 'Slow down a little';
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
  /** The one snapshot arriving in parts (F8: a script can't fill memory with half-sent ones). */
  private incoming: Incoming | null = null;
  /** Players waiting for the next snapshot, and why. */
  private waiting = new Map<number, 'join' | 'resync'>();
  /** A settle asked of the pacer and not yet answered. */
  private settleAsked: { seq: number; taker: number; at: number } | null = null;
  /** Hourly checksums by tick: player → sum. */
  private sums = new Map<number, Map<number, string>>();
  private metaSaved = 0;
  private snapshotSeq: number | null = null;
  private lastSnapshot = 0;
  /** Messages this room has received, for the free-plan accounting in tests. */
  received = 0;
  private readonly limits: RoomLimits;
  /** Events ordered and sent but not yet written, and the timer that will write them. */
  private pending: Stamped[] = [];
  private pendingChars = 0;
  private batchTimer: (() => void) | null = null;
  private batchDue = 0;
  private seqReserved = -1;
  private lost: [number, number][] = [];
  private lastActive: number;
  private readonly budget: DailyRows;
  private overSaved = -Infinity;
  private opened = 0;

  constructor(
    code: string,
    kind: RoomInfo['kind'],
    private readonly store: RoomStore,
    private readonly env: RoomEnv,
    limits: Partial<RoomLimits> = {},
  ) {
    this.limits = { ...ROOM_LIMITS, ...limits };
    this.info = {
      code,
      kind,
      locked: false,
      chat: true,
      speed: 1,
      pacer: 0,
      cityName: '',
      rules: { perms: {}, host: 0, spendLimit: null },
      muted: [],
    };
    const now = env.now();
    this.lastActive = now;
    const meta = store.loadMeta();
    this.budget = new DailyRows(this.limits.dailyRows, () => store.rowsWritten, meta?.budget, now);
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

  /** Sockets open now (players and those yet to say hello). */
  get connections(): number {
    return this.conns.size;
  }

  /**
   * When this room may be forgotten (F8): a while after its record was last saved, which is when the
   * last player left. Never while anyone is connected, nor for a room that holds nothing.
   */
  expiresAt(): number | null {
    if (!this.exists || this.conns.size) return null;
    return this.lastActive + this.limits.ttl;
  }

  /** Brought back from the store and not yet moved on by the pacer. */
  private restored = false;

  private restore(meta: RoomMeta): void {
    this.restored = true;
    this.info = {
      ...meta.info,
      pacer: 0,
      rules: meta.info.rules ?? { perms: {}, host: 0, spendLimit: null },
      muted: meta.info.muted ?? [],
    };
    for (const p of meta.players)
      this.players.set(p.id, { ...p, visible: false, joining: false, conn: null });
    this.nextPlayer = meta.nextPlayer;
    this.allowed = meta.allowed;
    this.kicked = new Set(meta.kicked);
    this.snapshotSeq = meta.snapshotSeq;
    this.lastActive = meta.lastActive ?? this.lastActive;
    const base = this.snapshotSeq ?? -1;
    // A batch the snapshot cut through still holds events the snapshot has.
    this.events = this.store.loadEvents().filter((e) => this.snapshotSeq === null || e.seq > base);
    let kept = Math.max(meta.seq, base);
    for (const e of this.events) {
      kept = Math.max(kept, e.seq);
      this.allowed = Math.max(this.allowed, e.tick);
    }
    // Numbers handed out after the last event kept may have reached players with events now lost
    // (the room went before their batch was written): never hand them out again, and catch anyone
    // who saw them up from a snapshot.
    this.seq = Math.max(kept, meta.seqReserved ?? -1);
    this.seqReserved = this.seq;
    this.lost = (meta.lost ?? []).filter(([, upTo]) => upTo > base);
    if (this.seq > kept && !this.lost.some(([a, b]) => a === kept && b === this.seq))
      this.lost.push([kept, this.seq]);
  }

  private connState(player: number): ConnState {
    const now = this.env.now();
    const l = this.limits;
    return {
      player,
      all: new TokenBucket(l.rate, l.burst, now),
      cmds: new TokenBucket(l.cmdRate, l.cmdBurst, now),
      ctl: new TokenBucket(l.ctlRate, l.ctlBurst, now),
      chat: new TokenBucket(1, 3, now),
      n: ++this.opened,
    };
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
    this.conns.set(conn, this.connState(player));
    this.choosePacer();
  }

  /**
   * Save the room's record, after the events it holds (a record never claims an event the store
   * doesn't have). Past the day's budget, only what keeps sequence numbers unique is saved, and the
   * record as the room empties, now and then.
   */
  private saveMeta(why: 'change' | 'seq' | 'empty' = 'change'): void {
    const now = this.env.now();
    this.flush();
    if (why !== 'seq' && this.budget.over(now)) {
      if (why !== 'empty' || now - this.overSaved < OVER_BUDGET_SAVE) return;
      this.overSaved = now;
    }
    this.metaSaved = now;
    this.lastActive = now;
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
      seqReserved: this.seqReserved,
      lost: this.lost,
      lastActive: now,
      budget: this.budget.record(now),
    });
  }

  // ---------------------------------------------------------------- batches (F8)

  /** Keep an event: in the batch to come, or written at once with no timer to write a batch. */
  private keep(e: Stamped): void {
    if (!this.env.later) return this.store.appendEvents([e]);
    this.pending.push(e);
    this.pendingChars += JSON.stringify(e).length;
    if (this.pending.length >= BATCH_EVENTS || this.pendingChars >= BATCH_CHARS) this.flush();
    else this.schedule();
  }

  /** Make sure the batch is written in time: soon if the city stands still, so the room can sleep. */
  private schedule(): void {
    const later = this.env.later;
    if (!later || !this.pending.length) return;
    const wait = this.info.speed > 0 && this.info.pacer ? BATCH_RUNNING : BATCH_STILL;
    const due = this.env.now() + wait;
    if (this.batchTimer && this.batchDue <= due) return;
    this.batchTimer?.();
    this.batchDue = due;
    this.batchTimer = later(wait, () => {
      this.batchTimer = null;
      this.flush();
    });
  }

  /**
   * Write the events waiting, as one row (also called by a relay shutting down). Always, past the
   * budget too: everyone has them already.
   */
  flush(): void {
    this.batchTimer?.();
    this.batchTimer = null;
    if (!this.pending.length) return;
    const list = this.pending;
    this.pending = [];
    this.pendingChars = 0;
    this.store.appendEvents(list);
  }

  // ---------------------------------------------------------------- connections

  open(conn: Conn): void {
    // A shut room answers whatever comes next (the hello) with why.
    if (this.shut) return;
    if (this.conns.size >= this.limits.maxConns) {
      // Sockets opened by a script mustn't crowd players out: the oldest yet to say hello goes.
      let oldest: [Conn, ConnState] | null = null;
      for (const e of this.conns) if (!e[1].player && (!oldest || e[1].n < oldest[1].n)) oldest = e;
      if (!oldest) {
        conn.send({ t: 'error', code: 'full', text: 'Too many connections to this room' });
        return conn.close(4000, 'full');
      }
      this.conns.delete(oldest[0]);
      oldest[0].close(4000, 'full');
    }
    this.conns.set(conn, this.connState(0));
  }

  /** Why the room shut for good, once it has (F10). */
  private shut: string | null = null;

  /**
   * The room shuts for good: a peer-to-peer host's browser is leaving, and the city with it (F10).
   * Everyone still here is told why, and nobody new gets in.
   */
  close(text: string): void {
    this.shut = text;
    for (const c of [...this.conns.keys()]) {
      c.send({ t: 'error', code: 'closed', text });
      c.close(1000, 'closed');
    }
    this.conns.clear();
    for (const p of this.players.values()) p.conn = null;
  }

  closed(conn: Conn): void {
    const st = this.conns.get(conn);
    this.conns.delete(conn);
    if (!st?.player) return;
    const p = this.players.get(st.player);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    this.waiting.delete(p.id);
    if (this.incoming?.from === p.id) this.incoming = null;
    this.choosePacer();
    this.broadcastPlayers();
    this.broadcastRoom();
    if (!this.online) this.saveMeta('empty');
  }

  message(conn: Conn, raw: string): void {
    // A keep-alive (a Durable Object answers these itself without waking).
    if (raw === 'ping') return;
    if (this.shut) {
      conn.send({ t: 'error', code: 'closed', text: this.shut });
      return conn.close(1000, 'closed');
    }
    this.received++;
    const st = this.conns.get(conn);
    if (!st) return;
    // A token bucket per connection: a burst is fine, a flood is dropped, a torrent closes it.
    const now = this.env.now();
    const left = st.all.spend(now);
    if (left < -this.limits.burst) return this.reject(conn, 'rate', 'Too many messages');
    if (left < 0) return;
    const msg = parseClientMsg(raw);
    if (!msg) return this.reject(conn, 'bad-message', 'A message the room could not read');
    this.checkStall(now);
    if (msg.t === 'hello') return this.hello(conn, msg);
    const p = st.player ? this.players.get(st.player) : null;
    if (!p) return this.reject(conn, 'bad-message', 'Say hello first');
    this.handle(p, st, msg, now);
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
      if (conn.mayCreate === false)
        return this.reject(conn, 'version', 'Making a room needs a newer Citybloom: reload to update');
      if (this.exists) return this.reject(conn, 'exists', 'That room code is taken');
      const p = this.addPlayer(conn, m.name, m.color, true);
      this.info.cityName = m.create.cityName;
      this.info.rules.host = p.id;
      this.info.pacer = p.id;
      p.joining = true;
      conn.send(this.welcome(p, 'upload'));
      this.saveMeta();
      return;
    }
    if (!this.exists) return this.reject(conn, 'no-room', 'No room with that code');
    // A removed player's record is gone, but not their id: their old secret doesn't let them back.
    if (m.rejoin && this.kicked.has(m.rejoin.id))
      return this.reject(conn, 'kicked', 'The host removed you from this room');
    if (m.rejoin) {
      const p = this.players.get(m.rejoin.id);
      if (p && p.secret === m.rejoin.secret) {
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
        conn.bind?.(p.id);
        // Caught up from the events the room holds: those after the stored snapshot, less any lost
        // with an earlier incarnation of the room (F8), whose numbers this player may have seen.
        const seq = m.rejoin.seq;
        const from = this.snapshotSeq ?? (this.events[0]?.seq ?? this.seq + 1) - 1;
        const lost = this.lost.some(([after, upTo]) => seq > after && seq <= upTo);
        if (seq >= from && seq <= this.seq && !lost && !this.waiting.has(p.id)) {
          p.joining = false;
          conn.send(this.welcome(p, 'events'));
          conn.send({ t: 'ev', list: this.events.filter((e) => e.seq > seq), allow: this.allowed });
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
    }
    if (this.info.locked) return this.reject(conn, 'locked', 'The host has locked this room');
    if (this.online >= MAX_PLAYERS)
      return this.reject(conn, 'full', `This room is full (${MAX_PLAYERS} players)`);
    if (this.budget.over(this.env.now())) return this.reject(conn, 'limit', dailyLimitText('room'));
    const p = this.addPlayer(conn, m.name, m.color, false);
    p.joining = true;
    conn.send(this.welcome(p, 'snapshot'));
    this.broadcast({ t: 'notice', text: `${p.name} is joining` }, p.id);
    this.serveSnapshot(p, 'join');
    this.broadcastPlayers();
    this.saveMeta();
  }

  private addPlayer(conn: Conn, name: string, color: number, host: boolean): Player {
    const p: Player = {
      id: this.nextPlayer++,
      name,
      color,
      host,
      secret: makeSecret(),
      tick: this.allowed,
      visible: true,
      joining: false,
      conn,
    };
    this.players.set(p.id, p);
    this.conns.get(conn)!.player = p.id;
    conn.bind?.(p.id);
    return p;
  }

  private welcome(p: Player, join: 'upload' | 'snapshot' | 'events'): RoomMsg {
    return { t: 'welcome', you: p.id, secret: p.secret, room: this.info, players: this.playerList(), join };
  }

  // ---------------------------------------------------------------- messages

  private handle(p: Player, st: ConnState, m: ClientMsg, now: number): void {
    switch (m.t) {
      case 'cmd': {
        // Commands have their own limit (F8); one over it is turned down in words, never lost.
        if (!st.cmds.take(now)) {
          p.conn?.send({ t: 'refused', ref: m.ref, reason: SLOW_DOWN });
          return;
        }
        if (this.budget.over(now)) {
          p.conn?.send({ t: 'refused', ref: m.ref, reason: dailyLimitText('room') });
          return;
        }
        // Every field checked, and only a clean copy ordered (F7): a malformed command would throw
        // or hang in every player's game. Cheats and page-only commands never come from players.
        const checked = checkCommand(m.cmd);
        if ('problem' in checked) {
          p.conn?.send({ t: 'refused', ref: m.ref, reason: checked.problem });
          return;
        }
        const why = roomRefusal(this.info.rules, p.id, checked.cmd);
        if (why) {
          p.conn?.send({ t: 'refused', ref: m.ref, reason: why });
          return;
        }
        this.order({ kind: 'cmd', cmd: checked.cmd, by: p.id, ref: m.ref });
        return;
      }
      case 'clock': {
        if (p.id !== this.info.pacer) return;
        if (m.allow <= this.allowed || m.allow > this.allowed + MAX_CLOCK_STEP) return;
        this.allowed = m.allow;
        this.restored = false;
        this.broadcastEvents([]);
        if (now - this.metaSaved > META_EVERY) this.saveMeta();
        if (now - this.lastSnapshot > SNAPSHOT_EVERY && this.events.length) this.askSettle('snapshot');
        return;
      }
      case 'status': {
        // A room woken from sleep may have lost its last few clock moves: never stamp behind a player.
        if (this.restored && m.tick > this.allowed && m.tick <= this.allowed + MAX_CLOCK_STEP)
          this.allowed = m.tick;
        const moved = p.tick !== m.tick;
        p.tick = m.tick;
        if (moved) this.broadcast({ t: 'ticks', ticks: [[p.id, p.tick]] }, p.id);
        if (p.joining && !this.waiting.has(p.id) && m.tick >= this.allowed - CAUGHT_UP) {
          p.joining = false;
          this.choosePacer();
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
        if (!st.ctl.take(now)) {
          p.conn?.send({ t: 'notice', text: SLOW_DOWN });
          return;
        }
        if (!may(this.info.rules, p.id, 'speed')) {
          p.conn?.send({ t: 'notice', text: "The host hasn't let you pause or change the speed" });
          return;
        }
        if (m.speed !== this.info.speed)
          this.broadcast({
            t: 'notice',
            text: `${p.name} ${m.speed === 0 ? 'paused the city' : this.info.speed === 0 ? 'set the city going' : `set the speed to ${['', 'normal', 'fast', 'fastest'][m.speed]}`}`,
          });
        this.setSpeed(m.speed);
        return;
      case 'rules': {
        if (!p.host) return;
        if (!st.ctl.take(now)) {
          p.conn?.send({ t: 'notice', text: SLOW_DOWN });
          return;
        }
        if (this.budget.over(now)) {
          p.conn?.send({ t: 'notice', text: dailyLimitText('room') });
          return;
        }
        const r = this.info.rules;
        const before = JSON.stringify(r);
        if (m.player !== undefined && m.perms) r.perms[m.player] = m.perms;
        if (m.spendLimit !== undefined) r.spendLimit = m.spendLimit;
        if (JSON.stringify(r) === before) return;
        // Every game applies the same rules at the same tick: the sim checks what the room can't.
        this.order({ kind: 'rules', rules: JSON.parse(JSON.stringify(r)) as SharedRules });
        this.broadcastRoom();
        this.saveMeta();
        return;
      }
      case 'here': {
        const { t: _t, ...rest } = m;
        this.broadcast({ t: 'here', from: p.id, ...rest }, p.id);
        return;
      }
      case 'ping':
        this.broadcast({ t: 'ping', from: p.id, at: m.at }, p.id);
        return;
      case 'chat':
        if (!this.info.chat || this.info.muted.includes(p.id) || !st.chat.take(now)) return;
        this.broadcast({ t: 'chat', from: p.id, text: m.text });
        return;
      case 'admin':
        if (!p.host) return;
        if (!st.ctl.take(now)) {
          p.conn?.send({ t: 'notice', text: SLOW_DOWN });
          return;
        }
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

  private admin(action: AdminAction, player?: number): void {
    // Written only when something changed (F8): a host's script repeating "lock" writes nothing.
    const before = JSON.stringify(this.info);
    if (action === 'lock' || action === 'unlock') this.info.locked = action === 'lock';
    else if ((action === 'mute' || action === 'unmute') && player) {
      this.info.muted = this.info.muted.filter((x) => x !== player);
      if (action === 'mute') this.info.muted.push(player);
    } else if (action === 'chatOff' || action === 'chatOn') this.info.chat = action === 'chatOn';
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
      this.waiting.delete(player);
      // Rooms have no accounts, so the code alone would let them straight back in as someone new:
      // the room locks behind them (players already in it still come back after a dropped link).
      const wasLocked = this.info.locked;
      this.info.locked = true;
      this.broadcast({ t: 'notice', text: `${target.name} was removed by the host` });
      const host = [...this.players.values()].find((p) => p.host);
      host?.conn?.send({
        t: 'notice',
        text: wasLocked
          ? `The room stays locked so they can’t come back.`
          : `The room is now locked so they can’t come back. Unlock it to let someone new join.`,
      });
      this.broadcastPlayers();
      this.broadcastRoom();
      this.saveMeta();
      return;
    }
    if (JSON.stringify(this.info) === before) return;
    this.broadcastRoom();
    this.saveMeta();
  }

  /** Stamp an event at the frontier and send it to everyone in step. */
  private order(ev: Stamped['ev']): Stamped {
    // Its number goes on record before anyone sees it (F8), a block at a time.
    if (this.seq + 1 > this.seqReserved) {
      this.seqReserved = this.seq + SEQ_BLOCK;
      this.saveMeta('seq');
    }
    const e: Stamped = { tick: this.allowed, seq: ++this.seq, ev };
    this.events.push(e);
    this.keep(e);
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
      // Nobody keeping time: write what's waiting soon, so the room can sleep.
      if (!id) this.schedule();
    }
  }

  // ---------------------------------------------------------------- snapshots

  /**
   * Ask the pacer's game to settle and save the city at the frontier. Past the day's budget, those
   * waiting get the stored snapshot and the events since instead.
   */
  private askSettle(reason: 'snapshot' | 'autosave'): boolean {
    const taker = this.info.pacer;
    if (!taker || this.budget.over(this.env.now())) return false;
    if (this.settleAsked && this.settleAsked.taker === taker) return true;
    const e = this.order({ kind: 'settle', taker, reason });
    this.setSettle({ seq: e.seq, taker, at: this.env.now() });
    this.lastSnapshot = this.env.now();
    return true;
  }

  /** The settle the room waits on, or none: parts of any snapshot from before are dropped. */
  private setSettle(asked: Room['settleAsked']): void {
    this.settleAsked = asked;
    this.incoming = null;
  }

  /**
   * A snapshot asked of a game that hasn't answered (its tab frozen, its connection dead but not yet
   * closed): those waiting get the stored one and the events since instead.
   */
  private checkStall(now: number): void {
    const asked = this.settleAsked;
    if (!asked || now - asked.at < SETTLE_WAIT || !this.waiting.size) return;
    this.setSettle(null);
    const stored = this.snapshotSeq === null ? null : this.store.loadSnapshot();
    if (!stored) return;
    for (const [id, reason] of [...this.waiting]) {
      const w = this.players.get(id);
      if (w) this.sendSnapshot(w, stored, reason);
    }
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
    // One snapshot in flight (F8): a new one from the player the room waits on replaces the last,
    // and parts that don't match it are dropped.
    let inc = this.incoming;
    if (!inc || inc.from !== p.id || inc.meta.id !== m.meta.id)
      inc = this.incoming = {
        meta: m.meta,
        parts: new Array<string | null>(m.meta.parts).fill(null),
        got: 0,
        from: p.id,
      };
    if (JSON.stringify(inc.meta) !== JSON.stringify(m.meta)) return;
    if (inc.parts[m.part] === null) inc.got++;
    inc.parts[m.part] = m.data;
    if (inc.got < inc.parts.length) return;
    this.incoming = null;
    const snap: StoredSnapshot = { meta: inc.meta, parts: inc.parts as string[] };
    const now = this.env.now();
    // Past the day's budget a snapshot is passed on but not kept: the stored one and the events
    // since still catch anyone up.
    const keep = upload || !this.budget.over(now);
    if (keep) {
      // Events it holds needn't be written; the rest are, with the room's record, just after.
      this.pending = this.pending.filter((e) => e.seq > snap.meta.seq);
      this.pendingChars = this.pending.reduce((n, e) => n + JSON.stringify(e).length, 0);
      this.store.saveSnapshot(snap);
      this.snapshotSeq = snap.meta.seq;
      this.events = this.events.filter((e) => e.seq > snap.meta.seq);
      this.lost = this.lost.filter(([, upTo]) => upTo > snap.meta.seq);
    }
    this.lastSnapshot = now;
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
      this.setSettle(null);
      for (const [id, reason] of [...this.waiting]) {
        const w = this.players.get(id);
        if (w) this.sendSnapshot(w, snap, reason);
      }
      this.broadcastPlayers();
    }
    if (keep) this.saveMeta();
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
  /** Events since the stored snapshot, in order. */
  events: Stamped[] = [];
  snapshot: StoredSnapshot | null = null;
  /** Rows written and read, as a Durable Object's SQLite counts them (`relay/sqlStore.ts`). */
  rowsWritten = 0;
  rowsRead = 0;
  /** The rows the events are kept in: each batch's first and last sequence number. */
  private batches: { first: number; last: number }[] = [];
  loadMeta() {
    this.rowsRead++;
    return this.meta ? (JSON.parse(JSON.stringify(this.meta)) as RoomMeta) : null;
  }
  saveMeta(meta: RoomMeta) {
    this.rowsWritten++;
    this.meta = JSON.parse(JSON.stringify(meta)) as RoomMeta;
  }
  loadEvents() {
    this.rowsRead += this.batches.length;
    return this.events.slice();
  }
  appendEvents(list: Stamped[]) {
    if (!list.length) return;
    this.rowsWritten++;
    this.events.push(...list);
    this.batches.push({ first: list[0]!.seq, last: list.at(-1)!.seq });
  }
  saveSnapshot(s: StoredSnapshot) {
    // Each part upserted, old parts past the new count deleted, its description, and every batch
    // it holds whole deleted.
    const old = this.snapshot?.parts.length ?? 0;
    const whole = this.batches.filter((b) => b.last <= s.meta.seq).length;
    this.rowsWritten += s.parts.length + Math.max(0, old - s.parts.length) + 1 + whole;
    this.batches = this.batches.filter((b) => b.last > s.meta.seq);
    this.snapshot = s;
    this.events = this.events.filter((e) => e.seq > s.meta.seq);
  }
  loadSnapshot() {
    if (this.snapshot) this.rowsRead += this.snapshot.parts.length + 1;
    return this.snapshot;
  }
  deleteAll() {
    this.meta = null;
    this.events = [];
    this.batches = [];
    this.snapshot = null;
  }
}
