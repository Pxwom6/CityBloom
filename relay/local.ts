/**
 * The local relay (M30): the room protocol on this computer, for development and tests with no
 * internet. Speaks exactly what the online rooms speak:
 *
 *   ws://localhost:8787/room/<CODE>[?create=1]    a room (the same Room class a Durable Object runs)
 *   ws://localhost:8787/region/<CODE>[?create=1]  a shared region (M32)
 *   ws://localhost:8787/signal/<CODE>             signalling for peer-to-peer (offers, answers, candidates)
 *
 * `npx tsx relay/local.ts [port] [--data dir] [--ttl days]`: with --data, rooms are kept in files and
 * survive a restart, as online rooms survive everyone leaving. Run so (as `npm run relay` and the e2e
 * tests run it), it holds to the online Worker's rules (F8): rooms and regions are made only on a
 * socket opened with `?create=1`, and their codes start with a digit, signalling's with a letter.
 * Rooms and regions nobody comes back to are forgotten after `--ttl` days (60), empty signalling at
 * once.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  Room,
  MemoryStore,
  type Conn,
  type RoomEnv,
  type RoomLimits,
  type RoomMeta,
  type StoredSnapshot,
} from './room';
import { CODE_ALPHABET, CODE_LENGTH } from './protocol';
import { Signal } from './signal';
import { RegionRoom, MemoryRegionStore, type RegionConn } from './region';
import { route, type Route } from './objects';
import { DAY_MS } from './limits';
import type { Stamped } from '../src/sim/lockstep';

/** A store kept in one JSON file per room (`--data`), rewritten per batch of events. */
class FileStore extends MemoryStore {
  constructor(private readonly file: string) {
    super();
    if (existsSync(file)) {
      const d = JSON.parse(readFileSync(file, 'utf8')) as {
        meta: RoomMeta | null;
        events: Stamped[];
        snapshot: StoredSnapshot | null;
      };
      this.meta = d.meta;
      this.events = d.events;
      this.snapshot = d.snapshot;
    }
  }
  private flush() {
    writeFileSync(
      this.file,
      JSON.stringify({ meta: this.meta, events: this.events, snapshot: this.snapshot }),
    );
  }
  override saveMeta(meta: RoomMeta) {
    super.saveMeta(meta);
    this.flush();
  }
  override appendEvents(list: Stamped[]) {
    super.appendEvents(list);
    this.flush();
  }
  override saveSnapshot(s: StoredSnapshot) {
    super.saveSnapshot(s);
    this.flush();
  }
  override deleteAll() {
    super.deleteAll();
    rmSync(this.file, { force: true });
  }
}

const ANY_CODE = new RegExp(`^/(room|signal|region)/([${CODE_ALPHABET}]{${CODE_LENGTH}})$`);
const SWEEP_EVERY = 10 * 60_000;

/** The clock, and timers for rooms' and regions' batches that don't keep the process alive. */
const timers: RoomEnv = {
  now: () => Date.now(),
  later: (ms, fn) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return () => clearTimeout(t);
  },
};

export interface RelayOptions {
  /**
   * Hold to the online Worker's rules (F8): make rooms and regions only on a socket opened with
   * `?create=1`, and take each kind of code only for its own kind. The command line does; tests and
   * scripts that make rooms over plain sockets leave it off.
   */
  strict?: boolean;
  /** How long rooms and regions nobody comes back to are kept (ms). */
  ttl?: number;
  /** Rooms' message limits (tests' headless players may report faster than a game). */
  limits?: Partial<RoomLimits>;
}

export interface LocalRelay {
  server: Server;
  port: number;
  rooms: Map<string, Room>;
  regions: Map<string, RegionRoom>;
  signals: Map<string, Signal>;
  /** Forget rooms and regions that have expired by `now`, and any left holding nothing. */
  sweep(now?: number): void;
  close(): Promise<void>;
}

export function startRelay(
  port = 8787,
  dataDir: string | null = null,
  opts: RelayOptions = {},
): Promise<LocalRelay> {
  const rooms = new Map<string, Room>();
  const stores = new Map<Room, MemoryStore>();
  const signals = new Map<string, Signal>();
  const regions = new Map<string, RegionRoom>();
  const regionStores = new Map<RegionRoom, MemoryRegionStore>();
  const ttl = opts.ttl !== undefined ? { ttl: opts.ttl } : {};
  const server = createServer((req, res) => {
    // A health check for scripts, and nothing else over plain HTTP.
    res.writeHead(req.url === '/health' ? 200 : 404, {
      'content-type': 'text/plain',
      'access-control-allow-origin': '*',
    });
    res.end(req.url === '/health' ? 'citybloom relay' : 'not found');
  });
  const wss = new WebSocketServer({ server, maxPayload: 1 << 20 });
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const roomFor = (code: string) => {
    let r = rooms.get(code);
    if (!r) {
      const store = dataDir ? new FileStore(join(dataDir, `${code}.json`)) : new MemoryStore();
      r = new Room(code, 'local', store, timers, { ...opts.limits, ...ttl });
      rooms.set(code, r);
      stores.set(r, store);
    }
    return r;
  };
  const regionFor = (code: string) => {
    let r = regions.get(code);
    if (!r) {
      const store = new MemoryRegionStore();
      r = new RegionRoom(code, 'local', store, timers, ttl);
      regions.set(code, r);
      regionStores.set(r, store);
    }
    return r;
  };
  /** Drop a room or region from memory once it holds nothing and nobody is connected. */
  const tidy = (code: string) => {
    const room = rooms.get(code);
    if (room && !room.exists && !room.connections) {
      rooms.delete(code);
      stores.delete(room);
    }
    const reg = regions.get(code);
    if (reg && !reg.exists && !reg.connections) {
      regions.delete(code);
      regionStores.delete(reg);
    }
  };
  const loose = (pathname: string): Route | null => {
    const m = ANY_CODE.exec(pathname);
    return m ? { kind: m[1] as Route['kind'], code: m[2]!, create: true } : null;
  };

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const r = opts.strict ? route(url.pathname, url.search) : loose(url.pathname);
    if (!r) return ws.close(4004, 'not found');
    const { kind, code } = r;
    const mayCreate = opts.strict ? { mayCreate: r.create } : {};
    if (kind === 'region') {
      const reg = regionFor(code);
      const conn: RegionConn = {
        send: (msg) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
        },
        close: (c, reason) => ws.close(c, reason),
        ...mayCreate,
      };
      reg.open(conn);
      ws.on('message', (data) => reg.message(conn, String(data)));
      ws.on('close', () => {
        reg.closed(conn);
        tidy(code);
      });
      return;
    }
    if (kind === 'signal') {
      let sig = signals.get(code);
      if (!sig) signals.set(code, (sig = new Signal()));
      const s = sig;
      const peer = s.open(
        (t) => {
          if (ws.readyState === ws.OPEN) ws.send(t);
        },
        () => ws.close(4000, 'rate'),
      );
      ws.on('message', (data) => s.message(peer, String(data)));
      ws.on('close', () => {
        s.closed(peer);
        if (signals.get(code) === s && !s.size) signals.delete(code);
      });
      return;
    }
    const room = roomFor(code);
    const conn: Conn = {
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: (c, reason) => ws.close(c, reason),
      ...mayCreate,
    };
    room.open(conn);
    ws.on('message', (data) => room.message(conn, String(data)));
    ws.on('close', () => {
      room.closed(conn);
      tidy(code);
    });
  });

  const sweep = (now = Date.now()) => {
    for (const [code, room] of rooms) {
      const at = room.expiresAt();
      if (at !== null && at <= now) {
        stores.get(room)?.deleteAll();
        rooms.delete(code);
        stores.delete(room);
      } else tidy(code);
    }
    for (const [code, reg] of regions) {
      const at = reg.expiresAt();
      if (at !== null && at <= now) {
        regionStores.get(reg)?.deleteAll();
        regions.delete(code);
        regionStores.delete(reg);
      } else tidy(code);
    }
    for (const [code, sig] of signals) if (!sig.size) signals.delete(code);
  };
  const sweeper = setInterval(() => sweep(), SWEEP_EVERY);
  sweeper.unref();

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        port: actual,
        rooms,
        regions,
        signals,
        sweep,
        close: () =>
          new Promise<void>((r) => {
            clearInterval(sweeper);
            // Events still waiting for their batch are written before the relay goes.
            for (const room of rooms.values()) room.flush();
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => r());
          }),
      });
    });
  });
}

if (process.argv[1]?.endsWith('local.ts')) {
  const args = process.argv.slice(2);
  const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1]! : null);
  const days = option('--ttl');
  const port = Number(
    args.find((a, i) => /^\d+$/.test(a) && !['--data', '--ttl'].includes(args[i - 1] ?? '')) ?? 8787,
  );
  void startRelay(port, option('--data'), {
    strict: true,
    ...(days ? { ttl: Number(days) * DAY_MS } : {}),
  }).then((r) => {
    console.log(
      `Citybloom relay on ws://localhost:${r.port} (rooms at /room/CODE, signalling at /signal/CODE)`,
    );
    const stop = () => void r.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
