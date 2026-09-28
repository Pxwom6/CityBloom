import { describe, expect, it } from 'vitest';
import { Player } from '../../scripts/lib/mayor';
import { openScenario, playOut } from './harness';

describe('scenario: Seaside Resort', () => {
  it('is won with hotels, landmarks and a tourism campaign, and no new industry', () => {
    const sim = openScenario('resort');
    const brush = { kind: 'brush' as const, points: [{ x: 300, z: 300 }], radius: 20 };
    expect(sim.dispatch({ type: 'zone', zone: 'I', area: brush })).toMatchObject({
      ok: false,
      reason: 'New industry zoning is not allowed in this scenario',
    });
    const mayor = new Player('careful', sim).adopt();
    // Landmarks and hotels, but none of the big projects in these two years.
    mayor.avoid = [
      'stadium',
      'helioarray',
      'convention',
      'gardenexpo',
      'launchsite',
      'techpark',
      'university',
    ];
    expect(sim.dispatch({ type: 'setPolicy', id: 'tourismCampaign', on: true }).ok).toBe(true);
    expect(sim.dispatch({ type: 'setFunding', dept: 'tourism', pct: 120 }).ok).toBe(true);
    // The clock tower as soon as it's affordable (the draw), then hotels (where visitors spend).
    const end = playOut(sim, () => {
      if (mayor.count('clocktower') === 0) mayor.place('clocktower');
      else if (mayor.count('hotel') < 3) mayor.place('hotel');
      mayor.play();
    });
    expect(end).toMatchObject({ status: 'won' });
    console.log(`[resort] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`);
  });

  it('is lost by a neglectful one: nobody comes', () => {
    const sim = openScenario('resort');
    const end = playOut(sim);
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
    expect(sim.state.tourism.visitors).toBeLessThan(2_000);
  });
});
