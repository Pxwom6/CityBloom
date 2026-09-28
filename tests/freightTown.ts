import type { Sim } from '../src/sim/sim';
import type { Vec2 } from '../src/sim/geom';
import { connectPoint, placeAlong, road } from './helpers';

/**
 * An industrial town at the end of a long avenue (M20): homes near the highway, an estate a kilometre
 * east, and every truck the estate sends out or takes in driving the avenue to and from the highway.
 * `railway()` lays track from the regional railway's link along the town's side to the estate and
 * puts a rail freight terminal there. Returns the avenue's middle segment.
 */
export function freightTown(sim: Sim): { corridor: number; c: Vec2; railway: () => number } {
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_500_000 });
  const c = connectPoint(sim);
  const link = sim.state.net.nodes.get(sim.state.railway!.connect)!;
  // The side the railway comes in on, and the other side (for everything else).
  const dir = Math.sign(link.z - c.z) || 1;
  const at = (dx: number, dz: number): Vec2 => ({ x: c.x + dx, z: c.z + dz });
  for (const [a, b] of [
    [0, 300],
    [300, 440],
    [440, 580],
    [580, 1050],
  ] as const)
    road(sim, [at(a, 0), at(b, 0)], 'avenue');
  const corridor = sim.net.nearestSegment(at(510, 0), 2)!.seg;
  // Homes by the highway, the estate at the far end.
  for (const dx of [100, 180, 260]) road(sim, [at(dx, -150), at(dx, 150)]);
  for (const dx of [820, 900, 980]) road(sim, [at(dx, -150), at(dx, 150)]);
  const brush = (zone: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
    sim.dispatch({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
  brush('R', at(80, 0), at(280, 0), 150);
  brush('C', at(300, 0), at(420, 0), 30);
  brush('I', at(800, 0), at(1040, 0), 160);
  // Utilities on a street off the avenue, away from the railway's side.
  const util = road(sim, [at(640, 0), at(640, -dir * 300)]).created!;
  for (const def of ['coal', 'coal', 'treatment', 'landfill', ...Array<string>(10).fill('pump')])
    placeOnAny(sim, def, util);
  for (const def of ['firestation', 'police', 'clinic', 'primary'])
    placeOnAny(
      sim,
      def,
      [...sim.state.net.segments.values()].filter((s) => s.type === 'street').map((s) => s.id),
    );
  return {
    corridor,
    c,
    railway: () => {
      // Track straight on from the regional railway's link, past the town's side to the estate.
      const z = link.z - c.z;
      road(sim, [{ x: link.x, z: link.z }, at(1100, z)], 'rail');
      // A street from the estate out to a terminal beside the track.
      const zs = z - dir * 50;
      road(sim, [at(900, dir * 150), at(900, zs)]);
      const yard = road(sim, [at(900, zs), at(1060, zs)]).created!;
      return placeOnAny(sim, 'railfreight', yard);
    },
  };
}

function placeOnAny(sim: Sim, def: string, segs: number[]): number {
  for (const id of segs) {
    try {
      return placeAlong(sim, def, id);
    } catch {
      /* next */
    }
  }
  throw new Error(`no room for ${def}`);
}
