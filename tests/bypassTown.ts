import type { Sim } from '../src/sim/sim';
import type { Vec2 } from '../src/sim/geom';
import { connectPoint, placeAlong, road } from './helpers';

/**
 * A town on one main road (M19): a suburb near the highway, the old centre in the middle and an
 * industrial estate at the far end. Suburban commuters and the estate's trucks to and from the
 * highway all drive through the centre on Main Street. `bypass()` builds a city highway from the
 * highway's end round the south of the town, with ramps into the estate. Returns the id of Main
 * Street's segment through the middle of the centre.
 */
export function mainStreetTown(sim: Sim): { centre: number; c: Vec2; bypass: () => number[] } {
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_500_000 });
  const c = connectPoint(sim);
  const at = (dx: number, dz: number): Vec2 => ({ x: c.x + dx, z: c.z + dz });
  // Main Street, in stretches so the centre has a segment of its own.
  for (const [a, b] of [
    [0, 250],
    [250, 420],
    [420, 480],
    [480, 650],
    [650, 1150],
  ] as const)
    road(sim, [at(a, 0), at(b, 0)], 'avenue');
  const centre = sim.net.nearestSegment(at(450, 0), 2)!.seg;
  // The suburb: streets north of Main Street near the highway.
  for (const dx of [90, 170]) road(sim, [at(dx, 0), at(dx, -260)]);
  road(sim, [at(90, -260), at(170, -260)]);
  // The centre: short side streets north and south.
  for (const dx of [300, 380, 560, 620]) road(sim, [at(dx, -140), at(dx, 140)]);
  // The estate: side streets north and south, and one along its east edge.
  for (const dx of [800, 900, 1000]) road(sim, [at(dx, -150), at(dx, 170)]);
  road(sim, [at(1150, -150), at(1150, 170)]);
  const brush = (zone: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
    sim.dispatch({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
  brush('R', at(130, -30), at(130, -250), 90);
  brush('R', at(280, 0), at(640, 0), 140);
  brush('C', at(420, 0), at(480, 0), 40);
  brush('I', at(780, 0), at(1160, 0), 160);
  // Utilities on a street south of Main Street between the centre and the estate.
  const util = road(sim, [at(700, 0), at(700, 180)]).created!;
  for (const def of ['coal', 'coal', 'coal', 'treatment', 'treatment', 'landfill'])
    placeOnAny(sim, def, util);
  const north = road(sim, [at(700, 0), at(700, -180)]).created!;
  for (const def of Array<string>(12).fill('pump')) placeOnAny(sim, def, [...north, ...util]);
  const streets = () =>
    [...sim.state.net.segments.values()].filter((s) => s.type === 'street').map((s) => s.id);
  for (const def of ['firestation', 'police', 'clinic', 'primary', 'firestation', 'police', 'clinic'])
    placeOnAny(sim, def, streets());
  return {
    centre,
    c,
    bypass: () => {
      const ids = [
        // From the highway's end, south and round the town, then east along its south side.
        ...road(sim, [at(0, 0), at(80, 180), at(200, 250)], 'motorway').created!,
        ...road(sim, [at(200, 250), at(1060, 250)], 'motorway').created!,
      ];
      // Off the east end into the estate's edge street, and on from its last side street.
      ids.push(...road(sim, [at(1060, 250), at(1150, 250), at(1150, 170)], 'ramp').created!);
      ids.push(...road(sim, [at(1000, 170), at(1000, 235), at(960, 250)], 'ramp').created!);
      return ids;
    },
  };
}

function placeOnAny(sim: Sim, def: string, segs: number[]): void {
  for (const id of segs) {
    try {
      placeAlong(sim, def, id);
      return;
    } catch {
      /* next */
    }
  }
  throw new Error(`no room for ${def}`);
}
