import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * How a Trystero link ends (multiplayer review). The host's side tells a guest it lets go, so the
 * guest's game reconnects rather than wait on a link nothing comes down; a message Trystero gives up
 * on ends the link instead of holding everything behind it; and a guest leaves its Trystero room
 * however its link ends, so a reconnect starts afresh. Trystero itself is a stand-in here: rooms
 * joined in this process find each other by name.
 */

type Handler = (data: string, ctx: { peerId: string }) => void;

class FakeRoom {
  static all: FakeRoom[] = [];
  static nextId = 1;
  /** Messages that fail to send, as Trystero rejects one it can't get through. */
  static refuse: (ns: string, data: string, from: string) => boolean = () => false;
  readonly id = `peer${FakeRoom.nextId++}`;
  left = false;
  closedPeers: string[] = [];
  handlers = new Map<string, Handler | null>();
  onPeerJoin: ((peer: string) => void) | null = null;
  onPeerLeave: ((peer: string) => void) | null = null;
  static met = new Set<string>();
  constructor(readonly name: string) {
    // Others in the room meet this one (once a pair) after its handlers are set.
    setTimeout(() => {
      for (const o of FakeRoom.all) {
        const pair = [o.id, this.id].sort().join('+');
        if (o === this || o.name !== name || o.left || this.left || FakeRoom.met.has(pair)) continue;
        FakeRoom.met.add(pair);
        o.onPeerJoin?.(this.id);
        this.onPeerJoin?.(o.id);
      }
    }, 0);
    FakeRoom.all.push(this);
  }
  makeAction<T>(ns: string) {
    const room = this as FakeRoom;
    room.handlers.set(ns, null);
    return {
      send(data: T, opts?: { target?: string }): Promise<void> {
        if (room.left) return Promise.reject(new Error('room left'));
        if (FakeRoom.refuse(ns, String(data), room.id))
          return Promise.reject(new Error('transfer timed out'));
        const to = FakeRoom.all.find((o) => o.id === opts?.target && !o.left);
        if (!to) return Promise.reject(new Error('no peer'));
        return new Promise((resolve) =>
          setTimeout(() => {
            if (!to.left) to.handlers.get(ns)?.(String(data), { peerId: room.id });
            resolve();
          }, 0),
        );
      },
      set onMessage(h: Handler | null) {
        room.handlers.set(ns, h);
      },
      get onMessage(): Handler | null {
        return room.handlers.get(ns) ?? null;
      },
    };
  }
  leave(): Promise<void> {
    if (!this.left) {
      this.left = true;
      for (const o of FakeRoom.all) if (o.name === this.name && !o.left) o.onPeerLeave?.(this.id);
    }
    return Promise.resolve();
  }
  getPeers(): Record<string, { close(): void }> {
    const peers: Record<string, { close(): void }> = {};
    for (const o of FakeRoom.all)
      if (o !== this && o.name === this.name && !o.left)
        peers[o.id] = { close: () => this.closedPeers.push(o.id) };
    return peers;
  }
}

vi.mock('trystero', () => ({
  joinRoom: (_config: unknown, name: string) => new FakeRoom(name),
}));

const { P2PHost, p2pConnect } = await import('../src/net/p2p');

const settle = () => new Promise((r) => setTimeout(r, 5));
async function settled(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await settle();
}

/** A guest that speaks Trystero by hand, to say what the game's own side never would. */
function rawGuest(code: string, key: string) {
  const room = new FakeRoom(`${code}-${key}`);
  const msg = room.makeAction<string>('room');
  const hello = room.makeAction<string>('host');
  const fromHost: string[] = [];
  const hellos: string[] = [];
  msg.onMessage = (d) => fromHost.push(d);
  hello.onMessage = (d) => hellos.push(d);
  // (What a hand-made side sends may go nowhere once the other side has gone.)
  const put = (action: typeof msg, data: string, target: string) =>
    void action.send(data, { target }).catch(() => undefined);
  return { room, msg, hello, fromHost, hellos, put };
}

afterEach(() => {
  FakeRoom.all = [];
  FakeRoom.met.clear();
  FakeRoom.refuse = () => false;
});

describe('a Trystero link ends cleanly on both sides', () => {
  it("a guest whose messages the host can't put in order is told, and the room hears it left", async () => {
    const host = new P2PHost('ABCDEF', 'KEYKEYKEYKEY', { kind: 'trystero' });
    const closed = vi.spyOn(host.room as { closed(c: unknown): void }, 'closed');
    await host.listen();
    const g = rawGuest('ABCDEF', 'KEYKEYKEYKEY');
    await settled();
    expect(g.hellos).toEqual(['host']);
    expect(host.guests).toBe(1);
    g.put(g.msg, '{"t":"hello"}', FakeRoom.all[0].id);
    await settled();
    expect(g.hellos).toEqual(['host', 'bye']);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(host.guests).toBe(0);
  });

  it('a guest the room turns away gets the reason, then is told to go', async () => {
    const host = new P2PHost('ABCDEF', 'KEYKEYKEYKEY', { kind: 'trystero' });
    await host.listen();
    const g = rawGuest('ABCDEF', 'KEYKEYKEYKEY');
    await settled();
    // Numbered, but nothing the room can read: it answers with an error and closes the connection.
    g.put(g.msg, '0:not json', FakeRoom.all[0].id);
    await settled();
    expect(g.fromHost.map((m) => m.replace(/^\d+:/, '')).map((m) => JSON.parse(m) as { t: string })).toEqual([
      expect.objectContaining({ t: 'error' }),
    ]);
    expect(g.hellos).toEqual(['host', 'bye']);
    expect(host.guests).toBe(0);
  });

  it('a message Trystero gives up on ends the link on the host, and the guest is told', async () => {
    const host = new P2PHost('ABCDEF', 'KEYKEYKEYKEY', { kind: 'trystero' });
    const closed = vi.spyOn(host.room as { closed(c: unknown): void }, 'closed');
    await host.listen();
    const g = rawGuest('ABCDEF', 'KEYKEYKEYKEY');
    await settled();
    const hostId = FakeRoom.all[0].id;
    FakeRoom.refuse = (ns, _data, from) => ns === 'room' && from === hostId;
    g.put(g.msg, '0:not json', hostId);
    await settled();
    expect(closed).toHaveBeenCalled();
    expect(host.guests).toBe(0);
    FakeRoom.refuse = () => false;
    await settled();
    expect(g.hellos).toEqual(['host', 'bye']);
  });

  it('a host that can’t tell a guest closes its connection', async () => {
    const host = new P2PHost('ABCDEF', 'KEYKEYKEYKEY', { kind: 'trystero' });
    await host.listen();
    const g = rawGuest('ABCDEF', 'KEYKEYKEYKEY');
    await settled();
    const hostId = FakeRoom.all[0].id;
    FakeRoom.refuse = (_ns, _data, from) => from === hostId;
    g.put(g.msg, 'nonumber', hostId);
    await settled();
    expect(FakeRoom.all[0].closedPeers).toEqual([g.room.id]);
  });

  it('the game’s side: told to go, the link closes and the Trystero room is left', async () => {
    const h = rawGuest('ABCDEF', 'KEYKEYKEYKEY'); // a host by hand this time
    const joining = p2pConnect('ABCDEF', 'KEYKEYKEYKEY', { kind: 'trystero' }, 5000);
    h.room.onPeerJoin = (peer) => h.put(h.hello, 'host', peer);
    await settled();
    const link = await joining;
    const guestRoom = FakeRoom.all[1];
    const why: string[] = [];
    link.onclose = (w) => why.push(w ?? '');
    const got: string[] = [];
    link.onmessage = (t) => got.push(t);
    // A second hello (Trystero reconnecting by itself) changes nothing.
    h.put(h.hello, 'host', guestRoom.id);
    h.put(h.msg, '0:{"t":"pong"}', guestRoom.id);
    await settled();
    expect(got).toEqual(['{"t":"pong"}']);
    expect(why).toEqual([]);
    h.put(h.hello, 'bye', guestRoom.id);
    h.put(h.msg, '1:{"t":"late"}', guestRoom.id);
    await settled();
    expect(why).toEqual(['the host closed the connection']);
    expect(got).toEqual(['{"t":"pong"}']);
    expect(guestRoom.left).toBe(true);
  });

  it('the game’s side: when the host leaves, the Trystero room is left too', async () => {
    const h = rawGuest('ABCDEF', 'KEYKEYKEYKEY');
    h.room.onPeerJoin = (peer) => h.put(h.hello, 'host', peer);
    const joining = p2pConnect('ABCDEF', 'KEYKEYKEYKEY', { kind: 'trystero' }, 5000);
    await settled();
    const link = await joining;
    const why: string[] = [];
    link.onclose = (w) => why.push(w ?? '');
    await h.room.leave();
    expect(why).toEqual(['the host left']);
    expect(FakeRoom.all[1].left).toBe(true);
  });

  it('the game’s side: a message Trystero gives up on ends the link', async () => {
    const h = rawGuest('ABCDEF', 'KEYKEYKEYKEY');
    h.room.onPeerJoin = (peer) => h.put(h.hello, 'host', peer);
    const joining = p2pConnect('ABCDEF', 'KEYKEYKEYKEY', { kind: 'trystero' }, 5000);
    await settled();
    const link = await joining;
    const why: string[] = [];
    link.onclose = (w) => why.push(w ?? '');
    FakeRoom.refuse = (ns) => ns === 'room';
    link.send('{"t":"status"}');
    await settled();
    expect(why).toEqual(['a message was lost']);
    expect(FakeRoom.all[1].left).toBe(true);
  });

  it('closing the room tells every guest', async () => {
    const host = new P2PHost('ABCDEF', 'KEYKEYKEYKEY', { kind: 'trystero' });
    await host.listen();
    const a = rawGuest('ABCDEF', 'KEYKEYKEYKEY');
    const b = rawGuest('ABCDEF', 'KEYKEYKEYKEY');
    await settled();
    expect(host.guests).toBe(2);
    // A guest that said hello is in the room; closing it sends the reason, then the farewell.
    host.close('closing for the test');
    await settled();
    for (const g of [a, b]) expect(g.hellos).toEqual(['host', 'bye']);
    expect(host.guests).toBe(0);
  });
});
