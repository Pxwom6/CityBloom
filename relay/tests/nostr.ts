/**
 * A Nostr relay on this computer for tests (F2): just enough of NIP-01 for Trystero, which finds
 * peers through public Nostr relays. No storage (Trystero's events are ephemeral) and no signature
 * checks (Trystero doesn't check them either); every event is kept in `events` for the test to read.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

export interface NostrEvent {
  id: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface LocalNostr {
  url: string;
  port: number;
  events: NostrEvent[];
  close(): Promise<void>;
}

type Filter = { kinds?: number[]; since?: number; '#x'?: string[] };

const matches = (f: Filter, e: NostrEvent) =>
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.since || e.created_at >= f.since) &&
  (!f['#x'] || e.tags.some((t) => t[0] === 'x' && f['#x']!.includes(t[1]!)));

export function startNostr(port = 0, host = '127.0.0.1'): Promise<LocalNostr> {
  const events: NostrEvent[] = [];
  const subs = new Map<WebSocket, Map<string, Filter>>();
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'access-control-allow-origin': '*' });
    res.end(req.url === '/health' ? 'nostr' : 'not found');
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('message', (raw) => {
      let m: unknown[];
      try {
        m = JSON.parse(String(raw)) as unknown[];
      } catch {
        return;
      }
      if (m[0] === 'REQ') {
        subs.get(ws)!.set(String(m[1]), m[2] as Filter);
        ws.send(JSON.stringify(['EOSE', m[1]]));
      } else if (m[0] === 'CLOSE') subs.get(ws)!.delete(String(m[1]));
      else if (m[0] === 'EVENT') {
        const e = m[1] as NostrEvent;
        events.push(e);
        ws.send(JSON.stringify(['OK', e.id, true, '']));
        for (const [c, s] of subs)
          for (const [id, f] of s) if (matches(f, e)) c.send(JSON.stringify(['EVENT', id, e]));
      }
    });
    ws.on('close', () => subs.delete(ws));
  });
  return new Promise((resolve) =>
    server.listen(port, host, () => {
      const p = (server.address() as { port: number }).port;
      resolve({
        url: `ws://${host}:${p}`,
        port: p,
        events,
        close: () =>
          new Promise<void>((r) => {
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => r());
          }),
      });
    }),
  );
}

/** The topic Trystero announces a room under (SHA-1 of its name, each byte in base 36). */
export function trysteroTopic(appId: string, room: string): string {
  return [...createHash('sha1').update(`Trystero@${appId}@${room}`).digest()]
    .map((b) => b.toString(36))
    .join('');
}
