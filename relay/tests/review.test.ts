import { afterEach, describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { buildTown, serveTown } from '../../tests/helpers';
import { makeRoom, loopTo, player, stopAll, until, type TestPlayer } from './harness';

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
