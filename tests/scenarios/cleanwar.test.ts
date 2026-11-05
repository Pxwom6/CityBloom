import { describe, expect, it } from 'vitest';
import { SCENARIO } from '../../src/data/scenarios';
import { cityStrength } from '../../src/sim/systems/raids';
import { fightingWith, pactsWith, warWith } from '../../src/sim/systems/diplomacy';
import { goalValue, scenarioSummary } from '../../src/sim/systems/scenario';
import { militaryCivics } from '../../src/sim/systems/war';
import { DIPLOMACY } from '../../src/data/diplomacy';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import type { Sim } from '../../src/sim/sim';
import { openScenario, playOut } from './harness';
import { armUp, homeReports, rivalsOf } from './warHelpers';

const def = SCENARIO.get('cleanwar')!;
const foe = (sim: Sim) => rivalsOf(sim)[0]!;

/** What the scenario's goals read now. */
function goals(sim: Sim): string {
  return def.goals.map((g) => `${g.measure} ${goalValue(sim, g)}`).join(', ');
}

/** The war with the aggressor as the war room has it. */
function warLine(sim: Sim): string {
  const war = warWith(sim, foe(sim).id);
  return war
    ? `score ${war.score}, ${war.battles} battles${war.capitulated ? `, ${war.capitulated.by} capitulated` : ''}`
    : 'no war';
}

describe('scenario: A Clean War (M39)', () => {
  it('opens with a hostile aggressor that outguns the city, two districts to lose, and no war yet', () => {
    const sim = openScenario('cleanwar');
    const f = foe(sim);
    expect(f.rival!.personality).toBe('aggressive');
    expect(f.rival!.relation).toBeLessThan(-25);
    // Its army is bigger than the city's: the case it declares war in.
    expect(f.rival!.forces).toBeGreaterThan(1.4 * cityStrength(sim));
    expect([...sim.state.districts.values()].map((d) => d.name)).toEqual(['Old Town', 'New Quarter']);
    expect(militaryCivics(sim).map((c) => c.def)).toEqual(
      expect.arrayContaining(['militaryhq', 'barracks', 'vehicledepot', 'bunker']),
    );
    expect(warWith(sim, f.id)).toBeUndefined();
    expect(goalValue(sim, def.goals[0]!)).toBe(0);
    expect(goalValue(sim, def.goals[1]!)).toBe(0);
    expect(sim.state.scenario!.facts).toBeUndefined();
    console.log(
      `[cleanwar] opens: ${goals(sim)}; strength ${cityStrength(sim).toFixed(0)} against ${f.rival!.forces}`,
    );
  });

  it('a city that does nothing is beaten, and never wins', () => {
    const sim = openScenario('cleanwar');
    const sc = playOut(sim);
    const fell = !!sim.state.war!.diplomacy?.vassal;
    console.log(
      `[cleanwar] passive: ${sc.status} (${sc.reason}); ${goals(sim)}; ${warLine(sim)}; fell ${fell}\n  ${homeReports(sim)}`,
    );
    expect(sc).toMatchObject({ status: 'lost', reason: 'time' });
    expect(goalValue(sim, def.goals[0]!)).toBe(0);
  });

  it('a city that capitulates gives up its best district, and a clean war is no longer possible', () => {
    const sim = openScenario('cleanwar');
    sim.testMode = true;
    const f = foe(sim);
    expect(sim.dispatch({ type: 'declareWar', neighbour: f.id, scale: 'war', reason: 'Too soon' }).ok).toBe(
      true,
    );
    sim.advance(DIPLOMACY.warningHours * TICKS_PER_HOUR + 60);
    // The war goes badly: the score falls past the bar and the city gives up.
    warWith(sim, f.id)!.score = -61;
    sim.advance(2 * TICKS_PER_HOUR);
    expect(warWith(sim, f.id)?.capitulated?.by ?? 'peace').toBe('peace');
    const taken = pactsWith(sim, f.id, 'occupy');
    expect(taken).toHaveLength(1);
    expect(sim.state.scenario!.facts?.districtsLost).toBe(1);
    expect(goalValue(sim, def.goals[1]!)).toBe(1);
    // Buying the district back gets it back, but not the scenario's clean record.
    const pact = taken[0]!;
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
    expect(sim.dispatch({ type: 'buyBack', pact: pact.id }).ok).toBe(true);
    expect(pactsWith(sim, f.id, 'occupy')).toHaveLength(0);
    expect(goalValue(sim, def.goals[1]!)).toBe(1);
    expect(scenarioSummary(sim)!.goals[1]!.met).toBe(false);
  });

  it('an armed city that declares and holds beats the aggressor with every district its own', () => {
    const sim = openScenario('cleanwar');
    const f = foe(sim);
    const arm = armUp(sim, { bunkers: 12, tanks: 4 });
    let declared = false;
    const sc = playOut(sim, () => {
      arm();
      const day = (sim.state.tick - sim.state.scenario!.start) / TICKS_PER_MONTH;
      if (!declared && day >= 3 && !warWith(sim, f.id)) {
        declared = sim.dispatch({ type: 'declareWar', neighbour: f.id, scale: 'war', reason: 'Enough' }).ok;
        expect(declared).toBe(true);
      }
    });
    console.log(
      `[cleanwar] armed: ${sc.status}, ${sc.stars} stars, in ${((sc.end - sc.start) / TICKS_PER_MONTH).toFixed(1)} months; ${goals(sim)}; ${warLine(sim)}\n  ${homeReports(sim)}`,
    );
    expect(sc.status).toBe('won');
    expect(sc.facts).toEqual({ warWon: 1 });
    expect(fightingWith(sim, f.id)).toBeUndefined();
    expect(sim.state.war!.diplomacy!.pacts.filter((p) => p.term.k === 'occupy')).toHaveLength(0);
  });
});
