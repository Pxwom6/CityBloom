import { describe, expect, it } from 'vitest';
import { Player } from '../../scripts/lib/mayor';
import { openScenario, playOut } from './harness';

describe('scenario: Back from the Brink', () => {
  it('is won by a mayor who restores taxes and funding, then repays the loans', () => {
    const sim = openScenario('brink');
    expect(sim.dispatch({ type: 'takeLoan', amount: 25_000 })).toMatchObject({
      ok: false,
      reason: 'New loans are not allowed in this scenario',
    });
    const mayor = new Player('careful', sim).adopt();
    mayor.setFunding(100);
    mayor.setTaxes(10);
    const end = playOut(sim, () => {
      mayor.play();
      // Repay a loan as soon as the treasury can cover it with a margin.
      const e = sim.state.economy;
      for (const l of e.loans)
        if (sim.state.treasury > l.balance + 60_000) sim.dispatch({ type: 'repayLoan', id: l.id });
    });
    expect(end).toMatchObject({ status: 'won' });
    console.log(`[brink] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`);
  });

  it('is lost by a neglectful one: the loans are still owed when time runs out', () => {
    const sim = openScenario('brink');
    const end = playOut(sim);
    expect(end).toMatchObject({ status: 'lost' });
    expect(sim.state.economy.loans.length).toBeGreaterThan(0);
  });
});
