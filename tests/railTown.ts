import type { Sim } from '../src/sim/sim';
import type { Vec2 } from '../src/sim/geom';
import { placeAlong, road } from './helpers';

/**
 * A railway along the south edge of the two-district town (tests/trafficTown.ts), with a station
 * near the homes and one near the jobs (M20). Returns the track and the stations.
 */
export function trainCorridor(sim: Sim, c: Vec2): { track: number[]; stations: number[] } {
  const track = road(
    sim,
    [
      { x: c.x + 40, z: c.z + 215 },
      { x: c.x + 580, z: c.z + 215 },
    ],
    'rail',
  ).created!;
  const stations: number[] = [];
  for (const x of [130, 470]) {
    const seg = sim.net.nearestSegment({ x: c.x + x, z: c.z + 215 }, 4)!.seg;
    stations.push(placeAlong(sim, 'station', seg));
  }
  return { track, stations };
}

/**
 * Trams through the two-district town (M20): track along the avenues and the link between them and
 * up a street in each district, a depot on the west avenue and stops along the way.
 */
export function tramCorridor(sim: Sim, c: Vec2): { depot: number; stops: number[] } {
  const along = (p: Vec2) => Math.abs(p.z - c.z) < 1 || [130, 470].some((x) => Math.abs(p.x - c.x - x) < 1);
  for (const seg of [...sim.state.net.segments.values()].sort((a, b) => a.id - b.id)) {
    const curve = sim.net.curve(seg.id);
    if (!along(curve.pointAt(0)) || !along(curve.pointAt(curve.length))) continue;
    if (!along(curve.pointAt(curve.length / 2))) continue;
    sim.dispatch({ type: 'setTram', seg: seg.id, on: true });
  }
  const west = [...sim.state.net.segments.values()]
    .filter((s) => s.tram && s.type === 'avenue' && sim.net.curve(s.id).pointAt(0).x < c.x + 200)
    .map((s) => s.id);
  let depot = -1;
  for (const id of west) {
    try {
      depot = placeAlong(sim, 'tramdepot', id);
      break;
    } catch {
      /* next */
    }
  }
  if (depot < 0) throw new Error('no room for the tram depot');
  const stops: number[] = [];
  for (const [x, dz] of [
    [60, 0],
    [160, 0],
    [290, 0],
    [410, 0],
    [530, 0],
    [130, -90],
    [130, 90],
    [470, -120],
  ] as const) {
    const r = sim.dispatch({ type: 'placeStop', x: c.x + x, z: c.z + dz, tram: true });
    if (r.ok) stops.push(r.created![0]!);
  }
  return { depot, stops };
}
