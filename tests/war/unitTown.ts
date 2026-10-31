import { CIVIC } from '../../src/data/civic';
import { UNIT_DEFS, type UnitKind } from '../../src/data/war';
import type { Sim } from '../../src/sim/sim';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import { buildTown, connectPoint, newSim, placeAlong, road, serveTown } from '../helpers';

/**
 * A coast town with war on and every base the units live at (M34): the HQ, a barracks and a vehicle
 * depot by the town, an airfield on a long avenue north of it, and a naval yard on a street along
 * the shore (the seaport test's seed, where deep water is reachable). Built headlessly for the pose
 * tests; the dev scene (scripts/dev/warshot.mjs) does the same through the page.
 */
export function unitTown(): { sim: Sim; bases: Record<string, number> } {
  const sim = newSim({ seed: 'port', preset: 'coast', rivals: true, disasters: false });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
  const c = connectPoint(sim);
  const bases: Record<string, number> = {};
  const place = (def: string, segs: number[]) => {
    for (const seg of segs)
      try {
        return (bases[def] = placeAlong(sim, def, seg));
      } catch {
        /* the next one */
      }
    throw new Error(`nowhere for the ${def}`);
  };
  const all = () =>
    [...sim.state.net.segments.values()]
      .filter((s) => s.type === 'street' || s.type === 'avenue')
      .map((s) => s.id);
  place('militaryhq', [...streets].reverse());
  place('barracks', [...streets].reverse());
  place('vehicledepot', all().reverse());
  // A long avenue north of town for the airfield, joined to the first side street.
  for (const dz of [-420, -480, -540, -360]) {
    const pts = [
      { x: c.x + 40, z: c.z + dz },
      { x: c.x + 800, z: c.z + dz },
    ];
    if (!sim.preview({ type: 'buildRoad', road: 'avenue', points: pts }).ok) continue;
    const avenue = road(sim, pts, 'avenue').created!;
    road(sim, [
      { x: c.x + 96, z: c.z + dz },
      { x: c.x + 96, z: c.z - 160 },
    ]);
    place('airfield', avenue);
    break;
  }
  // Out to the sea: an avenue east, then a street along the shore, and the naval yard on it.
  for (const x of [1430, 1410, 1390, 1450, 1370]) {
    const pts = [
      { x, z: c.z - 400 },
      { x, z: c.z + 400 },
    ];
    const link = [
      { x: c.x + 480, z: c.z },
      { x, z: c.z },
    ];
    if (!sim.preview({ type: 'buildRoad', road: 'street', points: pts }).ok) continue;
    if (!sim.preview({ type: 'buildRoad', road: 'avenue', points: link }).ok) continue;
    road(sim, link, 'avenue');
    road(sim, pts);
    const shore = [...sim.state.net.segments.values()]
      .filter((s) => s.type === 'street' && Math.abs(sim.net.curve(s.id).pointAt(0).x - x) < 2)
      .map((s) => s.id);
    try {
      place('navalyard', shore);
      break;
    } catch {
      /* another line along the shore */
    }
  }
  sim.advance(TICKS_PER_HOUR);
  return { sim, bases };
}

/** The base that keeps each unit kind. */
export function baseOf(kind: UnitKind): string {
  return UNIT_DEFS.find((d) => d.id === kind)!.base;
}

/** Every kind a base keeps (from the data, research kinds too). */
export function kindsAt(def: string): UnitKind[] {
  return UNIT_DEFS.filter((d) => d.base === def).map((d) => d.id);
}

export { CIVIC };
