import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { buildTown, serveTown } from '../../tests/helpers';
import { makeRoom, loopTo, player, stopAll, until, type TestPlayer } from './harness';
import { MemoryStore } from '../room';
import { startRelay } from '../local';
import { loopbackPair, webSocketLink, type Link } from '../../src/net/link';
import { P2PHost, TRYSTERO_APP, p2pFailed } from '../../src/net/p2p';
import { RegionLink, type CityPort } from '../../src/net/regionLink';
import { RegionRoom, MemoryRegionStore, type RegionConn } from '../region';
import { regionReport } from '../../src/sim/systems/region';
import {
  CODE_ALPHABET,
  PROTOCOL_VERSION,
  codeKind,
  formatInvite,
  inviteProblem,
  makeCode,
  makeKey,
  parseInvite,
} from '../protocol';
import { startNostr, trysteroTopic } from './nostr';

/**
 * The multiplayer review follow-ups (F1–F14, docs/DECISIONS.md "Multiplayer review follow-ups"):
 * each problem reproduced here before it was fixed.
 */
function hostTown(): Sim {
  const sim = Sim.create({ seed: 'room', preset: 'river', cityName: 'Roomford' });
  buildTown(sim, { zone: false });
  serveTown(sim);
  return sim;
}

let players: TestPlayer[] = [];
afterEach(() => {
  stopAll(players);
  players = [];
  vi.restoreAllMocks();
});

/** A raw link that keeps every message it's sent. */
async function listen(link: Link): Promise<{ link: Link; got: Record<string, unknown>[] }> {
  const got: Record<string, unknown>[] = [];
  link.onmessage = (t) => {
    if (t !== 'pong') got.push(JSON.parse(t) as Record<string, unknown>);
  };
  return { link, got };
}

const hello = (name: string, create = false) =>
  JSON.stringify({
    t: 'hello',
    v: PROTOCOL_VERSION,
    name,
    color: 0,
    ...(create ? { create: { cityName: 'X' } } : {}),
  });
const rhello = (mayor: string, create = false) =>
  JSON.stringify({
    t: 'rhello',
    v: PROTOCOL_VERSION,
    mayor,
    color: 0,
    city: mayor,
    ...(create ? { create: { name: 'Vale' } } : {}),
  });

describe('F1: a removed player stays removed', () => {
  it('turns them away with their old secret, without it, and under a new name', async () => {
    const room = makeRoom('KICKME');
    const connect = loopTo(room);
    const host = player('Ada', connect, hostTown(), { create: { cityName: 'Roomford' } });
    players.push(host);
    await host.session.start();
    const sam = player('Sam', connect, null);
    players.push(sam);
    await sam.session.start();
    const kit = player('Kit', connect, null);
    players.push(kit);
    await kit.session.start();
    const old = sam.session.credentials!;

    host.session.admin('kick', old.id);
    await until(() => sam.session.state === 'closed', 5000, 'Sam to be removed');
    expect(sam.session.error).toBe('The host removed you from this room');
    await until(() => !host.session.players.some((p) => p.id === old.id), 5000, 'Sam to leave the list');
    // Back with the old secret (a reload of Sam's page).
    const again = player('Sam', connect, null, { rejoin: old });
    players.push(again);
    await expect(again.session.start()).rejects.toThrow('The host removed you from this room');
    // Without it (the invite link in a fresh tab).
    const fresh = player('Sam', connect, null);
    players.push(fresh);
    await expect(fresh.session.start()).rejects.toThrow('locked');
    // Under another name.
    const other = player('Samuel', connect, null);
    players.push(other);
    await expect(other.session.start()).rejects.toThrow('locked');
    expect(host.session.players.filter((p) => /Sam/.test(p.name))).toEqual([]);
    // The room locked behind Sam, and the host is told why.
    expect(host.session.room?.locked).toBe(true);
    expect(host.notices.map((n) => n.text).join('\n')).toMatch(/locked so they can’t come back/);

    // Players already in the room still come back after a dropped connection.
    kit.session.dropForTest();
    await until(() => kit.session.state === 'playing', 20_000, 'Kit to reconnect');
  }, 60_000);
});

describe('F3: codes and secrets come from the cryptographic source, not Math.random', () => {
  it('makes different codes and secrets even with Math.random stuck', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const online = new Set(Array.from({ length: 50 }, () => makeCode('online')));
    const p2p = new Set(Array.from({ length: 50 }, () => makeCode('p2p')));
    expect(online.size).toBeGreaterThan(45);
    expect(p2p.size).toBeGreaterThan(45);
    for (const c of online) expect(codeKind(c)).toBe('online');
    for (const c of p2p) expect(codeKind(c)).toBe('p2p');
    for (const c of [...online, ...p2p]) for (const ch of c.slice(0, 6)) expect(CODE_ALPHABET).toContain(ch);

    const secretsOf = async (connect: () => Promise<Link>, msgs: string[]) => {
      const out: string[] = [];
      for (const m of msgs) {
        const l = await listen(await connect());
        l.link.send(m);
        await until(() => l.got.some((x) => x.t === 'welcome' || x.t === 'rwelcome'), 5000, 'a welcome');
        out.push(String(l.got.find((x) => x.t === 'welcome' || x.t === 'rwelcome')!.secret));
        l.link.close();
      }
      return out;
    };
    const relay = await startRelay(0);
    try {
      const url = `ws://localhost:${relay.port}`;
      // Players in a room on the local relay (as the online Worker makes them).
      const room = await secretsOf(
        () => webSocketLink(`${url}/room/SECRET`),
        [hello('Ada', true), hello('Sam')],
      );
      // Cities in a region.
      const region = await secretsOf(
        () => webSocketLink(`${url}/region/SECRET`),
        [rhello('Ada', true), rhello('Sam')],
      );
      // Players in a peer-to-peer host's room (the host's browser runs it).
      const host = new P2PHost('SECRET', makeKey(), { kind: 'relay', url });
      const p2p = await secretsOf(() => host.connectSelf(), [hello('Ada', true), hello('Sam')]);
      for (const pair of [room, region, p2p]) {
        expect(pair[0]).not.toBe(pair[1]);
        // 128 bits or more: hex, 32 characters.
        for (const sec of pair) expect(sec).toMatch(/^[0-9a-f]{32,}$/);
      }
    } finally {
      await relay.close();
    }
  });
});

describe('F7: a bad command never reaches the city', () => {
  it('turns away malformed and page-only commands and orders only a clean copy', async () => {
    const store = new MemoryStore();
    const room = makeRoom('BADCMD', store);
    const l = await listen(await loopTo(room)());
    l.link.send(hello('Ada', true));
    await until(() => l.got.some((m) => m.t === 'welcome'), 5000, 'the welcome');
    const before = store.events.length;
    const bad: unknown[] = [
      { type: 'buildRoad', road: 'street', points: 5 },
      {
        type: 'buildRoad',
        road: 'bogus',
        points: [
          { x: 0, z: 0 },
          { x: 10, z: 0 },
        ],
      },
      {
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: 0, z: 0 },
          { x: 1e300, z: 0 },
        ],
      },
      { type: 'bulldoze', target: null },
      { type: 'zone', zone: 'R', area: null },
      { type: 'zone', zone: '__proto__', area: { kind: 'segment', id: 3 } },
      {
        type: 'zone',
        zone: 'R',
        area: {
          kind: 'brush',
          points: [
            { x: -1e6, z: 0 },
            { x: 1e6, z: 0 },
          ],
          radius: 30,
        },
      },
      { type: 'setTax', zone: 'R', wealth: 'length', rate: 0 },
      { type: 'setTax', zone: 'R', wealth: 999999999, rate: 5 },
      { type: 'setTax', zone: 'X', wealth: 0, rate: 5 },
      { type: 'renameCity', name: 5 },
      { type: 'createDistrict', name: 5 },
      { type: 'terraform', mode: 'raise', points: null, radius: 48 },
      { type: 'disaster', kind: 'meteor', at: null },
      { type: 'placeBuilding', def: 'firestation', x: 900, z: 900, angle: 0, side: 7 },
      { type: 'setDeal', neighbour: 1, resource: 'power', direction: 'steal', amount: 5 },
      { type: 'toString' },
      { type: '__proto__' },
      // Page-only: the region's news, a region payment, a scenario, the editor, cheats.
      {
        type: 'regionUpdate',
        update: {
          cities: [],
          contracts: [],
          project: { total: 1, goal: 1, funded: true, host: true, built: false },
        },
      },
      { type: 'contributeProject', amount: 1000 },
      { type: 'startScenario', id: 'stadium' },
      { type: 'editMap', brush: 'raise', points: [{ x: 10, z: 10 }], radius: 32 },
      { type: 'cheat', cheat: 'addMoney', amount: 1e6 },
    ];
    for (const [i, cmd] of bad.entries()) l.link.send(JSON.stringify({ t: 'cmd', ref: 100 + i, cmd }));
    await until(
      () => l.got.filter((m) => m.t === 'refused').length === bad.length,
      5000,
      () => JSON.stringify(l.got.filter((m) => m.t === 'refused').map((m) => m.ref)),
    );
    expect(store.events.length).toBe(before);
    // A good command, with a field it doesn't have and the tests' disaster size: ordered without them.
    l.link.send(
      JSON.stringify({
        t: 'cmd',
        ref: 7,
        cmd: { type: 'disaster', kind: 'meteor', at: { x: 900, z: 900, y: 3 }, size: 1e9, extra: 'x' },
      }),
    );
    await until(() => store.events.length === before + 1, 5000, 'the good command');
    expect(store.events.at(-1)!.ev).toEqual({
      kind: 'cmd',
      cmd: { type: 'disaster', kind: 'meteor', at: { x: 900, z: 900 } },
      by: 1,
      ref: 7,
    });
    l.link.close();
  });
});

describe('F9: the copy a removed player keeps is theirs to play', () => {
  it('stops waiting for the room once the session ends', async () => {
    const room = makeRoom('KEEPIT');
    const connect = loopTo(room);
    const host = player('Ada', connect, hostTown(), { create: { cityName: 'Roomford' } });
    players.push(host);
    await host.session.start();
    const sam = player('Sam', connect, null);
    players.push(sam);
    await sam.session.start();
    expect(sam.driver.lockstep).not.toBeNull();
    host.session.admin('kick', sam.session.credentials!.id);
    await until(() => sam.session.state === 'closed', 5000, 'Sam to be removed');
    // No longer in lockstep: Sam's own commands apply, as single player's.
    expect(sam.driver.lockstep).toBeNull();
    expect(sam.driver.sim.shared).toBe(false);
    expect(sam.driver.sim.dispatch({ type: 'renameCity', name: 'Samford' }).ok).toBe(true);
  }, 60_000);
});

describe("F2: a peer-to-peer room isn't found by its short code", () => {
  it('invites carry the key; a short peer-to-peer code alone is turned away', () => {
    const code = makeCode('p2p');
    const key = makeKey();
    const invite = formatInvite({ code, key });
    expect(invite).toMatch(/^[A-Z2-9]{6}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(parseInvite(invite)).toEqual({ code, key });
    expect(parseInvite(` ${invite.toLowerCase().replace(/-/g, ' ')} `)).toEqual({ code, key });
    expect(inviteProblem(parseInvite(invite))).toBeNull();
    expect(inviteProblem(parseInvite(code))).toMatch(/missing its second part/);
    // An online room is found by its code through our relay.
    const online = makeCode('online');
    expect(inviteProblem(parseInvite(online))).toBeNull();
    expect(inviteProblem(parseInvite('HELLO'))).toMatch(/six letters and numbers/);
  });

  it('announces itself on the relays only under its code and key, and nothing on the wire gives either away', async () => {
    const nostr = await startNostr();
    const code = makeCode('p2p');
    const key = makeKey();
    const host = new P2PHost(code, key, { kind: 'trystero', relays: [nostr.url] });
    try {
      await host.listen();
      await until(() => nostr.events.length >= 3, 15_000, 'the host to announce itself');
      const topics = new Set(
        nostr.events.flatMap((e) => e.tags.filter((t) => t[0] === 'x').map((t) => t[1])),
      );
      // What a stranger who knows only the code would look for: not there.
      expect(topics.has(trysteroTopic(TRYSTERO_APP, code))).toBe(false);
      // What the invite leads to: there.
      expect(topics.has(trysteroTopic(TRYSTERO_APP, `${code}-${key}`))).toBe(true);
      for (const e of nostr.events) {
        expect(e.content).not.toContain(code);
        expect(e.content).not.toContain(key);
      }
    } finally {
      host.close();
      await nostr.close();
    }
  }, 30_000);
});

describe('F10: peer-to-peer dead ends', () => {
  it("a host's browser closing the room tells the guests, who keep a city of their own", async () => {
    const p2p = new P2PHost(makeCode('p2p'), makeKey(), { kind: 'relay', url: 'ws://localhost:1' });
    const host = player('Ada', () => p2p.connectSelf(), hostTown(), { create: { cityName: 'Roomford' } });
    players.push(host);
    await host.session.start();
    const sam = player('Sam', () => p2p.connectSelf(), null);
    players.push(sam);
    await sam.session.start();
    host.session.leave();
    p2p.close(
      'Ada closed the room: it ran in their browser. You keep a copy of the city to play on your own.',
    );
    await until(() => sam.session.state === 'closed', 5000, 'Sam to be told');
    expect(sam.session.error).toMatch(/closed the room/);
    expect(sam.driver.lockstep).toBeNull();
    // Nobody new gets in.
    const kit = player('Kit', () => p2p.connectSelf(), null);
    players.push(kit);
    await expect(kit.session.start()).rejects.toThrow(/closed/);
  }, 60_000);

  it('a guest whose host has gone stops reconnecting after a few tries and says why', async () => {
    const room = makeRoom('GONEAB');
    const host = player('Ada', loopTo(room), hostTown(), { create: { cityName: 'Roomford' } });
    players.push(host);
    await host.session.start();
    let up = true;
    const sam = player(
      'Sam',
      () => (up ? loopTo(room)() : Promise.reject(new Error('No host is waiting with that code'))),
      null,
      { giveUpAfter: 3 },
    );
    players.push(sam);
    await sam.session.start();
    // The host's browser goes away without a word (its tab closed).
    up = false;
    sam.session.dropForTest();
    expect(sam.session.state).toBe('reconnecting');
    await until(() => sam.session.state === 'closed', 15_000, 'Sam to give up');
    expect(sam.session.error).toMatch(/host’s game has closed/);
    expect(sam.driver.lockstep).toBeNull();
  }, 60_000);

  it('a city whose peer-to-peer region has gone stops reconnecting; a region that closes tells its cities', async () => {
    const port = (name: string): CityPort => {
      const sim = Sim.create({ seed: name, preset: 'river', cityName: name });
      return {
        command: async (cmd) => sim.dispatch(cmd),
        report: async () => regionReport(sim),
        save: async () => sim.save(),
        cityName: () => name,
      };
    };
    const lost = new RegionLink(
      port('Lostby'),
      () => Promise.reject(new Error('No host is waiting with that code')),
      {
        mayor: 'Sam',
        color: 1,
        rejoin: { slot: 2, secret: 's' },
        giveUpAfter: 2,
      },
    );
    const gaveUp = await Promise.race([
      lost.start().then(
        () => 'joined',
        (e: Error) => e.message,
      ),
      new Promise((r) => setTimeout(() => r('still trying'), 10_000)),
    ]);
    expect(gaveUp).toMatch(/isn’t open/);
    expect(lost.state).toBe('closed');

    const region = new RegionRoom('A7KQ2M', 'p2p', new MemoryRegionStore(), { now: () => performance.now() });
    const loop = async () => {
      const [mine, theirs] = loopbackPair();
      const conn: RegionConn = { send: (m) => theirs.send(JSON.stringify(m)), close: () => theirs.close() };
      region.open(conn);
      theirs.onmessage = (t) => region.message(conn, t);
      theirs.onclose = () => region.closed(conn);
      return mine;
    };
    const ada = new RegionLink(port('Adaville'), loop, { mayor: 'Ada', color: 0, create: { name: 'Vale' } });
    const sam = new RegionLink(port('Samford'), loop, { mayor: 'Sam', color: 1 });
    await ada.start();
    await sam.start();
    region.close('Ada’s region closed: it ran in her browser.');
    await until(() => sam.state === 'closed', 5000, 'Samford to be told');
    expect(sam.error).toMatch(/region closed/);
    expect(sam.gone).toBe(true);
  }, 30_000);

  it('says what to do when two players can’t connect, whether or not online rooms are set up', () => {
    expect(p2pFailed(true)).toMatch(/online room/);
    expect(p2pFailed(false)).not.toMatch(/online/i);
    expect(p2pFailed(false)).toMatch(/another network|hotspot/);
  });
});
