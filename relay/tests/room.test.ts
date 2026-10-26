import { afterEach, describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { simDesync } from '../../src/sim/sync';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import type { Command } from '../../src/sim/commands';
import { MemoryStore, Room } from '../room';
import { buildTown, serveTown } from '../../tests/helpers';
import { makeRoom, loopTo, player, settle, stopAll, until, type TestPlayer } from './harness';

/** A small town with power and water, built in single player before it's shared. */
function hostTown(): Sim {
  const sim = Sim.create({ seed: 'room', preset: 'river', cityName: 'Roomford' });
  buildTown(sim, { zone: false });
  serveTown(sim);
  return sim;
}

function zoneCmd(sim: Sim, zone: 'R' | 'C' | 'I', dz: number): Command {
  const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
  return {
    type: 'zone',
    zone,
    area: {
      kind: 'brush',
      points: [
        { x: n.x + 20, z: n.z + dz },
        { x: n.x + 460, z: n.z + dz },
      ],
      radius: 30,
    },
  };
}

let players: TestPlayer[] = [];
afterEach(() => {
  stopAll(players);
  players = [];
});

describe('a room (M30), with headless players', () => {
  it('two players build one city in step; a third joins halfway; a dropped link comes back; a desync is caught and resynced', async () => {
    const room = makeRoom('ABCDEF');
    const connect = loopTo(room);
    const host = player('Ada', connect, hostTown(), { create: { cityName: 'Roomford' } });
    players.push(host);
    await host.session.start();
    expect(host.session.isHost).toBe(true);
    expect(host.session.isPacer).toBe(true);

    const sam = player('Sam', connect, null);
    players.push(sam);
    await sam.session.start();
    expect(sam.driver.sim.state.cityName).toBe('Roomford');
    expect(host.notices.map((n) => n.text)).toContain('Sam is joining');

    // Both build: the host zones homes, Sam shops; the room orders them.
    host.session.setSpeed(3);
    const r1 = await host.session.command(zoneCmd(host.driver.sim, 'R', -90));
    const r2 = await sam.session.command(zoneCmd(sam.driver.sim, 'C', 20));
    expect(r1.ok && r2.ok).toBe(true);
    // Cheats are turned down by the room before they're ordered.
    expect(await sam.session.command({ type: 'cheat', cheat: 'addMoney', amount: 1e6 })).toMatchObject({
      ok: false,
    });

    await until(() => host.driver.tick > 3 * TICKS_PER_MONTH, 60_000, 'three months');
    // A third player joins halfway through and catches up from a fresh snapshot.
    const kit = player('Kit', connect, null);
    players.push(kit);
    await kit.session.start();
    await sam.session.command(zoneCmd(sam.driver.sim, 'I', 110));

    // Sam's connection drops; the game carries on and reconnects by itself.
    sam.session.dropForTest();
    expect(sam.session.state).toBe('reconnecting');
    await until(() => sam.session.state === 'playing', 20_000, 'reconnect');
    expect(sam.notices.map((n) => n.text)).toEqual(
      expect.arrayContaining(['Reconnecting…', 'Back in the room']),
    );

    await until(
      () => host.driver.tick > 6 * TICKS_PER_MONTH,
      90_000,
      () =>
        JSON.stringify(
          [host, sam, kit].map((p) => [
            p.session.state,
            p.driver.tick,
            p.session.allowed,
            p.session.waitingFor,
          ]),
        ) + JSON.stringify(host.session.players),
    );
    let t = await settle(host, [host, sam, kit]);
    expect(simDesync(host.driver.sim, sam.driver.sim).text).toBe('The cities agree');
    expect(simDesync(host.driver.sim, kit.driver.sim).text).toBe('The cities agree');
    expect(host.driver.sim.state.totals.population).toBeGreaterThan(100);

    // Kit's game goes wrong (as a buggy machine might): the next hourly checksum catches it and the
    // room sends Kit a fresh snapshot; everyone is told.
    kit.driver.sim.state.treasury += 1;
    host.session.setSpeed(3);
    await until(() => kit.notices.some((n) => /fell out of step/.test(n.text)), 30_000, 'the desync');
    expect(host.notices.some((n) => n.text === "Kit's game fell out of step; catching up")).toBe(true);
    await until(() => host.driver.tick > t + TICKS_PER_MONTH, 60_000, 'a month more');
    t = await settle(host, [host, sam, kit]);
    expect(simDesync(host.driver.sim, kit.driver.sim).text).toBe('The cities agree');
    expect(t).toBeGreaterThan(7 * TICKS_PER_MONTH);
  }, 300_000);

  it('keeps the city when everyone has left, and a player coming back carries on from it', async () => {
    const store = new MemoryStore();
    const room = makeRoom('QWERTY', store);
    const host = player('Ada', loopTo(room), hostTown(), { create: { cityName: 'Roomford' } });
    players.push(host);
    await host.session.start();
    host.session.setSpeed(3);
    await host.session.command(zoneCmd(host.driver.sim, 'R', -90));
    await until(() => host.driver.tick > TICKS_PER_MONTH, 60_000, 'a month');
    await settle(host, [host]);
    const hash = host.driver.sim.hash();
    host.session.leave();
    await until(() => room.online === 0, 5000, 'the room to empty');

    // Later, the same room code: the room comes back from its store (a Durable Object waking up).
    const again = makeRoom('QWERTY', store);
    const back = player('Ada', loopTo(again), null);
    players.push(back);
    await back.session.start();
    await until(() => back.driver.tick === again.allowed, 30_000, 'catch up');
    expect(back.driver.sim.hash()).toBe(hash);
  }, 120_000);

  it('turns away bad codes, full and locked rooms, and nonsense', async () => {
    const room = makeRoom('ZZZZZZ');
    const nobody = player('Lee', loopTo(room), null);
    players.push(nobody);
    await expect(nobody.session.start()).rejects.toThrow('No room with that code');
    const host = player('Ada', loopTo(room), hostTown(), { create: { cityName: 'Roomford' } });
    players.push(host);
    await host.session.start();
    host.session.admin('lock');
    await until(() => !!host.session.room?.locked, 5000, 'lock');
    const late = player('Bo', loopTo(room), null);
    players.push(late);
    await expect(late.session.start()).rejects.toThrow('The host has locked this room');
    // A message that isn't the protocol closes the connection.
    const link = await loopTo(room)();
    let closed = false;
    link.onclose = () => (closed = true);
    link.send('{"t":"cmd","ref":1,"cmd":{"type":"zone","points":' + '['.repeat(20) + '}}');
    await until(() => closed, 5000, 'the close');
  });

  it('a host whose tab goes to the background hands the clock to someone else, and gets it back', async () => {
    const room = makeRoom('BGTABS');
    let front = true;
    const host = player('Ada', loopTo(room), hostTown(), {
      create: { cityName: 'Roomford' },
      visible: () => front,
    });
    players.push(host);
    await host.session.start();
    const sam = player('Sam', loopTo(room), null);
    players.push(sam);
    await sam.session.start();
    host.session.setSpeed(1);
    await until(() => sam.session.room?.pacer === 1, 5000, 'Ada keeping time');
    // Ada's tab goes to the background (the browser slows its timers right down).
    front = false;
    host.driver.frozen = true;
    await until(() => sam.session.isPacer, 5000, 'Sam to take over the clock');
    const t = sam.driver.tick;
    await until(() => sam.driver.tick > t + 200, 10_000, 'the city to keep going without Ada');
    front = true;
    host.driver.frozen = false;
    await until(() => host.session.isPacer, 10_000, 'Ada to take the clock back');
  }, 60_000);

  it("a joiner isn't left waiting on a pacer whose game has frozen", async () => {
    // The room's clock is pushed past its wait for a frozen pacer's snapshot (8 s) instead of the
    // test waiting it out beside the heavy suites (F13).
    let skew = 0;
    const room = new Room('FRZNAB', 'local', new MemoryStore(), { now: () => performance.now() + skew });
    const host = player('Ada', loopTo(room), hostTown(), { create: { cityName: 'Roomford' } });
    players.push(host);
    await host.session.start();
    host.session.setSpeed(1);
    // From where Ada's city stood (building a town in the wait's condition held up her game).
    const from = host.driver.tick;
    await until(() => host.driver.tick > from + 100, 10_000, 'some time');
    host.driver.frozen = true;
    const kit = player('Kit', loopTo(room), null);
    players.push(kit);
    const joined = kit.session.start();
    // Welcomed, the room has asked Ada's frozen game for a snapshot: Kit waits for it a while...
    await until(() => kit.session.state === 'joining', 5000, 'Kit to be welcomed');
    await new Promise((r) => setTimeout(r, 500));
    expect(kit.session.state).toBe('joining');
    // ...until the room gives up on it and sends the stored city with the events since.
    skew = 60_000;
    await joined;
    expect(kit.session.state).toBe('playing');
    expect(kit.driver.sim.state.cityName).toBe('Roomford');
  }, 60_000);
});
