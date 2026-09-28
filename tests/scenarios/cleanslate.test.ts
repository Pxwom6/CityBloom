import { describe, expect, it } from 'vitest';
import { Player } from '../../scripts/lib/mayor';
import { openScenario, playOut } from './harness';

describe('scenario: Clean Slate', () => {
  it('is won by a careful mayor on wind and solar, with no coal or gas built', () => {
    const sim = openScenario('cleanslate');
    // The limit is enforced.
    expect(sim.preview({ type: 'placeBuilding', def: 'coal', x: 0, z: 0, angle: 0, side: 1 })).toMatchObject({
      ok: false,
      reason: 'Coal and gas plants are not allowed in this scenario',
    });
    const mayor = new Player('careful', sim).adopt();
    const end = playOut(sim, () => mayor.play());
    expect(end).toMatchObject({ status: 'won' });
    expect(end.stars).toBeGreaterThanOrEqual(1);
    expect([...sim.state.civics.values()].some((c) => c.def === 'coal' || c.def === 'gas')).toBe(false);
    console.log(
      `[cleanslate] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`,
    );
  });

  it('is lost by a neglectful one when time runs out', () => {
    const end = playOut(openScenario('cleanslate'));
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
