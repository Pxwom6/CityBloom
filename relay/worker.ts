/**
 * The online relay (M30): a Cloudflare Worker with one Durable Object per room, on the free plan.
 *
 *   wss://<relay>/room/<CODE>    a room (the same Room class the local relay runs)
 *   wss://<relay>/signal/<CODE>  signalling for peer-to-peer rooms
 *
 * Rooms use the WebSocket Hibernation API, so a room nobody is talking to costs nothing; their
 * SQLite storage keeps the city between sessions (the latest snapshot and the events since). The
 * pings players send while idle are answered without waking the room. Deployed from `main` by
 * `.github/workflows/relay.yml`.
 */
import { DurableObject } from 'cloudflare:workers';
import { Room, type Conn, type RoomMeta, type RoomStore, type StoredSnapshot } from './room';
import { CODE_ALPHABET, CODE_LENGTH, type RoomMsg } from './protocol';
import { RegionRoom, type RegionConn, type RegionMeta, type RegionStore } from './region';
import type { Stamped } from '../src/sim/lockstep';

interface Env {
  ROOMS: DurableObjectNamespace;
  SIGNALS: DurableObjectNamespace;
  REGIONS: DurableObjectNamespace;
  /** Comma-separated origins allowed to connect (the site); empty allows any (development). */
  ALLOWED_ORIGINS?: string;
}

const PATH = new RegExp(`^/(room|signal|region)/([${CODE_ALPHABET}]{${CODE_LENGTH}})$`);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health')
      return new Response('citybloom relay', { headers: { 'access-control-allow-origin': '*' } });
    const m = PATH.exec(url.pathname);
    if (!m) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket')
      return new Response('expected a WebSocket', { status: 426 });
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = req.headers.get('Origin') ?? '';
    if (allowed.length && !allowed.includes(origin)) return new Response('forbidden', { status: 403 });
    const ns = m[1] === 'room' ? env.ROOMS : m[1] === 'region' ? env.REGIONS : env.SIGNALS;
    return ns.get(ns.idFromName(m[2]!)).fetch(req);
  },
};

/** A room's store in its Durable Object's SQLite. */
class SqlStore implements RoomStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, ev TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS snap (part INTEGER PRIMARY KEY, data TEXT)');
  }
  private get(k: string): string | null {
    const rows = this.sql.exec<{ v: string }>('SELECT v FROM kv WHERE k = ?', k).toArray();
    return rows[0]?.v ?? null;
  }
  private put(k: string, v: string): void {
    this.sql.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, v);
  }
  loadMeta(): RoomMeta | null {
    const v = this.get('meta');
    return v ? (JSON.parse(v) as RoomMeta) : null;
  }
  saveMeta(meta: RoomMeta): void {
    this.put('meta', JSON.stringify(meta));
  }
  loadEvents(): Stamped[] {
    return this.sql
      .exec<{ ev: string }>('SELECT ev FROM events ORDER BY seq')
      .toArray()
      .map((r) => JSON.parse(r.ev) as Stamped);
  }
  appendEvent(e: Stamped): void {
    this.sql.exec('INSERT OR REPLACE INTO events (seq, ev) VALUES (?, ?)', e.seq, JSON.stringify(e));
  }
  saveSnapshot(s: StoredSnapshot): void {
    this.sql.exec('DELETE FROM snap');
    s.parts.forEach((data, part) => this.sql.exec('INSERT INTO snap (part, data) VALUES (?, ?)', part, data));
    this.put('snapmeta', JSON.stringify(s.meta));
    this.sql.exec('DELETE FROM events WHERE seq <= ?', s.meta.seq);
  }
  loadSnapshot(): StoredSnapshot | null {
    const meta = this.get('snapmeta');
    if (!meta) return null;
    const parts = this.sql
      .exec<{ data: string }>('SELECT data FROM snap ORDER BY part')
      .toArray()
      .map((r) => r.data);
    return { meta: JSON.parse(meta) as StoredSnapshot['meta'], parts };
  }
  get code(): string | null {
    return this.get('code');
  }
  set code(c: string | null) {
    if (c) this.put('code', c);
  }
}

export class RoomObject extends DurableObject<Env> {
  private room: Room | null = null;
  private store: SqlStore;
  private conns = new Map<CfWebSocket, Conn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new SqlStore(ctx.storage.sql);
    // Idle players' pings are answered without waking the room (no duration billed).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private conn(ws: CfWebSocket): Conn {
    let c = this.conns.get(ws);
    if (!c)
      this.conns.set(
        ws,
        (c = {
          send: (m: RoomMsg) => {
            try {
              ws.send(JSON.stringify(m));
            } catch {
              /* the socket went: its close event follows */
            }
          },
          close: (code, reason) => ws.close(code, reason),
          bind: (player) => ws.serializeAttachment({ player }),
        }),
      );
    return c;
  }

  /** The room, rebuilt from storage and the sockets still open after a hibernation. */
  private ensure(code?: string): Room | null {
    if (this.room) return this.room;
    const c = code ?? this.store.code;
    if (!c) return null;
    this.store.code = c;
    this.room = new Room(c, 'online', this.store, { now: () => Date.now(), random: Math.random });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { player?: number } | null;
      if (a?.player) this.room.reattach(this.conn(ws), a.player);
      else this.room.open(this.conn(ws));
    }
    return this.room;
  }

  async fetch(req: Request): Promise<Response> {
    const code = new URL(req.url).pathname.split('/').pop()!;
    const room = this.ensure(code)!;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    room.open(this.conn(server));
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async webSocketMessage(ws: CfWebSocket, msg: string | ArrayBuffer): Promise<void> {
    this.ensure()?.message(this.conn(ws), typeof msg === 'string' ? msg : '');
  }

  async webSocketClose(ws: CfWebSocket): Promise<void> {
    this.ensure()?.closed(this.conn(ws));
    this.conns.delete(ws);
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}

/**
 * Peer-to-peer signalling: offers, answers and candidates passed between a host and its guests.
 * Kept entirely on the sockets (tags and attachments), so it hibernates between messages too.
 */
export class SignalObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v INTEGER)');
  }

  private nextId(): number {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ v: number }>("SELECT v FROM kv WHERE k = 'next'").toArray();
    const id = (rows[0]?.v ?? 0) + 1;
    sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('next', ?)", id);
    return id;
  }

  private peers(): { ws: CfWebSocket; id: number; host: boolean }[] {
    return this.ctx
      .getWebSockets()
      .map((ws) => ({ ws, ...(ws.deserializeAttachment() as { id: number; host: boolean }) }));
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const peers = this.peers();
    if (peers.length >= 16) return new Response('too many', { status: 429 });
    const id = this.nextId();
    this.ctx.acceptWebSocket(pair[1], [String(id)]);
    pair[1].serializeAttachment({ id, host: false });
    const host = peers.find((p) => p.host)?.id ?? 0;
    pair[1].send(JSON.stringify({ t: 'you', id, host }));
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  async webSocketMessage(ws: CfWebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 16_200) return;
    let m: { t?: unknown; to?: unknown; data?: unknown };
    try {
      m = JSON.parse(raw) as typeof m;
    } catch {
      return;
    }
    const me = ws.deserializeAttachment() as { id: number; host: boolean };
    const peers = this.peers();
    if (m.t === 'host' && !peers.some((p) => p.host)) {
      ws.serializeAttachment({ ...me, host: true });
      for (const p of peers) if (p.id !== me.id) p.ws.send(JSON.stringify({ t: 'host', id: me.id }));
    } else if (
      m.t === 'to' &&
      typeof m.to === 'number' &&
      typeof m.data === 'string' &&
      m.data.length <= 16_000
    ) {
      for (const ws2 of this.ctx.getWebSockets(String(m.to)))
        ws2.send(JSON.stringify({ t: 'from', from: me.id, data: m.data }));
    }
  }

  async webSocketClose(ws: CfWebSocket): Promise<void> {
    const me = ws.deserializeAttachment() as { id: number } | null;
    if (!me) return;
    for (const p of this.peers()) if (p.id !== me.id) p.ws.send(JSON.stringify({ t: 'gone', id: me.id }));
  }
}

/** A shared region's store (M32): its metadata and each city's latest save for visitors. */
class RegionSqlStore implements RegionStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
    sql.exec(
      'CREATE TABLE IF NOT EXISTS saves (slot INTEGER, part INTEGER, data TEXT, PRIMARY KEY (slot, part))',
    );
  }
  loadMeta(): RegionMeta | null {
    const v = this.sql.exec<{ v: string }>("SELECT v FROM kv WHERE k = 'meta'").toArray()[0]?.v;
    return v ? (JSON.parse(v) as RegionMeta) : null;
  }
  saveMeta(m: RegionMeta): void {
    this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('meta', ?)", JSON.stringify(m));
  }
  saveCity(slot: number, parts: string[]): void {
    this.sql.exec('DELETE FROM saves WHERE slot = ?', slot);
    parts.forEach((data, part) =>
      this.sql.exec('INSERT INTO saves (slot, part, data) VALUES (?, ?, ?)', slot, part, data),
    );
  }
  loadCity(slot: number): string[] | null {
    const rows = this.sql
      .exec<{ data: string }>('SELECT data FROM saves WHERE slot = ? ORDER BY part', slot)
      .toArray();
    return rows.length ? rows.map((r) => r.data) : null;
  }
}

export class RegionObject extends DurableObject<Env> {
  private region: RegionRoom | null = null;
  private conns = new Map<CfWebSocket, RegionConn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private conn(ws: CfWebSocket): RegionConn {
    let c = this.conns.get(ws);
    if (!c)
      this.conns.set(
        ws,
        (c = {
          send: (m) => {
            try {
              ws.send(JSON.stringify(m));
            } catch {
              /* closing */
            }
          },
          close: (code, reason) => ws.close(code, reason),
          bind: (slot) => ws.serializeAttachment({ slot }),
        }),
      );
    return c;
  }

  private ensure(code?: string): RegionRoom | null {
    if (this.region) return this.region;
    const store = new RegionSqlStore(this.ctx.storage.sql);
    const c = code ?? store.loadMeta()?.code;
    if (!c) return null;
    this.region = new RegionRoom(c, 'online', store, { now: () => Date.now(), random: Math.random });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { slot?: number } | null;
      if (a?.slot) this.region.reattach(this.conn(ws), a.slot);
      else this.region.open(this.conn(ws));
    }
    return this.region;
  }

  async fetch(req: Request): Promise<Response> {
    const code = new URL(req.url).pathname.split('/').pop()!;
    const region = this.ensure(code)!;
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    region.open(this.conn(pair[1]));
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  async webSocketMessage(ws: CfWebSocket, msg: string | ArrayBuffer): Promise<void> {
    this.ensure()?.message(this.conn(ws), typeof msg === 'string' ? msg : '');
  }

  async webSocketClose(ws: CfWebSocket): Promise<void> {
    this.ensure()?.closed(this.conn(ws));
    this.conns.delete(ws);
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}
