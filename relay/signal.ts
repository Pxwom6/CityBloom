/**
 * Signalling for peer-to-peer rooms (M30): the host's browser and its guests swap WebRTC offers,
 * answers and candidates here, then talk directly. Holds nothing once they've gone; the city never
 * passes through it. Used by the local relay and the online Worker alike.
 *
 *   → { t: 'host' }                       I'm the room's host
 *   → { t: 'to', to: id, data }           pass `data` (a string) to another peer
 *   ← { t: 'you', id, host }              your id here, and the host's (0 if none yet)
 *   ← { t: 'host', id }                   the host has arrived
 *   ← { t: 'from', from: id, data }
 *   ← { t: 'gone', id }
 *
 * Each peer is rate limited (F8): a connection takes a few dozen messages, so a flood is dropped and
 * a torrent closed.
 */
import { TokenBucket } from './limits';

export interface SignalPeer {
  id: number;
  send: (text: string) => void;
  close?: () => void;
  bucket?: TokenBucket;
}

export const MAX_PEERS = 16;
export const MAX_DATA = 16_000;
/** Messages a second per peer, and a burst: past it they're dropped; past twice it, closed. */
export const SIGNAL_RATE = 5;
export const SIGNAL_BURST = 60;

export class Signal {
  private peers = new Map<number, SignalPeer>();
  private next = 1;
  private host = 0;

  constructor(private readonly env: { now(): number } = { now: () => Date.now() }) {}

  open(send: (text: string) => void, close?: () => void): SignalPeer {
    const p: SignalPeer = { id: this.next++, send, ...(close ? { close } : {}) };
    if (this.peers.size >= MAX_PEERS) {
      send(JSON.stringify({ t: 'error', text: 'Too many players are connecting at once' }));
      return p;
    }
    p.bucket = new TokenBucket(SIGNAL_RATE, SIGNAL_BURST, this.env.now());
    this.peers.set(p.id, p);
    send(JSON.stringify({ t: 'you', id: p.id, host: this.host }));
    return p;
  }

  message(p: SignalPeer, raw: string): void {
    if (!this.peers.has(p.id) || raw.length > MAX_DATA + 200) return;
    const left = p.bucket!.spend(this.env.now());
    if (left < -SIGNAL_BURST) {
      this.closed(p);
      return p.close?.();
    }
    if (left < 0) return;
    let m: { t?: unknown; to?: unknown; data?: unknown };
    try {
      m = JSON.parse(raw) as typeof m;
    } catch {
      return;
    }
    if (m.t === 'host' && !this.host) {
      this.host = p.id;
      for (const q of this.peers.values()) if (q !== p) q.send(JSON.stringify({ t: 'host', id: p.id }));
    } else if (
      m.t === 'to' &&
      typeof m.to === 'number' &&
      typeof m.data === 'string' &&
      m.data.length <= MAX_DATA
    ) {
      this.peers.get(m.to)?.send(JSON.stringify({ t: 'from', from: p.id, data: m.data }));
    }
  }

  closed(p: SignalPeer): void {
    if (!this.peers.delete(p.id)) return;
    if (this.host === p.id) this.host = 0;
    for (const q of this.peers.values()) q.send(JSON.stringify({ t: 'gone', id: p.id }));
  }

  get size(): number {
    return this.peers.size;
  }
}
