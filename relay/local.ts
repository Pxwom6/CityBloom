/**
 * The local relay (M30): the room protocol on this computer, for development and tests with no
 * internet. Speaks exactly what the online rooms speak:
 *
 *   ws://127.0.0.1:8787/room/<CODE>[?create=1]    a room (the same Room class a Durable Object runs)
 *   ws://127.0.0.1:8787/region/<CODE>[?create=1]  a shared region (M32)
 *   ws://127.0.0.1:8787/signal/<CODE>             signalling for peer-to-peer (offers, answers, candidates)
 *
 * `npx tsx relay/local.ts [port] [--data dir] [--ttl days] [--host addr] [--atom-prep seconds] [--test-matches] [--owner-key key] [--board-every seconds] [--test-clock]`: it listens on this computer
 * only unless `--host` says otherwise (0.0.0.0 to try a phone on the same network). With --data, rooms
 * are kept in files and survive a restart, as online rooms survive everyone leaving. Run so (as `npm run relay` and the e2e
 * tests run it), it holds to the online Worker's rules (F8): rooms and regions are made only on a
 * socket opened with `?create=1`, and their codes start with a digit, signalling's with a letter.
 * Rooms and regions nobody comes back to are forgotten after `--ttl` days (60), empty signalling at
 * once. `--atom-prep` shortens the region's wait before it keeps a friend's atom strike (20 minutes
 * online), for the end-to-end tests (M40 step 12), and `--test-matches` lets a quick match be one
 * minute long (M43); `--board-every` shortens the challenge board's wait between one address's
 * scores (3 minutes) and `--test-clock` lets the tests move the board's clock (`POST /__clock`, M44);
 * the Worker online has none of these switches. It also
 * serves the report desk and the owner area over plain HTTP (M41, `relay/reportsHttp.ts`), with the
 * owner key from `--owner-key` or OWNER_KEY; reports are kept in memory, or under `--data`.
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
import { RegionRoom, MemoryRegionStore, type RegionConn, type RegionLimits } from './region';
import { route, type Route } from './objects';
import { DAY_MS } from './limits';
import type { Stamped } from '../src/sim/lockstep';
import { ReportDesk, REPORT_LIMITS } from './reportDesk';
import { corsHeaders, reportsHttp } from './reportsHttp';
import { REPORT_CAPS } from './reports';
import { ChallengeBoard, BOARD_LIMITS } from './challengeBoard';
import { challengeHttp, isBoardPath } from './challengeHttp';
import { SubmissionsDesk, SUBMIT_LIMITS } from './submissions';
import { isSubmitPath, submissionsHttp } from './submissionsHttp';
import { nodeSql } from './nodeSql';

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
  /**
   * Regions' limits (M40 step 12): the e2e's relay shortens the wait before a friend's atom strike is
   * kept (`atomPrep`, 20 real minutes online) with `--atom-prep`; nothing else sets them.
   */
  regionLimits?: Partial<RegionLimits>;
  /**
   * The address to listen on: this computer only (127.0.0.1) unless told otherwise, e.g. 0.0.0.0 to
   * try a phone on the same network (review, minor).
   */
  host?: string;
  /**
   * The owner key for the owner area (M41): `--owner-key`, or OWNER_KEY in the environment. Without
   * one the owner area says it isn't set up, and reports are still taken.
   */
  ownerKey?: string;
  /** The report desk's caps (tests make them small). */
  reportLimits?: Partial<typeof REPORT_LIMITS>;
  /** The weekly challenge's board's limits (M44; tests make them small), and a clock to read it by (tests move it). */
  boardLimits?: Partial<typeof BOARD_LIMITS>;
  /** The submissions desk's limits (M48; tests make them small). */
  submitLimits?: Partial<typeof SUBMIT_LIMITS>;
  /**
   * Test builds' relays only (`--test-clock`): the board's clock can be moved with
   * `POST /__clock {"at": ms}` (the week rolling over in the end-to-end tests, M44).
   */
  testClock?: boolean;
  clock?: () => number;
}

export interface LocalRelay {
  server: Server;
  port: number;
  rooms: Map<string, Room>;
  regions: Map<string, RegionRoom>;
  signals: Map<string, Signal>;
  /** The report desk (M41). */
  reports: ReportDesk;
  /** The weekly challenge's board (M44). */
  board: ChallengeBoard;
  /** Forget rooms and regions that have expired by `now`, and any left holding nothing. */
  sweep(now?: number): void;
  close(): Promise<void>;
}

/** The report desk in Node's SQLite: in memory, or in `reports.sqlite` under `--data`. */
async function reportStore(
  dataDir: string | null,
  limits?: Partial<typeof REPORT_LIMITS>,
): Promise<ReportDesk> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = await nodeSql(dataDir ? join(dataDir, 'reports.sqlite') : ':memory:');
  return new ReportDesk(db.sql, Date.now(), { ...REPORT_LIMITS, ...limits });
}

export async function startRelay(
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
  const reports = await reportStore(dataDir, opts.reportLimits);
  // The weekly challenge's board (M44), in Node's SQLite like the report desk.
  const boardDb = await nodeSql(dataDir ? join(dataDir, 'challenges.sqlite') : ':memory:');
  const board = new ChallengeBoard(boardDb.sql, Date.now(), { ...BOARD_LIMITS, ...opts.boardLimits });
  // Ideas and buildings players send in (M48), in Node's SQLite like the board.
  const submitDb = await nodeSql(dataDir ? join(dataDir, 'submissions.sqlite') : ':memory:');
  const submissions = new SubmissionsDesk(submitDb.sql, Date.now(), {
    ...SUBMIT_LIMITS,
    ...opts.submitLimits,
  });
  let clockShift = 0;
  const boardNow = () => (opts.clock?.() ?? Date.now()) + clockShift;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const cors = corsHeaders(String(req.headers.origin ?? ''), []) ?? {};
    const send = (status: number, body: string, type = 'text/plain') => {
      res.writeHead(status, { 'content-type': type, ...cors });
      res.end(body);
    };
    if (url.pathname === '/health') return send(200, 'citybloom relay');
    if (req.method === 'OPTIONS') return send(204, '');
    const request = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      header: (n: string) => {
        const v = req.headers[n.toLowerCase()];
        return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
      },
      text: () =>
        new Promise<string>((resolve, reject) => {
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (c: string) => {
            body += c;
            if (body.length > BOARD_LIMITS.body) {
              req.pause();
              resolve(body);
            }
          });
          req.on('end', () => resolve(body));
          req.on('error', reject);
        }),
      address: req.socket.remoteAddress ?? '',
    };
    // A test relay's clock for the board (M44): where it reads now, or set it.
    if (opts.testClock && url.pathname === '/__clock') {
      if (req.method === 'POST')
        void request.text().then((t) => {
          // A time to read the board's clock at from now on, or anything else: the real time again.
          const at = (JSON.parse(t || '{}') as { at?: unknown }).at;
          clockShift =
            typeof at === 'number' && Number.isFinite(at) ? at - (opts.clock?.() ?? Date.now()) : 0;
          send(200, JSON.stringify({ now: boardNow() }), 'application/json');
        });
      else send(200, JSON.stringify({ now: boardNow() }), 'application/json');
      return;
    }
    // Submissions and their owner pages (M48), as the Worker serves them (bodies up to a model's size).
    if (isSubmitPath(url.pathname)) {
      const big = {
        ...request,
        text: () =>
          new Promise<string>((resolve, reject) => {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', (c: string) => {
              body += c;
              if (body.length > SUBMIT_LIMITS.body) {
                req.pause();
                resolve(body);
              }
            });
            req.on('end', () => resolve(body));
            req.on('error', reject);
          }),
      };
      void submissionsHttp(big, submissions, opts.ownerKey, boardNow()).then(
        (r) => (r ? send(r.status, JSON.stringify(r.json), 'application/json') : send(404, 'not found')),
        () => send(500, 'error'),
      );
      return;
    }
    // The weekly challenge's board and its owner pages (M44), as the Worker serves them.
    if (isBoardPath(url.pathname)) {
      void challengeHttp(request, board, opts.ownerKey, boardNow()).then(
        (r) => (r ? send(r.status, JSON.stringify(r.json), 'application/json') : send(404, 'not found')),
        () => send(500, 'error'),
      );
      return;
    }
    // The report desk and the owner area (M41), as the Worker serves them.
    void reportsHttp(
      {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        header: (n) => {
          const v = req.headers[n.toLowerCase()];
          return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
        },
        text: () =>
          new Promise((resolve, reject) => {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', (c: string) => {
              body += c;
              // Past the cap the rest isn't read (the desk refuses it as too big).
              if (body.length > REPORT_CAPS.body) {
                req.pause();
                resolve(body);
              }
            });
            req.on('end', () => resolve(body));
            req.on('error', reject);
          }),
        address: req.socket.remoteAddress ?? '',
      },
      reports,
      opts.ownerKey,
      Date.now(),
    ).then(
      (r) => (r ? send(r.status, JSON.stringify(r.json), 'application/json') : send(404, 'not found')),
      () => send(500, 'error'),
    );
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
      r = new RegionRoom(code, 'local', store, timers, { ...opts.regionLimits, ...ttl });
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
  const sweeper = setInterval(() => {
    sweep();
    reports.sweep(Date.now());
  }, SWEEP_EVERY);
  sweeper.unref();

  return new Promise((resolve) => {
    server.listen(port, opts.host ?? '127.0.0.1', () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        port: actual,
        rooms,
        regions,
        signals,
        reports,
        board,
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
  const host = option('--host') ?? '127.0.0.1';
  const prep = option('--atom-prep');
  const every = option('--board-every');
  const ownerKey = option('--owner-key') ?? process.env.OWNER_KEY ?? undefined;
  const port = Number(
    args.find(
      (a, i) =>
        /^\d+$/.test(a) &&
        !['--data', '--ttl', '--host', '--atom-prep', '--owner-key', '--board-every'].includes(
          args[i - 1] ?? '',
        ),
    ) ?? 8787,
  );
  void startRelay(port, option('--data'), {
    strict: true,
    host,
    ...(days ? { ttl: Number(days) * DAY_MS } : {}),
    regionLimits: {
      ...(prep ? { atomPrep: Number(prep) * 1000 } : {}),
      ...(args.includes('--test-matches') ? { testMatches: true } : {}),
    },
    ...(ownerKey ? { ownerKey } : {}),
    ...(every ? { boardLimits: { scoreEvery: Number(every) * 1000 } } : {}),
    ...(args.includes('--test-clock') ? { testClock: true } : {}),
  }).then((r) => {
    console.log(
      `Citybloom relay on ws://${host}:${r.port} (rooms at /room/CODE, signalling at /signal/CODE)`,
    );
    const stop = () => void r.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
