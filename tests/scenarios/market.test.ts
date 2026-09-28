import { describe, expect, it } from 'vitest';
import { goalValue } from '../../src/sim/systems/scenario';
import { SCENARIO } from '../../src/data/scenarios';
import { openScenario, playOut } from './harness';

describe('scenario: Market Town (M21)', () => {
  it('is won by a bypass round Old Market and a heavy-traffic ban on it', () => {
    const sim = openScenario('market');
    const goal = SCENARIO.get('market')!.goals[0]!;
    const before = goalValue(sim, goal);
    expect(sim.state.districts.get(1)?.name).toBe('Old Market');
    const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const at = (dx: number, dz: number) => ({ x: hw.x + dx, z: hw.z + dz });
    // A back road south of the market, from the highway end of the avenue to beyond it.
    for (const [a, b] of [
      [at(40, 0), at(40, 220)],
      [at(40, 220), at(520, 220)],
      [at(520, 220), at(520, 0)],
    ] as const) {
      const r = sim.dispatch({ type: 'buildRoad', road: 'street', points: [a, b] });
      expect(r).toMatchObject({ ok: true });
    }
    expect(
      sim.dispatch({ type: 'setDistrictPolicy', district: 1, policy: 'heavyTrafficBan', on: true }),
    ).toMatchObject({ ok: true });
    const end = playOut(sim);
    expect(end).toMatchObject({ status: 'won' });
    console.log(
      `[market] busiest road in Old Market ${before} → ${goalValue(sim, goal)}; won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`,
    );
  });

  it('is not won by the bypass alone: lorries still take the short way through the market', () => {
    const sim = openScenario('market');
    const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const at = (dx: number, dz: number) => ({ x: hw.x + dx, z: hw.z + dz });
    for (const [a, b] of [
      [at(40, 0), at(40, 220)],
      [at(40, 220), at(520, 220)],
      [at(520, 220), at(520, 0)],
    ] as const)
      expect(sim.dispatch({ type: 'buildRoad', road: 'street', points: [a, b] })).toMatchObject({ ok: true });
    expect(playOut(sim)).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('is not won by the ban alone: with no other way round, the lorries still come through', () => {
    const sim = openScenario('market');
    expect(
      sim.dispatch({ type: 'setDistrictPolicy', district: 1, policy: 'heavyTrafficBan', on: true }),
    ).toMatchObject({ ok: true });
    expect(playOut(sim)).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('is lost by a neglectful one: the lorries keep coming', () => {
    const end = playOut(openScenario('market'));
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
