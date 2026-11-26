import { afterEach, describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { simDesync } from '../../src/sim/sync';
import { MemoryStore } from '../room';
import { buildTown, serveTown } from '../../tests/helpers';
import { makeRoom, loopTo, player, settle, stopAll, until, type TestPlayer } from './harness';

/**
 * M49: a slow machine (a phone) joining a busy shared city. Before, the room never waited for a
 * joiner: one slower than the city's pace fell behind for good. Now the room holds the city for a
 * while (`JOIN_HOLD`) after a joiner's snapshot, the pacer keeping time within its lead of them, and
 * past the hold the city carries on as before.
 */
function hostTown(): Sim {
  const sim = Sim.create({ seed: 'slowjoin', preset: 'river', cityName: 'Slowford' });
  buildTown(sim, { zone: true });
  serveTown(sim);
  return sim;
}

let players: TestPlayer[] = [];
afterEach(() => {
  stopAll(players);
  players = [];
});

describe('a slow player joining a running city (M49)', () => {
  it('is waited for while it catches up, then plays in step', async () => {
    const room = makeRoom('SLOWJN');
    const connect = loopTo(room);
    const host = player('Ada', connect, hostTown(), { create: { cityName: 'Slowford' } });
    players.push(host);
    await host.session.start();
    host.session.setSpeed(1);
    await until(() => host.driver.tick > 900, 30_000, 'the city to run');

    // Kit's machine is far slower than the city's pace (300 ticks a second here).
    const kit = player('Kit', connect, null);
    players.push(kit);
    kit.driver.slowMs = 6;
    await kit.session.start();
    // The room says it waits for Kit.
    await until(
      () => host.session.players.some((p) => p.name === 'Kit' && p.joining && p.catchUp),
      10_000,
      'the room to hold for Kit',
    );
    // While it holds, the city stays within the pacer's lead of Kit; Kit catches up and joins in step.
    let maxGap = 0;
    await until(
      () => {
        const k = host.session.players.find((p) => p.name === 'Kit');
        if (k && k.tick > 0) maxGap = Math.max(maxGap, host.session.allowed - kit.driver.tick);
        return !!k && !k.joining;
      },
      30_000,
      () => `Kit in step (host ${host.driver.tick}, Kit ${kit.driver.tick}, allowed ${host.session.allowed})`,
    );
    expect(host.session.players.find((p) => p.name === 'Kit')?.catchUp).toBeFalsy();
    const t = await settle(host, [host, kit]);
    expect(t).toBeGreaterThan(900);
    expect(simDesync(host.driver.sim, kit.driver.sim).text).toBe('The cities agree');
  }, 120_000);

  it('holds the city at most JOIN_HOLD: a joiner that never catches up is then left to it', async () => {
    let skew = 0;
    const room = makeRoom('HOLDUP', new MemoryStore(), { now: () => performance.now() + skew });
    const connect = loopTo(room);
    const host = player('Ada', connect, hostTown(), { create: { cityName: 'Slowford' } });
    players.push(host);
    await host.session.start();
    host.session.setSpeed(3);
    await until(() => host.driver.tick > 2000, 30_000, 'the city to run');
    // Kit's tab is frozen from the start: its city loads, and never runs on.
    const kit = player('Kit', connect, null);
    players.push(kit);
    kit.driver.frozen = true;
    await kit.session.start();
    await until(() => host.session.players.some((p) => p.name === 'Kit' && p.catchUp), 10_000, 'the hold');
    const held = host.session.allowed;
    await new Promise((r) => setTimeout(r, 1500));
    // Held: at 1,200 ticks a second the city would have moved 1,800; it waits for Kit.
    expect(host.session.allowed - held).toBeLessThan(200);
    // The others are told who they're waiting for.
    await until(() => host.session.waitingFor === 'Kit', 5000, 'waiting for Kit to show');
    // Past the hold, the city carries on without Kit (still catching up, no longer waited for).
    skew += 31_000;
    await until(
      () => host.session.players.some((p) => p.name === 'Kit' && p.joining && !p.catchUp),
      10_000,
      'the hold to end',
    );
    const after = host.session.allowed;
    await until(() => host.session.allowed > after + 1200, 15_000, 'the city to carry on');
  }, 120_000);
});
