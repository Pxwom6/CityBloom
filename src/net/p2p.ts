/**
 * Peer-to-peer rooms (M30): the host's browser runs the room itself, and friends connect to it over
 * WebRTC data channels. Two ways to find each other:
 *
 * - through our relay's signalling (`/signal/CODE`), when online rooms are set up (and the local
 *   relay in development and tests);
 * - with no server of ours at all, through Trystero over public Nostr relays (DECISIONS, M30).
 *
 * Either way a peer-to-peer room is found by its code and its key (F2): the code alone, which anyone
 * watching the public relays could try one by one, finds nothing.
 *
 * Public STUN servers find a way through home routers; when two players still can't connect, the
 * guest is told so plainly, and what to try (an online room only when those are set up, F10).
 */
import { Room, MemoryStore, type Conn, type StoredSnapshot } from '../../relay/room';
import type { RegionConn, RegionRoom } from '../../relay/region';
import { dataChannelLink, loopbackPair, webSocketLink, type Link } from './link';
import { inOrder, numbered } from './order';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/**
 * The words a guest sees when no direct connection could be made (F10): an online room goes through a
 * server and works on any network, but only when online rooms are set up.
 */
export function p2pFailed(online: boolean): string {
  return online
    ? "Couldn't connect directly to the host's computer (some home and office networks block it). Ask them to host an online room instead: it goes through a server, so it works on any network."
    : "Couldn't connect directly to the host's computer (some home, school and office networks block it). Try another network (a phone's hotspot often works), or let a friend on a different network host.";
}

export const TRYSTERO_APP = 'citybloom-rooms-v1';

/**
 * The clock of a region room that runs in a browser (the host's page): real time, in whole
 * milliseconds since the epoch, that never goes back. `performance.now()` alone counts from the page's
 * load and has fractions, so the war history's times would be the host's uptime (and an online room's,
 * which is `Date.now()`, would look different from this one's).
 */
export function wallClock(): number {
  return Math.round(performance.timeOrigin + performance.now());
}

/**
 * How a peer-to-peer room's players find each other: our relay's signalling, or Trystero over public
 * Nostr relays (`relays` overrides Trystero's own list: tests use a relay on this computer).
 */
export type Signalling = { kind: 'relay'; url: string } | { kind: 'trystero'; relays?: string[] };

/** Trystero's room for a code and its key: the topic and the encryption both depend on the key (F2). */
function trysteroRoom(code: string, key: string, signalling: { relays?: string[] }) {
  return {
    config: {
      appId: TRYSTERO_APP,
      password: key,
      rtcConfig: { iceServers: ICE_SERVERS },
      ...(signalling.relays?.length ? { relayConfig: { urls: signalling.relays } } : {}),
    },
    room: `${code}-${key}`,
  };
}

/** What a host's browser runs for its guests: a room (co-op, M30) or a region (M32). */
export interface Hub<C> {
  open(conn: C): void;
  message(conn: C, raw: string): void;
  closed(conn: C): void;
}

/** Attach a link to a room or region as one more connection. */
export function attach<M>(
  hub: Hub<{ send(m: M): void; close(code: number, reason: string): void }>,
  link: Link,
) {
  const conn = { send: (m: M) => link.send(JSON.stringify(m)), close: () => link.close() };
  hub.open(conn);
  link.onmessage = (t) => hub.message(conn, t);
  link.onclose = () => hub.closed(conn);
  return conn;
}

/** Wait until ICE gathering is done (non-trickle: one offer or answer carries every candidate). */
function gathered(pc: RTCPeerConnection, ms = 4000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

/** The host's side: a room in this page, its own game on a loopback, guests over data channels. */
export class P2PHost {
  readonly room: Hub<Conn> | Hub<RegionConn>;
  private stops: (() => void)[] = [];
  /** Guests connected now (for the lobby). */
  guests = 0;

  constructor(
    readonly code: string,
    /** The room's key, which every guest's invite carries (F2). */
    readonly key: string,
    private readonly signalling: Signalling,
    /** Every snapshot the room keeps (the host's browser saves the city then, M31). */
    onSnapshot: ((s: StoredSnapshot) => void) | null = null,
    /** A shared region's hub instead of a co-op room (M32). */
    region: RegionRoom | null = null,
  ) {
    if (region) {
      this.room = region;
      return;
    }
    const store = new MemoryStore();
    if (onSnapshot) {
      const save = store.saveSnapshot.bind(store);
      store.saveSnapshot = (s) => {
        save(s);
        onSnapshot(s);
      };
    }
    this.room = new Room(code, 'p2p', store, { now: () => performance.now() });
  }

  /** The host's own game reaches the room through this. */
  connectSelf(): Promise<Link> {
    const [mine, theirs] = loopbackPair();
    attach(this.room as Hub<Conn>, theirs);
    return Promise.resolve(mine);
  }

  async listen(): Promise<void> {
    if (this.signalling.kind === 'relay') await this.listenRelay(this.signalling.url);
    else await this.listenTrystero(this.signalling);
  }

  /**
   * Stop hosting. The room or region shuts first and tells everyone why (F10); the connections go a
   * moment later, once the goodbyes have left.
   */
  close(
    text = 'The host closed the room: it ran in their browser. You keep a copy of the city to play on your own.',
  ): void {
    (this.room as { close?(text: string): void }).close?.(text);
    const stops = this.stops;
    this.stops = [];
    setTimeout(() => {
      for (const s of stops) s();
    }, 500);
  }

  private async listenRelay(url: string): Promise<void> {
    const sig = await webSocketLink(`${url}/signal/${this.code}`);
    this.stops.push(() => sig.close());
    const peers = new Map<number, RTCPeerConnection>();
    sig.onmessage = (text) => {
      const m = JSON.parse(text) as { t: string; from?: number; data?: string; id?: number };
      // (A guest leaves signalling once its data channel is open: that isn't it leaving the room.)
      if (m.t === 'gone' && m.id) peers.delete(m.id);
      if (m.t !== 'from' || !m.from || !m.data) return;
      const from = m.from;
      const d = JSON.parse(m.data) as { kind: string; sdp: string; key?: string };
      // Only guests with the whole invite are answered (F2): a code guessed on the relay isn't enough.
      if (d.kind !== 'offer' || d.key !== this.key) return;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peers.set(from, pc);
      pc.ondatachannel = (e) => {
        const link = dataChannelLink(e.channel);
        if (e.channel.readyState === 'open') attach(this.room as Hub<Conn>, link);
        else e.channel.addEventListener('open', () => attach(this.room as Hub<Conn>, link), { once: true });
        this.guests++;
        e.channel.addEventListener('close', () => {
          this.guests--;
          pc.close();
        });
      };
      void (async () => {
        await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        sig.send(
          JSON.stringify({
            t: 'to',
            to: from,
            data: JSON.stringify({ kind: 'answer', sdp: pc.localDescription!.sdp }),
          }),
        );
      })();
    };
    sig.send(JSON.stringify({ t: 'host' }));
  }

  private async listenTrystero(signalling: { relays?: string[] }): Promise<void> {
    const { joinRoom } = await import('trystero');
    const { config, room } = trysteroRoom(this.code, this.key, signalling);
    const t = joinRoom(config, room);
    this.stops.push(() => void t.leave());
    const msg = t.makeAction<string>('room');
    const hello = t.makeAction<string>('host');
    // Each guest's messages are numbered both ways, so Trystero can't reorder them (`order.ts`).
    type Entry = { link: Link; receive: (raw: unknown) => void; sending: Set<Promise<void>> };
    const links = new Map<string, Entry>();
    /**
     * A guest's connection ends. The room hears of it unless the room ended it itself (`why` null). A
     * guest that didn't leave is told, once what was sent to it before has gone, so its game reconnects
     * or stops as after any dropped connection (`viaTrystero`); one that can't be told loses its
     * connection.
     */
    const end = (peer: string, entry: Entry, why: string | null, tell: boolean) => {
      if (links.get(peer) !== entry) return;
      links.delete(peer);
      this.guests--;
      if (why !== null) entry.link.onclose?.(why);
      if (!tell) return;
      let wait: ReturnType<typeof setTimeout> | undefined;
      const sent = Promise.race([
        Promise.allSettled(entry.sending),
        new Promise((r) => (wait = setTimeout(r, 10_000))),
      ]);
      void sent.then(() => {
        clearTimeout(wait);
        hello.send('bye', { target: peer }).catch(() => t.getPeers()[peer]?.close());
      });
    };
    t.onPeerJoin = (peer) => {
      // (Trystero shouldn't announce a peer twice, but a second one starts afresh.)
      const old = links.get(peer);
      if (old) end(peer, old, 'joined again', false);
      hello.send('host', { target: peer }).catch(() => undefined);
      const entry: Entry = {
        link: {
          send: numbered((text) => {
            // Trystero gives up on a message it can't get through: the rest would wait behind it.
            const p = msg
              .send(text, { target: peer })
              .catch(() => end(peer, entry, 'a message was lost', true));
            entry.sending.add(p);
            void p.finally(() => entry.sending.delete(p));
          }),
          close: () => end(peer, entry, null, true),
          onmessage: null,
          onclose: null,
        },
        receive: inOrder(
          (text) => {
            if (links.get(peer) === entry) entry.link.onmessage?.(text);
          },
          (why) => end(peer, entry, why, true),
        ),
        sending: new Set(),
      };
      links.set(peer, entry);
      attach(this.room as Hub<Conn>, entry.link);
      this.guests++;
    };
    t.onPeerLeave = (peer) => {
      const entry = links.get(peer);
      if (entry) end(peer, entry, 'left', false);
    };
    msg.onMessage = (data, { peerId }) => links.get(peerId)?.receive(data);
  }
}

/** A guest's way to the host's room: resolves with a link once the data channel is open. */
export function p2pConnect(
  code: string,
  key: string,
  signalling: Signalling,
  timeoutMs = 20_000,
  /** Called once the host's browser has answered (F12: the boot screen says so). */
  onHost?: () => void,
): Promise<Link> {
  return signalling.kind === 'relay'
    ? viaRelay(code, key, signalling.url, timeoutMs, onHost)
    : viaTrystero(code, key, signalling, timeoutMs, onHost);
}

async function viaRelay(
  code: string,
  key: string,
  url: string,
  timeoutMs: number,
  onHost?: () => void,
): Promise<Link> {
  const sig = await webSocketLink(`${url}/signal/${code}`);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const dc = pc.createDataChannel('room', { ordered: true });
  const link = dataChannelLink(dc);
  return new Promise<Link>((resolve, reject) => {
    let host = 0;
    let done = false;
    const finish = (err: Error | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sig.close();
      if (err) {
        pc.close();
        reject(err);
      } else resolve(link);
    };
    const timer = setTimeout(
      () => finish(new Error(host ? p2pFailed(true) : 'No host is waiting with that code')),
      timeoutMs,
    );
    const offer = async () => {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      sig.send(
        JSON.stringify({
          t: 'to',
          to: host,
          data: JSON.stringify({ kind: 'offer', sdp: pc.localDescription!.sdp, key }),
        }),
      );
    };
    sig.onmessage = (text) => {
      const m = JSON.parse(text) as { t: string; host?: number; id?: number; from?: number; data?: string };
      if ((m.t === 'you' && m.host) || m.t === 'host') {
        if (host) return;
        host = m.t === 'you' ? m.host! : m.id!;
        onHost?.();
        void offer();
      } else if (m.t === 'from' && m.from === host && m.data) {
        const d = JSON.parse(m.data) as { kind: string; sdp: string };
        if (d.kind === 'answer') void pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
      }
    };
    dc.addEventListener('open', () => finish(null), { once: true });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') finish(new Error(p2pFailed(true)));
    });
  });
}

async function viaTrystero(
  code: string,
  key: string,
  signalling: { relays?: string[] },
  timeoutMs: number,
  onHost?: () => void,
): Promise<Link> {
  const { joinRoom } = await import('trystero');
  const { config, room } = trysteroRoom(code, key, signalling);
  const t = joinRoom(config, room, { onJoinError: () => undefined });
  const msg = t.makeAction<string>('room');
  const hello = t.makeAction<string>('host');
  return new Promise<Link>((resolve, reject) => {
    let host: string | null = null;
    let end: ((why: string) => void) | null = null;
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      void t.leave();
      reject(new Error(`${p2pFailed(false)} (Or no host is waiting with that code.)`));
    }, timeoutMs);
    hello.onMessage = (data, { peerId }) => {
      if (host !== null) {
        // The host let this guest go (`listenTrystero`). A second hello changes nothing.
        if (data === 'bye' && peerId === host) end?.('the host closed the connection');
        return;
      }
      if (data !== 'host' || late) return;
      host = peerId;
      clearTimeout(timer);
      onHost?.();
      // Numbered both ways, so Trystero can't reorder the room's messages (`order.ts`).
      let over = false;
      const link: Link = {
        send: numbered((text) => {
          // Trystero gives up on a message it can't get through: the rest would wait behind it.
          msg.send(text, { target: peerId }).catch(() => end?.('a message was lost'));
        }),
        close: () => {
          over = true;
          void t.leave();
        },
        onmessage: null,
        onclose: null,
      };
      // However the link ends, this Trystero room is left, so a reconnect starts with a fresh one.
      end = (why: string) => {
        if (over) return;
        over = true;
        link.onclose?.(why);
        void t.leave();
      };
      const receive = inOrder(
        (text) => {
          if (!over) link.onmessage?.(text);
        },
        (why) => end?.(why),
      );
      msg.onMessage = (data, { peerId: from }) => {
        if (from === host) receive(data);
      };
      t.onPeerLeave = (peer) => {
        if (peer === host) end?.('the host left');
      };
      resolve(link);
    };
  });
}
