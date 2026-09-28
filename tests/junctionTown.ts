import type { Sim } from '../src/sim/sim';
import type { Vec2 } from '../src/sim/geom';
import { connectPoint, placeAlong, road } from './helpers';

/**
 * A crossroads town (M19): homes west and north of one junction, jobs east and south of it, and no
 * other way between them, so every commute crosses it. The four roads are avenues that narrow to
 * streets for their last stretch into the crossroads, which is where the jam forms. Returns the
 * junction's node id and its position.
 */
export function crossroadsTown(
  sim: Sim,
  arms: 'street' | 'avenue' = 'avenue',
): { node: number; j: Vec2; c: Vec2 } {
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
  const c = connectPoint(sim);
  const j = { x: c.x + 460, z: c.z };
  const at = (dx: number, dz: number): Vec2 => ({ x: j.x + dx, z: j.z + dz });
  const stub = 90;
  // The four arms: avenue, then a street stub into the crossroads.
  road(sim, [c, at(-stub, 0)], 'avenue');
  road(sim, [at(-stub, 0), j], arms);
  road(sim, [j, at(stub, 0)], arms);
  road(sim, [at(stub, 0), at(420, 0)], 'avenue');
  road(sim, [j, at(0, -stub)], arms);
  road(sim, [at(0, -stub), at(0, -440)], 'avenue');
  road(sim, [j, at(0, stub)], arms);
  road(sim, [at(0, stub), at(0, 440)], 'avenue');
  // District streets across each avenue, well away from the crossroads and from each other.
  const west = [-380, -300, -220, -140].map((dx) => road(sim, [at(dx, -150), at(dx, 150)]).created!);
  for (const dz of [-200, -280, -360]) road(sim, [at(-150, dz), at(150, dz)]);
  for (const dx of [150, 230, 310]) road(sim, [at(dx, -150), at(dx, 150)]);
  for (const dz of [200, 280, 360]) road(sim, [at(-150, dz), at(150, dz)]);
  const brush = (zone: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
    sim.dispatch({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
  // Homes west and north; shops and industry east and south.
  brush('R', at(-400, 0), at(-130, 0), 150);
  brush('R', at(0, -190), at(0, -420), 150);
  brush('C', at(130, 0), at(400, 0), 60);
  brush('I', at(130, -110), at(400, -110), 50);
  brush('I', at(130, 110), at(400, 110), 50);
  brush('C', at(0, 190), at(0, 420), 60);
  brush('I', at(-110, 190), at(-110, 420), 50);
  brush('I', at(110, 190), at(110, 420), 50);
  // Utilities on a street south of the west road, near the highway; services in both home districts.
  const util = road(sim, [
    { x: c.x + 30, z: c.z },
    { x: c.x + 30, z: c.z + 480 },
  ]).created!;
  const utilities = ['coal', 'coal', 'coal', 'treatment', 'treatment', 'landfill', 'landfill'];
  for (const def of [...utilities, ...Array<string>(12).fill('pump')]) placeOnAny(sim, def, util);
  const northStreets = [...sim.state.net.segments.values()]
    .filter((s) => {
      if (s.type !== 'street') return false;
      const m = sim.net.curve(s.id).pointAt(sim.net.curve(s.id).length / 2);
      return m.z < j.z - 180;
    })
    .map((s) => s.id);
  for (const segs of [west.flat(), northStreets])
    for (const def of ['firestation', 'police', 'clinic', 'primary'])
      placeOnAny(sim, def, currentSegs(sim, segs));
  return { node: sim.net.nearestNode(j, 3)!.id, j, c };
}

/** Segments still standing among `ids`, plus the pieces a later road split them into. */
function currentSegs(sim: Sim, ids: number[]): number[] {
  const live = ids.filter((id) => sim.state.net.segments.has(id));
  return live.length ? live : [...sim.state.net.segments.keys()];
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
