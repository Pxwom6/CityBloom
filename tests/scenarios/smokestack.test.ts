import { describe, expect, it } from 'vitest';
import { Player } from '../../scripts/lib/mayor';
import { openScenario, playOut } from './harness';

describe('scenario: Smokestack Valley', () => {
  it('is won by replacing coal with wind before closing the plants, and schooling the workforce', () => {
    const sim = openScenario('smokestack');
    const mayor = new Player('careful', sim);
    mayor.avoid = ['coal', 'gas'];
    // Wind turbines on the clean north side until they cover demand with a margin.
    for (let k = 0; k < 40; k++) {
      const u = sim.state.utilityStats.power;
      const wind = [...sim.state.civics.values()].filter((c) => c.def === 'wind').length;
      if (wind * 70 > u.demand * 1.3) break;
      if (!mayor.placeNear('wind', { x: mayor.c.x + 320, z: mayor.c.z - 300 }, 600)) break;
    }
    sim.advance(60);
    for (const c of [...sim.state.civics.values()])
      if (c.def === 'coal')
        expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: c.id } }).ok).toBe(true);
    expect(mayor.place('primary')).toBe(true);
    expect(mayor.place('primary')).toBe(true);
    const end = playOut(sim, () => {
      mayor.utilities(false);
      mayor.followAdvice();
    });
    expect(end).toMatchObject({ status: 'won' });
    console.log(
      `[smokestack] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`,
    );
  });

  it('is lost by a neglectful one: the smoke never clears', () => {
    const end = playOut(openScenario('smokestack'));
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
