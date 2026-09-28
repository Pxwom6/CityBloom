import { describe, expect, it } from 'vitest';
import { CIVIC } from '../../src/data/civic';
import { projectCost } from '../../src/sim/systems/projects';
import { GOALS, Player } from '../../scripts/lib/mayor';
import { openScenario, playOut } from './harness';

describe('scenario: Big Game', () => {
  it('is won by a mayor who raises a levy, breaks ground early and pays each stage as it comes', () => {
    const sim = openScenario('stadium');
    expect(sim.dispatch({ type: 'takeLoan', amount: 25_000 })).toMatchObject({ ok: false });
    const mayor = new Player('careful', sim).adopt();
    // A stadium levy (two points on every tax), and every other landmark or project shelved.
    mayor.setTaxes(11);
    mayor.holdTaxes = true;
    mayor.avoid = GOALS.map((g) => g.def).filter((d) => d !== 'stadium');
    const first = projectCost(CIVIC.get('stadium')!).first;
    const end = playOut(sim, () => {
      const built = [...sim.state.civics.values()].some((c) => c.def === 'stadium');
      if (!built && sim.state.treasury > first + 40_000) mayor.placeGoal('stadium');
      mayor.play();
    });
    expect(end).toMatchObject({ status: 'won' });
    expect(sim.state.economy.loans.length).toBe(0);
    console.log(`[stadium] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`);
  });

  it('is lost by a neglectful one that never builds it', () => {
    const end = playOut(openScenario('stadium'));
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
