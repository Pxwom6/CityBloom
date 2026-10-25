/**
 * The online relay (M30): a Cloudflare Worker with one Durable Object per room, on the free plan.
 *
 *   wss://<relay>/room/<CODE>[?create=1]    a room (the same Room class the local relay runs)
 *   wss://<relay>/region/<CODE>[?create=1]  a shared region (M32)
 *   wss://<relay>/signal/<CODE>             signalling for peer-to-peer rooms
 *
 * Rooms use the WebSocket Hibernation API, so a room nobody is talking to costs nothing; their
 * SQLite storage keeps the city between sessions (the latest snapshot and the events since). The
 * pings players send while idle are answered without waking the room. What each object does is in
 * `relay/objects.ts` (F8), so tests run it without Cloudflare; this file only connects it to the
 * runtime. A room or region nobody has come back to for 60 days deletes itself on an alarm.
 * Deployed from `main` by `.github/workflows/relay.yml`.
 */
import { DurableObject } from 'cloudflare:workers';
import { RegionHost, RoomHost, SignalHost, route, type HostSocket, type SocketTag } from './objects';
import type { RoomEnv } from './room';

interface Env {
  ROOMS: DurableObjectNamespace;
  SIGNALS: DurableObjectNamespace;
  REGIONS: DurableObjectNamespace;
  /** Comma-separated origins allowed to connect (the site); empty allows any (development). */
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health')
      return new Response('citybloom relay', { headers: { 'access-control-allow-origin': '*' } });
    const r = route(url.pathname, url.search);
    if (!r) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket')
      return new Response('expected a WebSocket', { status: 426 });
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = req.headers.get('Origin') ?? '';
    if (allowed.length && !allowed.includes(origin)) return new Response('forbidden', { status: 403 });
    const ns = r.kind === 'room' ? env.ROOMS : r.kind === 'region' ? env.REGIONS : env.SIGNALS;
    return ns.get(ns.idFromName(r.code)).fetch(req);
  },
};

/**
 * The clock, and a timer for the batch of events a room holds: a pending timer keeps the object
 * awake, so nothing waiting to be written is lost to hibernation.
 */
const timers: RoomEnv = {
  now: () => Date.now(),
  later: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

/** The runtime's sockets as the objects see them: one wrapper per socket while the object is awake. */
class Sockets {
  private wrapped = new WeakMap<CfWebSocket, HostSocket>();

  constructor(private readonly ctx: DurableObjectState) {}

  of(ws: CfWebSocket): HostSocket {
    let h = this.wrapped.get(ws);
    if (!h)
      this.wrapped.set(
        ws,
        (h = {
          send: (text) => ws.send(text),
          close: (code, reason) => ws.close(code, reason),
          tag: () => ws.deserializeAttachment() as SocketTag | null,
          setTag: (t) => ws.serializeAttachment(t),
        }),
      );
    return h;
  }

  list = (tag?: string): HostSocket[] =>
    (tag === undefined ? this.ctx.getWebSockets() : this.ctx.getWebSockets(tag)).map((ws) => this.of(ws));
}

/** A room's or region's object: its sockets, its SQLite, and the alarm that forgets it. */
abstract class Hosting extends DurableObject<Env> {
  protected readonly sockets: Sockets;
  protected abstract readonly host: RoomHost | RegionHost;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sockets = new Sockets(ctx);
    // Idle players' pings are answered without waking the object (no duration billed).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const r = route(url.pathname, url.search);
    if (!r) return new Response('not found', { status: 404 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    this.host.accept(this.sockets.of(pair[1]), r.code, r.create);
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  async webSocketMessage(ws: CfWebSocket, msg: string | ArrayBuffer): Promise<void> {
    this.host.message(this.sockets.of(ws), typeof msg === 'string' ? msg : '');
  }

  async webSocketClose(ws: CfWebSocket): Promise<void> {
    const at = this.host.closed(this.sockets.of(ws));
    // The last to leave sets the alarm (one at a time: when it rings, it looks again).
    if (at !== null && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(at);
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  override async alarm(): Promise<void> {
    const next = this.host.alarm(Date.now());
    if (next === 'forget') {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    } else if (next !== null) await this.ctx.storage.setAlarm(next);
  }
}

export class RoomObject extends Hosting {
  protected readonly host = new RoomHost(this.ctx.storage.sql, this.sockets.list, timers);
}

export class RegionObject extends Hosting {
  protected readonly host = new RegionHost(this.ctx.storage.sql, this.sockets.list, timers);
}

/** Peer-to-peer signalling (`SignalHost`): nothing in storage, so it hibernates between messages too. */
export class SignalObject extends DurableObject<Env> {
  private readonly sockets: Sockets;
  private readonly hub: SignalHost;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.sockets = new Sockets(ctx);
    this.hub = new SignalHost(this.sockets.list, () => Date.now());
  }

  async fetch(): Promise<Response> {
    if (this.hub.full) return new Response('too many', { status: 429 });
    const pair = new WebSocketPair();
    const id = this.hub.newId();
    this.ctx.acceptWebSocket(pair[1], [String(id)]);
    this.hub.joined(this.sockets.of(pair[1]), id);
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  async webSocketMessage(ws: CfWebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw === 'string') this.hub.message(this.sockets.of(ws), raw);
  }

  async webSocketClose(ws: CfWebSocket): Promise<void> {
    this.hub.closed(this.sockets.of(ws));
  }
}
