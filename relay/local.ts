/**
 * The local relay (M30): the room protocol on this computer, for development and tests with no
 * internet. Speaks exactly what the online rooms speak:
 *
 *   ws://localhost:8787/room/<CODE>    a room (the same Room class a Durable Object runs)
 *   ws://localhost:8787/signal/<CODE>  signalling for peer-to-peer (offers, answers, candidates)
 *
 * `npx tsx relay/local.ts [port] [--data dir]`: with --data, rooms are kept in files and survive a
 * restart, as online rooms survive everyone leaving.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, MemoryStore, type Conn, type RoomMeta, type StoredSnapshot } from './room';
import { CODE_ALPHABET, CODE_LENGTH } from './protocol';
import { Signal } from './signal';
import type { Stamped } from '../src/sim/lockstep';

/** A store kept in one JSON file per room (`--data`). */
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
  override appendEvent(e: Stamped) {
    super.appendEvent(e);
    this.flush();
  }
  override saveSnapshot(s: StoredSnapshot) {
    super.saveSnapshot(s);
    this.flush();
  }
}

const CODE = new RegExp(`^/(room|signal)/([${CODE_ALPHABET}]{${CODE_LENGTH}})$`);

export interface LocalRelay {
  server: Server;
  port: number;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

export function startRelay(port = 8787, dataDir: string | null = null): Promise<LocalRelay> {
  const rooms = new Map<string, Room>();
  const signals = new Map<string, Signal>();
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
      r = new Room(code, 'local', store, { now: () => Date.now(), random: Math.random });
      rooms.set(code, r);
    }
    return r;
  };
  wss.on('connection', (ws: WebSocket, req) => {
    const m = CODE.exec(new URL(req.url ?? '/', 'http://x').pathname);
    if (!m) return ws.close(4004, 'not found');
    const [, kind, code] = m;
    if (kind === 'signal') {
      let sig = signals.get(code!);
      if (!sig) signals.set(code!, (sig = new Signal()));
      const peer = sig.open((t) => ws.send(t));
      ws.on('message', (data) => sig.message(peer, String(data)));
      ws.on('close', () => sig.closed(peer));
      return;
    }
    const room = roomFor(code!);
    const conn: Conn = {
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: (c, reason) => ws.close(c, reason),
    };
    room.open(conn);
    ws.on('message', (data) => room.message(conn, String(data)));
    ws.on('close', () => room.closed(conn));
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        port: actual,
        rooms,
        close: () =>
          new Promise<void>((r) => {
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
  const dataAt = args.indexOf('--data');
  const port = Number(args.find((a, i) => /^\d+$/.test(a) && (dataAt < 0 || i !== dataAt + 1)) ?? 8787);
  void startRelay(port, dataAt >= 0 ? args[dataAt + 1]! : null).then((r) =>
    console.log(
      `Citybloom relay on ws://localhost:${r.port} (rooms at /room/CODE, signalling at /signal/CODE)`,
    ),
  );
}
