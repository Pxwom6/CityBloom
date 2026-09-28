import { describe, expect, it } from 'vitest';
import { CIVIC } from '../../src/data/civic';
import { Player } from '../../scripts/lib/mayor';
import { openScenario, playOut } from './harness';

describe('scenario: After the Flood', () => {
  it('is won by a mayor who rebuilds the waterworks and carries on growing the town', () => {
    const sim = openScenario('flood');
    expect(sim.state.utilityStats.water.supply).toBe(0);
    const mayor = new Player('careful', sim).adopt();
    // The first morning: pumps on clean ground and a treatment works, enough for everyone at once.
    const u = sim.state.utilityStats;
    const pump = CIVIC.get('pump')!.output!.water!;
    const works = CIVIC.get('treatment')!.output!.sewage!;
    for (let k = 0; k < Math.ceil((u.water.demand * 1.3) / (pump * 0.7)); k++) mayor.place('pump', 'clean');
    for (let k = 0; k < Math.ceil((u.sewage.demand * 1.2) / works); k++) mayor.place('treatment', 'industry');
    sim.advance(60);
    expect(sim.state.utilityStats.water.supply).toBeGreaterThan(u.water.demand * 0.9);
    const end = playOut(sim, () => mayor.play());
    expect(end).toMatchObject({ status: 'won' });
    console.log(`[flood] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`);
  });

  it('is lost by a neglectful one: without water the town empties', () => {
    const sim = openScenario('flood');
    const end = playOut(sim);
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
    expect(sim.state.totals.population).toBeLessThan(18_000);
  });
});
