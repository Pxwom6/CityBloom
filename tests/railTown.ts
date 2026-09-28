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
