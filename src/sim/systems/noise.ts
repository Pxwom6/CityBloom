import { CIVIC } from '../../data/civic';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { ZONE_I } from '../../data/zones';
import type { Sim } from '../sim';
import { BState } from '../world/buildings';
import { civicOnline } from '../world/civic';

/**
 * Noise (M23), DESIGN.md §3.24: a raster (GRID_RES², 0..1) of the loudest thing heard at each cell.
 * An airport is loud along its runway's line, where planes climb out and come in, and less so to
 * the side; motorways and the regional highway hum in proportion to their traffic; heavy industry
 * clanks next door. Derived, not saved: rebuilt every few game hours (`sim.noise()`).
 */
export const NOISE = {
  /** Noise at the runway, fading along its line to the airport's `noise` reach and to a third of that across it. */
  airport: 0.95,
  across: 0.35,
  /** Motorway and highway: noise per daily vehicle, up to `roadMax`, heard to `roadReach` m. */
  perVehicle: 1 / 60_000,
  roadMax: 0.45,
  roadReach: 64,
  /** Heavy industry next door. */
  industry: 0.3,
  industryReach: 40,
  /** Residents mind noise above this, up to `mood` at the loudest. */
  threshold: 0.35,
  mood: -0.2,
};

const LOUD_ROADS = new Set(['motorway', 'highway']);

export function computeNoise(sim: Sim): Float32Array {
  const s = sim.state;
  const out = new Float32Array(GRID_RES * GRID_RES);
  const stamp = (x0: number, z0: number, reach: number, value: (x: number, z: number) => number) => {
    const i0 = Math.max(0, Math.floor((x0 - reach) / GRID_CELL));
    const i1 = Math.min(GRID_RES - 1, Math.floor((x0 + reach) / GRID_CELL));
    const j0 = Math.max(0, Math.floor((z0 - reach) / GRID_CELL));
    const j1 = Math.min(GRID_RES - 1, Math.floor((z0 + reach) / GRID_CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const v = value((i + 0.5) * GRID_CELL, (j + 0.5) * GRID_CELL);
        const k = j * GRID_RES + i;
        if (v > out[k]!) out[k] = v;
      }
  };
  for (const c of s.civics.values()) {
    const a = CIVIC.get(c.def)?.airport;
    if (!a || !civicOnline(c)) continue;
    const ux = Math.cos(c.angle);
    const uz = Math.sin(c.angle);
    const half = CIVIC.get(c.def)!.w / 2;
    stamp(c.x, c.z, a.noise + half, (x, z) => {
      const dx = x - c.x;
      const dz = z - c.z;
      // Along the runway, measured from its nearer end; across it, from its centre line.
      const along = Math.max(0, Math.abs(dx * ux + dz * uz) - half);
      const across = Math.abs(-dx * uz + dz * ux);
      const r = Math.hypot(along / a.noise, across / (a.noise * NOISE.across));
      return r >= 1 ? 0 : NOISE.airport * (1 - r) ** 1.5;
    });
  }
  for (const seg of s.net.segments.values()) {
    if (!LOUD_ROADS.has(seg.type)) continue;
    const vol = s.traffic.get(seg.id) ?? 0;
    const level = Math.min(NOISE.roadMax, vol * NOISE.perVehicle);
    if (level < 0.05) continue;
    const c = sim.net.curve(seg.id);
    for (let k = 0; k < c.xs.length; k += 2) {
      const px = c.xs[k]!;
      const pz = c.zs[k]!;
      stamp(px, pz, NOISE.roadReach, (x, z) => {
        const d = Math.hypot(x - px, z - pz);
        return d >= NOISE.roadReach ? 0 : level * (1 - d / NOISE.roadReach);
      });
    }
  }
  for (const b of s.buildings.values()) {
    if (b.zone !== ZONE_I || b.state !== BState.Active || b.wealth !== 0) continue;
    stamp(b.x, b.z, NOISE.industryReach, (x, z) => {
      const d = Math.hypot(x - b.x, z - b.z);
      return d >= NOISE.industryReach ? 0 : NOISE.industry * (1 - d / NOISE.industryReach);
    });
  }
  return out;
}

/** How residents feel about the noise at a spot: 0 below the threshold, down to NOISE.mood. */
export function noiseMood(level: number): number {
  return level <= NOISE.threshold ? 0 : (NOISE.mood * (level - NOISE.threshold)) / (1 - NOISE.threshold);
}
