/**
 * A quick match's city across browsers (M43): the `match` section of the determinism run. A city
 * founded with the fast start (its money, its growth times three, its short unlock path) is laid out
 * by the scripted town's first month of commands and grown for two game days, its hash every half
 * day and its match report each day; then it is kept as an ordinary city (`endMatch`) and grown a day
 * more at the ordinary pace. Every browser must give the hashes Node does.
 */
import type { Command, CommandResult } from '../../src/sim/commands';
import { Sim } from '../../src/sim/sim';
import { MATCH } from '../../src/data/match';
import { matchReport } from '../../src/sim/systems/region';
import { checkInvariants } from '../../src/sim/invariants';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { act, TOWN_OPTIONS } from './scriptedTown';

export function runMatchSection(note: (cmd: Command, r: CommandResult) => CommandResult): string[] {
  const sim = Sim.create({
    ...TOWN_OPTIONS,
    seed: 'lockstep-match',
    disasters: false,
    elections: false,
    region: false,
    match: { ...MATCH.fastStart },
  });
  sim.testMode = true;
  const out: string[] = [];
  // The scripted town's first month: roads, zones, power, water, services (its own money, not cheats'
  // extra: the fast start's funds pay for it).
  act(sim, (cmd) => sim.dispatch(cmd), 0);
  for (let half = 0; half < 4; half++) {
    sim.advance(TICKS_PER_MONTH / 2);
    out.push(sim.hash());
    if (half % 2 === 1) out.push(JSON.stringify(matchReport(sim)));
  }
  checkInvariants(sim);
  note({ type: 'endMatch' }, sim.dispatch({ type: 'endMatch' }));
  sim.advance(TICKS_PER_MONTH);
  checkInvariants(sim);
  out.push(sim.hash(), String(sim.state.totals.population));
  return out;
}
