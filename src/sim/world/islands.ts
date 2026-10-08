import { ROAD_TYPES } from '../../data/roads';
import type { Vec2 } from '../geom';
import type { RoadGraph } from '../systems/graph';
import type { Network } from './network';

/** Roads that can't reach the highway (P1): one cut-off stretch of the network. */
export interface RoadIsland {
  /** Its streets, avenues and dirt roads, longest first. */
  segs: number[];
  /** Metres of road in it. */
  length: number;
  /** Middle of its longest road, for the camera and icons. */
  at: Vec2;
}

/**
 * The stretches of road no car can drive to from the highway's `home` node, largest first. Only
 * roads buildings stand along count (not railways, ramps or city highways). Pure: the sim and the
 * client's mirror build the same graph and get the same answer.
 */
export function roadIslands(net: Network, graph: RoadGraph, home: number): RoadIsland[] {
  const homeComp = graph.componentOfNode(home);
  if (homeComp < 0) return [];
  const byComp = new Map<number, { segs: { id: number; len: number }[]; length: number }>();
  for (const seg of [...net.st.segments.values()].sort((a, b) => a.id - b.id)) {
    if (!ROAD_TYPES[seg.type].access) continue;
    const comp = graph.componentOfNode(seg.a);
    if (comp === homeComp) continue;
    const len = net.curve(seg.id).length;
    const isl = byComp.get(comp) ?? { segs: [], length: 0 };
    isl.segs.push({ id: seg.id, len });
    isl.length += len;
    byComp.set(comp, isl);
  }
  const out: RoadIsland[] = [];
  for (const isl of byComp.values()) {
    isl.segs.sort((a, b) => b.len - a.len || a.id - b.id);
    const longest = net.curve(isl.segs[0]!.id);
    out.push({
      segs: isl.segs.map((s) => s.id),
      length: isl.length,
      at: longest.pointAt(longest.length / 2),
    });
  }
  return out.sort((a, b) => b.length - a.length || Math.min(...a.segs) - Math.min(...b.segs));
}
