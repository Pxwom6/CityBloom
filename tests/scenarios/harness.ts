import { readFileSync } from 'node:fs';
import { decodeSave } from '../../src/client/saves';
import { SCENARIO } from '../../src/data/scenarios';
import { checkInvariants } from '../../src/sim/invariants';
import { Sim } from '../../src/sim/sim';
import type { ScenarioState } from '../../src/sim/systems/scenario';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';

/** A scenario's starting city, loaded from its save, with the scenario begun. */
export function openScenario(id: string): Sim {
  const def = SCENARIO.get(id);
  if (!def) throw new Error(`No scenario ${id}`);
  const sim = Sim.fromSave(decodeSave(readFileSync(`public/scenarios/${def.save}`)));
  const r = sim.dispatch({ type: 'startScenario', id });
  if (!r.ok) throw new Error(r.reason);
  return sim;
}

/**
 * Play the scenario until it's won or lost: `act` makes a decision four times a game month (as the
 * balance tool's mayors do), or never for a neglectful player. Checks the sim's invariants at the
 * end, and returns the scenario's final state.
 */
export function playOut(sim: Sim, act: (() => void) | null = null): ScenarioState {
  const def = SCENARIO.get(sim.state.scenario!.id)!;
  const limit = sim.state.scenario!.start + (def.months + 2) * TICKS_PER_MONTH;
  while (sim.state.scenario!.status === 'playing' && sim.state.tick < limit) {
    act?.();
    sim.advance(TICKS_PER_HOUR * 6);
  }
  checkInvariants(sim);
  return sim.state.scenario!;
}
