import { CIVIC } from '../../data/civic';
import type { Sim } from '../sim';
import { civicOnline, railSiding, type Civic } from '../world/civic';

/**
 * Rail freight (M20). A rail freight terminal faces a road for its trucks and has a railway along
 * its back: its siding (`railSiding`). When that track is linked to the regional railway, the
 * terminal takes goods off trucks and onto trains.
 */

/** Is this track linked to the regional railway? */
export function linkedToRegion(sim: Sim, segId: number): boolean {
  const r = sim.state.railway;
  const seg = sim.state.net.segments.get(segId);
  if (!r || !seg) return false;
  const g = sim.railGraph();
  const comp = g.componentOfNode(seg.a);
  return comp >= 0 && comp === g.componentOfNode(r.connect);
}

/** Rail freight terminals in service whose siding is linked to the regional railway. */
export function railTerminals(sim: Sim): Civic[] {
  return [...sim.state.civics.values()]
    .filter((c) => {
      const d = CIVIC.get(c.def);
      if (!d?.railFreight || !c.access || !civicOnline(c)) return false;
      const siding = railSiding(sim, c);
      return !!siding && linkedToRegion(sim, siding.seg);
    })
    .sort((a, b) => a.id - b.id);
}
