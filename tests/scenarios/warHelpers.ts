import { objectiveSpots } from '../../src/sim/battle/layout';
import { Player } from '../../src/sim/ai/mayor';
import type { Sim } from '../../src/sim/sim';
import type { Neighbour } from '../../src/sim/systems/region';
import { baseLoad, militaryCivics } from '../../src/sim/systems/war';
import { TICKS_PER_MONTH } from '../../src/sim/time';

/** The scenario city's computer neighbours, in the order the script and the recipes count them. */
export const rivalsOf = (sim: Sim): Neighbour[] =>
  sim.state.region.neighbours.filter((n) => n.rival && !n.player);

/** One line a raid's battle: what the raiders did and what the defenders did (the city's own, not its expeditions'). */
export function homeReports(sim: Sim): string {
  return (sim.state.war!.reports ?? [])
    .filter((r) => !r.ours)
    .map(
      (r) =>
        `${r.outcome} (${r.target}) collapsed ${r.collapsed.length} civics ${r.civics.length} lost ${JSON.stringify(r.lost)} killed ${r.theirLost}/${r.theirTotal}`,
    )
    .join(' | ');
}

/** Train infantry at every barracks until it holds `want` squads (and orders). */
export function fillBarracks(sim: Sim, want = 12): void {
  for (const b of militaryCivics(sim).filter((c) => c.def === 'barracks')) {
    const load = baseLoad(sim, b.id);
    if (load.units + load.orders < want && load.orders < 2)
      sim.dispatch({ type: 'trainUnit', base: b.id, kind: 'infantry' });
  }
}

/** Run on a month at a time (the sim's own events are drained as it goes). */
export function months(sim: Sim, n: number): void {
  for (let m = 0; m < n; m++) sim.advance(TICKS_PER_MONTH);
}

export { objectiveSpots, Player };
