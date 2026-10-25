import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRelay, type LocalRelay } from '../local';
import { webSocketLink } from '../../src/net/link';
import { Sim } from '../../src/sim/sim';
import { simDesync } from '../../src/sim/sync';
import { TICKS_PER_MONTH, TICKS_PER_YEAR } from '../../src/sim/time';
import { buildTown, serveTown } from '../../tests/helpers';
import { player, settle, stopAll, until, type TestPlayer } from './harness';

/**
 * Through the local relay's real sockets (M30): two headless players build one city in step for a
 * game year, with the network budget counted on the way.
 */
/** RELAY_URL runs the same test against another relay (`wrangler dev` of the online Worker). */
const external = process.env.RELAY_URL ?? null;
let relay: LocalRelay | null = null;
beforeAll(async () => {
  if (!external) relay = await startRelay(0);
});
afterAll(async () => {
  await relay?.close();
});

describe('the local relay (M30)', () => {
  it('two players stay in step for a game year, building as they go', async () => {
    const code = external
      ? `Y${Date.now()
          .toString(36)
          .toUpperCase()
          .replace(/[^A-HJ-NP-Z2-9]/g, 'A')
          .slice(-5)}`
      : 'YEARAB';
    const url = `${external ?? `ws://localhost:${relay!.port}`}/room/${code}`;
    const connect = () => webSocketLink(url);
    const sim = Sim.create({ seed: 'year', preset: 'river', cityName: 'Yearling' });
    buildTown(sim, { zone: false });
    serveTown(sim);
    const players: TestPlayer[] = [];
    try {
      const ada = player('Ada', connect, sim, { create: { cityName: 'Yearling' } });
      players.push(ada);
      await ada.session.start();
      const sam = player('Sam', connect, null);
      players.push(sam);
      await sam.session.start();
      const start = sim.tick;
      ada.session.setSpeed(3);
      const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
      // Each month one of them zones another strip; checksums are compared every game hour.
      for (let m = 0; m < 12; m++) {
        const who = m % 2 ? sam : ada;
        const dz = [-90, 20, -140, 90, 110, -60][m % 6]!;
        const zone = (['R', 'C', 'R', 'R', 'I', 'C'] as const)[m % 6];
        await who.session.command({
          type: 'zone',
          zone,
          area: {
            kind: 'brush',
            points: [
              { x: n.x + 20, z: n.z + dz },
              { x: n.x + 460, z: n.z + dz },
            ],
            radius: 25,
          },
        });
        await until(() => ada.driver.tick >= start + (m + 1) * TICKS_PER_MONTH, 120_000, `month ${m + 1}`);
      }
      await until(() => ada.driver.tick >= start + TICKS_PER_YEAR, 120_000, 'a year');
      await settle(ada, players);
      expect(simDesync(ada.driver.sim, sam.driver.sim).text).toBe('The cities agree');
      expect(sam.notices.filter((x) => /out of step/.test(x.text))).toEqual([]);
      expect(ada.driver.sim.state.totals.population).toBeGreaterThan(300);
      const per = (p: TestPlayer) => ({ messages: p.session.sent.messages, bytes: p.session.sent.bytes });
      console.log('[net] a game year at 1,200 ticks/s:', JSON.stringify({ ada: per(ada), sam: per(sam) }));
    } finally {
      stopAll(players);
    }
  }, 300_000);

  it('keeps the city after everyone has left, for whoever comes back', async () => {
    const code = external
      ? `K${Date.now()
          .toString(36)
          .toUpperCase()
          .replace(/[^A-HJ-NP-Z2-9]/g, 'B')
          .slice(-5)}`
      : 'KEEPAB';
    const url = `${external ?? `ws://localhost:${relay!.port}`}/room/${code}`;
    const connect = () => webSocketLink(url);
    const sim = Sim.create({ seed: 'keep', preset: 'river', cityName: 'Keepsake' });
    buildTown(sim, { zone: true });
    serveTown(sim);
    const players: TestPlayer[] = [];
    try {
      const ada = player('Ada', connect, sim, { create: { cityName: 'Keepsake' } });
      players.push(ada);
      await ada.session.start();
      ada.session.setSpeed(3);
      await until(() => ada.driver.tick >= sim.tick + TICKS_PER_MONTH, 60_000, 'a month');
      // A snapshot is stored when a player joins; then everyone leaves.
      const sam = player('Sam', connect, null);
      players.push(sam);
      await sam.session.start();
      await settle(ada, players);
      const hash = ada.driver.sim.hash();
      ada.session.leave();
      sam.session.leave();
      await new Promise((r) => setTimeout(r, 500));
      // Kit comes along later with the code: the city is there, exactly as it was left.
      const kit = player('Kit', connect, null);
      players.push(kit);
      await kit.session.start();
      await until(
        () => kit.driver.tick === kit.session.allowed && kit.session.allowed > 0,
        30_000,
        'catch up',
      );
      expect(kit.driver.sim.hash()).toBe(hash);
      await until(() => kit.session.isPacer, 10_000, 'Kit to keep time');
    } finally {
      stopAll(players);
    }
  }, 300_000);
});
