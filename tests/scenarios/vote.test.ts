import { describe, expect, it } from 'vitest';
import { Player } from '../../scripts/lib/mayor';
import { openScenario, playOut } from './harness';

describe('scenario: Vote of Confidence', () => {
  it('is won by a mayor who cuts taxes, funds services and campaigns on promises', () => {
    const sim = openScenario('vote');
    expect(sim.state.election.nextMonth).toBeGreaterThan(0);
    const mayor = new Player('careful', sim).adopt();
    mayor.setTaxes(9);
    mayor.setFunding(100);
    const end = playOut(sim, () => mayor.play());
    expect(end).toMatchObject({ status: 'won' });
    expect(sim.state.election.results.at(-1)).toMatchObject({ won: true });
    console.log(`[vote] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`);
  });

  it('is lost at the ballot box by a neglectful one', () => {
    const end = playOut(openScenario('vote'));
    expect(end).toMatchObject({ status: 'lost', reason: 'election' });
  });
});
