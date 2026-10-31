/**
 * What the online relay's Durable Objects do (M30, F8), free of Cloudflare's runtime: the Worker
 * (`relay/worker.ts`) hands them its sockets and SQLite; tests hand them stand-ins and Node's SQLite.
 *
 * A code nobody hosts costs nothing to try (F8): routing turns away codes of the wrong kind; an
 * object learns its code from the socket that opened it rather than writing it down; its tables are
 * made on the first write (`relay/sqlStore.ts`), which only a room or region being made causes; and
 * only a socket opened with `?create=1` may make one. Signalling keeps nothing in storage at all.
 */
import { CODE_ALPHABET, CODE_LENGTH, secureIndex, type RoomMsg } from './protocol';
import { Room, type Conn, type RoomEnv } from './room';
import { RegionRoom, type RegionConn, type RegionRoomMsg } from './region';
import { RegionSqlStore, SqlStore, type Sql } from './sqlStore';
import { MAX_DATA, MAX_PEERS, SIGNAL_BURST, SIGNAL_RATE } from './signal';
import { TokenBucket } from './limits';

const DIGITS = CODE_ALPHABET.replace(/[A-Z]/g, '');
const LETTERS = CODE_ALPHABET.replace(/[0-9]/g, '');
const REST = `[${CODE_ALPHABET}]{${CODE_LENGTH - 1}}`;
const PATH = new RegExp(`^/(?:(room|region)/([${DIGITS}]${REST})|(signal)/([${LETTERS}]${REST}))$`);

export interface Route {
  kind: 'room' | 'region' | 'signal';
  code: string;
  /** Opened with `?create=1`: making a room or region. */
  create: boolean;
}

/**
 * Where a request goes. Rooms' and regions' codes start with a digit and signalling's with a letter
 * (`makeCode`), so a scan of codes reaches half as many objects.
 */
export function route(pathname: string, search: string): Route | null {
  const m = PATH.exec(pathname);
  if (!m) return null;
  const kind = (m[1] ?? m[3]) as Route['kind'];
  const create = kind !== 'signal' && new URLSearchParams(search).get('create') === '1';
  return { kind, code: (m[2] ?? m[4])!, create };
}

/** What a socket carries through hibernation. */
export interface SocketTag {
  code?: string;
  /** Opened with `?create=1`. */
  create?: boolean;
  /** The player or city it speaks for. */
  player?: number;
  slot?: number;
  /** A region page's protocol (M39: live battles need a page that speaks them), kept through hibernation. */
  v?: number;
  /** Signalling: the peer's id, and whether it's the host. */
  id?: number;
  host?: boolean;
}

/** A Durable Object's WebSocket, as the objects here use it. */
export interface HostSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
  tag(): SocketTag | null;
  setTag(t: SocketTag): void;
}

interface Hosted<C> {
  open(conn: C): void;
  reattach(conn: C, id: number, tag?: SocketTag | null): void;
  message(conn: C, raw: string): void;
  closed(conn: C): void;
  expiresAt(): number | null;
}

/** A room or region held by an object, rebuilt from storage and its sockets whenever it wakes. */
abstract class ObjectHost<H extends Hosted<C>, C> {
  private hosted: H | null = null;
  private conns = new Map<HostSocket, C>();

  constructor(private readonly sockets: () => HostSocket[]) {}

  protected abstract build(code: string): H;
  protected abstract storedCode(): string | null;
  protected abstract idOf(tag: SocketTag | null): number | undefined;
  protected abstract makeConn(ws: HostSocket): C;
  protected abstract wipe(): void;

  protected conn(ws: HostSocket): C {
    let c = this.conns.get(ws);
    if (!c) this.conns.set(ws, (c = this.makeConn(ws)));
    return c;
  }

  /** Send, ignoring a socket that has just gone (its close event follows). */
  protected static send(ws: HostSocket, m: RoomMsg | RegionRoomMsg): void {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* closing */
    }
  }

  /**
   * The room or region, rebuilt after a hibernation. Its code comes from a socket (tagged as it
   * opened) or the stored record; finding it writes nothing.
   */
  private ensure(): H | null {
    if (this.hosted) return this.hosted;
    const open = this.sockets();
    const code = open.map((ws) => ws.tag()?.code).find((c) => !!c) ?? this.storedCode();
    if (!code) return null;
    const h = (this.hosted = this.build(code));
    for (const ws of open) {
      const id = this.idOf(ws.tag());
      if (id) h.reattach(this.conn(ws), id, ws.tag());
      else h.open(this.conn(ws));
    }
    return h;
  }

  /** A socket just accepted for `code`, opened with `?create=1` or not. */
  accept(ws: HostSocket, code: string, create: boolean): void {
    ws.setTag({ code, create });
    if (this.hosted) this.hosted.open(this.conn(ws));
    else this.ensure(); // opens every socket, this one with them
  }

  message(ws: HostSocket, raw: string): void {
    this.ensure()?.message(this.conn(ws), raw);
  }

  /** A socket closed: when the object may be forgotten if nobody else comes (null: not yet known). */
  closed(ws: HostSocket): number | null {
    const h = this.ensure();
    h?.closed(this.conn(ws));
    this.conns.delete(ws);
    return h?.expiresAt() ?? null;
  }

  /**
   * The object's alarm (F8): `'forget'` once it has expired (its storage is wiped), else when to look
   * again, or null when there's nothing to watch (nothing stored, or someone connected: the last to
   * leave sets the alarm again).
   */
  alarm(now: number): number | 'forget' | null {
    const h = this.ensure();
    const at = h?.expiresAt() ?? null;
    if (at === null) return null;
    if (at > now) return at;
    this.wipe();
    this.hosted = null;
    this.conns.clear();
    return 'forget';
  }
}

/** A room's Durable Object. */
export class RoomHost extends ObjectHost<Room, Conn> {
  private readonly store: SqlStore;

  constructor(
    sql: Sql,
    sockets: () => HostSocket[],
    private readonly env: RoomEnv,
  ) {
    super(sockets);
    this.store = new SqlStore(sql);
  }
  protected build(code: string): Room {
    return new Room(code, 'online', this.store, this.env);
  }
  protected storedCode(): string | null {
    return this.store.loadMeta()?.info.code ?? null;
  }
  protected idOf(tag: SocketTag | null): number | undefined {
    return tag?.player;
  }
  protected makeConn(ws: HostSocket): Conn {
    return {
      send: (m) => ObjectHost.send(ws, m),
      close: (code, reason) => ws.close(code, reason),
      bind: (player) => ws.setTag({ ...ws.tag(), player }),
      mayCreate: ws.tag()?.create === true,
    };
  }
  protected wipe(): void {
    this.store.deleteAll();
  }
}

/** A shared region's Durable Object (M32). */
export class RegionHost extends ObjectHost<RegionRoom, RegionConn> {
  private readonly store: RegionSqlStore;

  constructor(
    sql: Sql,
    sockets: () => HostSocket[],
    private readonly env: RoomEnv,
  ) {
    super(sockets);
    this.store = new RegionSqlStore(sql);
  }
  protected build(code: string): RegionRoom {
    return new RegionRoom(code, 'online', this.store, this.env);
  }
  protected storedCode(): string | null {
    return this.store.loadMeta()?.code ?? null;
  }
  protected idOf(tag: SocketTag | null): number | undefined {
    return tag?.slot;
  }
  protected makeConn(ws: HostSocket): RegionConn {
    return {
      send: (m) => ObjectHost.send(ws, m),
      close: (code, reason) => ws.close(code, reason),
      bind: (slot, v) => ws.setTag({ ...ws.tag(), slot, ...(v !== undefined ? { v } : {}) }),
      mayCreate: ws.tag()?.create === true,
    };
  }
  protected wipe(): void {
    this.store.deleteAll();
  }
}

/**
 * Peer-to-peer signalling's Durable Object: offers, answers and candidates passed between a host and
 * its guests, kept entirely on the sockets (tags), so it sleeps between messages and stores nothing.
 * Ids are random rather than counted (F8): no storage, and a late candidate can't reach a stranger
 * who was given a reused number. Each peer is rate limited as `Signal`'s are.
 */
export class SignalHost {
  private buckets = new Map<HostSocket, TokenBucket>();

  constructor(
    private readonly sockets: (tag?: string) => HostSocket[],
    private readonly now: () => number,
  ) {}

  /** Too many peers to take another. */
  get full(): boolean {
    return this.sockets().length >= MAX_PEERS;
  }

  /** An id no open socket has (accept the socket with it as its tag, then call `joined`). */
  newId(): number {
    for (;;) {
      const id = secureIndex(0x7fff_ffff) + 1;
      if (!this.sockets(String(id)).length) return id;
    }
  }

  private peers(): { ws: HostSocket; id: number; host: boolean }[] {
    return this.sockets().map((ws) => ({ ws, id: ws.tag()?.id ?? 0, host: ws.tag()?.host === true }));
  }

  joined(ws: HostSocket, id: number): void {
    ws.setTag({ id, host: false });
    const host = this.peers().find((p) => p.host)?.id ?? 0;
    ws.send(JSON.stringify({ t: 'you', id, host }));
  }

  message(ws: HostSocket, raw: string): void {
    if (raw.length > MAX_DATA + 200) return;
    let bucket = this.buckets.get(ws);
    if (!bucket) this.buckets.set(ws, (bucket = new TokenBucket(SIGNAL_RATE, SIGNAL_BURST, this.now())));
    const left = bucket.spend(this.now());
    if (left < -SIGNAL_BURST) return ws.close(4000, 'rate');
    if (left < 0) return;
    let m: { t?: unknown; to?: unknown; data?: unknown };
    try {
      m = JSON.parse(raw) as typeof m;
    } catch {
      return;
    }
    const me = { id: ws.tag()?.id ?? 0, host: ws.tag()?.host === true };
    const peers = this.peers();
    if (m.t === 'host' && !peers.some((p) => p.host)) {
      ws.setTag({ ...me, host: true });
      for (const p of peers) if (p.id !== me.id) p.ws.send(JSON.stringify({ t: 'host', id: me.id }));
    } else if (
      m.t === 'to' &&
      typeof m.to === 'number' &&
      typeof m.data === 'string' &&
      m.data.length <= MAX_DATA
    ) {
      for (const to of this.sockets(String(m.to)))
        to.send(JSON.stringify({ t: 'from', from: me.id, data: m.data }));
    }
  }

  closed(ws: HostSocket): void {
    this.buckets.delete(ws);
    const id = ws.tag()?.id;
    if (!id) return;
    for (const p of this.peers()) if (p.id !== id) p.ws.send(JSON.stringify({ t: 'gone', id }));
  }
}
