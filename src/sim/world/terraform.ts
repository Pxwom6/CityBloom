import { GRADING } from '../../data/roads';
import { TERRAFORM, type TerraformMode } from '../../data/terraform';
import { HEIGHT_RES, HEIGHT_STEP, MAP_SIZE, SHORE_HEIGHT } from '../../data/world';
import { pointRectDistance, type Vec2 } from '../geom';
import type { Sim } from '../sim';
import { footprint } from './buildings';
import { civicRect } from './civic';
import type { EarthPlan } from './earthworks';

/**
 * Terraforming (M24): the player's own earthworks, on the same saved terrain deltas as a road's
 * cut and fill (M13). A round brush along a drag raises, lowers, levels or smooths the ground,
 * strongest at its centre. Water is left alone, and the ground a building or road stands on is
 * held, with the new ground kept to a 1 in 1 slope from it. DESIGN.md §3.25.
 */
export interface TerraformPlan extends EarthPlan {
  /** Samples under the brush held by buildings and roads, and under water. */
  held: number;
  water: number;
}

const AREA = HEIGHT_STEP * HEIGHT_STEP;

/** Distance from a point to a polyline (a single point is a dab). */
function distToPath(x: number, z: number, pts: readonly Vec2[]): number {
  let best = Infinity;
  if (pts.length === 1) return Math.hypot(x - pts[0]!.x, z - pts[0]!.z);
  for (let n = 0; n < pts.length - 1; n++) {
    const a = pts[n]!;
    const b = pts[n + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

/** Is the ground at (x, z) held by a road, a building or a civic building? */
export function groundHeld(sim: Sim, x: number, z: number): boolean {
  const hold = TERRAFORM.hold;
  const net = sim.net;
  for (const id of net.segHash.queryPoint(x, z, hold + GRADING.shoulder)) {
    if (net.curve(id).project({ x, z }).d <= net.halfWidth(id) + GRADING.shoulder + hold) return true;
  }
  const p = { x, z };
  for (const id of sim.bldHash.queryPoint(x, z, hold)) {
    const b = sim.state.buildings.get(id);
    if (b && pointRectDistance(p, footprint(b)) <= hold) return true;
  }
  for (const id of sim.civHash.queryPoint(x, z, hold)) {
    const c = sim.state.civics.get(id);
    if (c && pointRectDistance(p, civicRect(c)) <= hold) return true;
  }
  return false;
}

/** Plan one application of the brush along `points`; `level` is the height the level tool aims for. */
export function planTerraform(
  sim: Sim,
  mode: TerraformMode,
  points: readonly Vec2[],
  radius: number,
  level = 0,
): TerraformPlan {
  const out: TerraformPlan = {
    idx: [],
    to: [],
    volume: 0,
    cut: 0,
    fill: 0,
    cost: 0,
    box: null,
    held: 0,
    water: 0,
  };
  const terrain = sim.terrain;
  const H = terrain.heights;
  const reachN = Math.ceil(TERRAFORM.reach / HEIGHT_STEP);
  let bx0 = Infinity;
  let bz0 = Infinity;
  let bx1 = -Infinity;
  let bz1 = -Infinity;
  for (const p of points) {
    bx0 = Math.min(bx0, p.x - radius);
    bz0 = Math.min(bz0, p.z - radius);
    bx1 = Math.max(bx1, p.x + radius);
    bz1 = Math.max(bz1, p.z + radius);
  }
  const i0 = Math.max(0, Math.ceil(bx0 / HEIGHT_STEP));
  const i1 = Math.min(HEIGHT_RES - 1, Math.floor(bx1 / HEIGHT_STEP));
  const j0 = Math.max(0, Math.ceil(bz0 / HEIGHT_STEP));
  const j1 = Math.min(HEIGHT_RES - 1, Math.floor(bz1 / HEIGHT_STEP));
  if (i0 > i1 || j0 > j1) return out;
  // Held ground in and around the brush (the slope limit looks this far out).
  const hi0 = Math.max(0, i0 - reachN);
  const hj0 = Math.max(0, j0 - reachN);
  const hw = Math.min(HEIGHT_RES - 1, i1 + reachN) - hi0 + 1;
  const hh = Math.min(HEIGHT_RES - 1, j1 + reachN) - hj0 + 1;
  const held = new Uint8Array(hw * hh);
  for (let j = 0; j < hh; j++)
    for (let i = 0; i < hw; i++)
      if (groundHeld(sim, (hi0 + i) * HEIGHT_STEP, (hj0 + j) * HEIGHT_STEP)) held[j * hw + i] = 1;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const floor = SHORE_HEIGHT + 0.1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = i * HEIGHT_STEP;
      const z = j * HEIGHT_STEP;
      const d = distToPath(x, z, points);
      if (d > radius) continue;
      const idx = j * HEIGHT_RES + i;
      const cur = H[idx]!;
      if (cur < SHORE_HEIGHT || terrain.base[idx]! < SHORE_HEIGHT) {
        out.water++;
        continue;
      }
      if (held[(j - hj0) * hw + (i - hi0)]) {
        out.held++;
        continue;
      }
      // Strongest at the centre, fading to nothing at the rim and towards the map's edge.
      const q = d / radius;
      const edge = Math.min(x, z, MAP_SIZE - x, MAP_SIZE - z);
      const w = (1 - q * q) ** 2 * Math.max(0, Math.min(1, (edge - HEIGHT_STEP) / TERRAFORM.edgeFade));
      if (w <= 0) continue;
      let t: number;
      if (mode === 'raise') t = cur + TERRAFORM.step * w;
      else if (mode === 'lower') t = cur - TERRAFORM.step * w;
      else if (mode === 'level') t = cur + (level - cur) * Math.min(1, w * 1.6);
      else {
        // The average of the 5×5 samples around, dry ones only.
        let sum = 0;
        let n = 0;
        for (let v = -2; v <= 2; v++)
          for (let u = -2; u <= 2; u++) {
            const a = i + u;
            const b = j + v;
            if (a < 0 || b < 0 || a >= HEIGHT_RES || b >= HEIGHT_RES) continue;
            const h = H[b * HEIGHT_RES + a]!;
            if (h < SHORE_HEIGHT) continue;
            sum += h;
            n++;
          }
        t = cur + (sum / n - cur) * Math.min(1, w * 0.8);
      }
      // Limits: not into the water table, not too high, not too far from how the map began.
      const base = terrain.base[idx]!;
      t = Math.min(t, TERRAFORM.maxHeight, base + TERRAFORM.maxChange);
      t = Math.max(t, base - TERRAFORM.maxChange);
      if (t < floor) t = Math.max(t, Math.min(cur, floor));
      // Next to held ground, no steeper than 1 in 1 from it.
      for (let v = -reachN; v <= reachN; v++) {
        const b = j + v - hj0;
        if (b < 0 || b >= hh) continue;
        for (let u = -reachN; u <= reachN; u++) {
          const a = i + u - hi0;
          if (a < 0 || a >= hw || !held[b * hw + a]) continue;
          const dist = Math.hypot(u, v) * HEIGHT_STEP;
          if (dist > TERRAFORM.reach) continue;
          const hh2 = H[(j + v) * HEIGHT_RES + (i + u)]!;
          const lim = dist * TERRAFORM.nearSlope;
          // Never pushes ground further from the held height than it already is.
          t = Math.max(Math.min(t, Math.max(cur, hh2 + lim)), Math.min(cur, hh2 - lim));
        }
      }
      const dh = t - cur;
      if (Math.abs(dh) < 0.01) continue;
      out.idx.push(idx);
      out.to.push(t);
      if (dh > 0) out.fill += dh * AREA;
      else out.cut -= dh * AREA;
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
  }
  out.cut = Math.round(out.cut);
  out.fill = Math.round(out.fill);
  out.volume = out.cut + out.fill;
  out.cost = Math.round(out.volume * TERRAFORM.costPerCubicMetre);
  if (out.idx.length)
    out.box = {
      minX: minX - HEIGHT_STEP,
      minZ: minZ - HEIGHT_STEP,
      maxX: maxX + HEIGHT_STEP,
      maxZ: maxZ + HEIGHT_STEP,
    };
  return out;
}
