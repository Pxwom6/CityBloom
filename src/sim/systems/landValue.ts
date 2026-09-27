import { GRID_CELL, GRID_RES, SHORE_HEIGHT } from '../../data/world';
import { ZONE_I } from '../../data/zones';
import type { Sim } from '../sim';
import { BState } from '../world/buildings';
import { civicDef } from '../world/civic';

/** Distance (m) from each raster cell to the nearest water cell, capped. Derived from terrain. */
export function waterDistance(sim: Sim): Float32Array {
  const n = GRID_RES * GRID_RES;
  const d = new Float32Array(n).fill(1e9);
  const q: number[] = [];
  for (let j = 0; j < GRID_RES; j++) {
    for (let i = 0; i < GRID_RES; i++) {
      const h = sim.terrain.heightAt((i + 0.5) * GRID_CELL, (j + 0.5) * GRID_CELL);
      if (h < SHORE_HEIGHT) {
        d[j * GRID_RES + i] = 0;
        q.push(j * GRID_RES + i);
      }
    }
  }
  // Multi-source BFS in cell steps (8-connected approximation).
  for (let h = 0; h < q.length; h++) {
    const k = q[h]!;
    const i = k % GRID_RES;
    const j = (k - i) / GRID_RES;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= GRID_RES || nj >= GRID_RES) continue;
        const nk = nj * GRID_RES + ni;
        const nd = d[k]! + (di && dj ? GRID_CELL * Math.SQRT2 : GRID_CELL);
        if (nd < d[nk]!) {
          d[nk] = nd;
          q.push(nk);
        }
      }
    }
  }
  return d;
}

/**
 * Land value raster (DESIGN §3.10). M2 terms: waterfront, elevation view, trees, neighbourhood
 * happiness, industrial nuisance, abandonment. Services, parks, crime and pollution join later.
 */
export function updateLandValue(sim: Sim, instant = false): void {
  const lv = sim.state.landValue;
  const n = GRID_RES * GRID_RES;
  const water = sim.waterDist();
  const happy = new Float32Array(n);
  const weight = new Float32Array(n);
  const nuisance = new Float32Array(n);
  const abandoned = new Float32Array(n);
  for (const b of sim.state.buildings.values()) {
    const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(b.x / GRID_CELL)));
    const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(b.z / GRID_CELL)));
    const k = j * GRID_RES + i;
    if (b.state === BState.Abandoned) abandoned[k]! += 1;
    else if (b.state === BState.Active) {
      happy[k]! += b.happiness;
      weight[k]! += 1;
      if (b.zone === ZONE_I) nuisance[k]! += 0.5 + b.density * 0.25;
    }
  }
  const blur = (src: Float32Array, radius: number): Float32Array => {
    // Separable box blur (radius in cells), sums not averages, as running sums along each row and
    // then each column. The inputs are float32, so the double sums are exact: the same result as
    // adding up each window afresh, at a fraction of the cost.
    const tmp = new Float32Array(n);
    const out = new Float32Array(n);
    for (let j = 0; j < GRID_RES; j++) {
      const row = j * GRID_RES;
      let s = 0;
      for (let i = 0; i < radius && i < GRID_RES; i++) s += src[row + i]!;
      for (let i = 0; i < GRID_RES; i++) {
        if (i + radius < GRID_RES) s += src[row + i + radius]!;
        if (i - radius - 1 >= 0) s -= src[row + i - radius - 1]!;
        tmp[row + i] = s;
      }
    }
    for (let i = 0; i < GRID_RES; i++) {
      let s = 0;
      for (let j = 0; j < radius && j < GRID_RES; j++) s += tmp[j * GRID_RES + i]!;
      for (let j = 0; j < GRID_RES; j++) {
        if (j + radius < GRID_RES) s += tmp[(j + radius) * GRID_RES + i]!;
        if (j - radius - 1 >= 0) s -= tmp[(j - radius - 1) * GRID_RES + i]!;
        out[j * GRID_RES + i] = s;
      }
    }
    return out;
  };
  const hSum = blur(happy, 3);
  const wSum = blur(weight, 3);
  const nuis = blur(nuisance, 4);
  const aband = blur(abandoned, 4);
  const civicEffect = new Float32Array(n);
  for (const c of sim.state.civics.values()) {
    const lvDef = civicDef(c).landValue;
    // A big project changes land value once it opens (M17).
    if (!lvDef || c.build) continue;
    const ci = Math.floor(c.x / GRID_CELL);
    const cj = Math.floor(c.z / GRID_CELL);
    const kern = kernel(lvDef.radius / GRID_CELL);
    for (let e = 0; e < kern.length; e += 3) {
      const i = ci + kern[e]!;
      const j = cj + kern[e + 1]!;
      if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) continue;
      civicEffect[j * GRID_RES + i]! += lvDef.value * kern[e + 2]!;
    }
  }
  const ground = sim.state.groundPollution;
  const crime = sim.state.crime;
  const air = sim.state.airPollution;
  // Average service coverage of nearby buildings (fire, police, health, education).
  const svcSum = new Float32Array(n);
  const svcW = new Float32Array(n);
  for (const b of sim.state.buildings.values()) {
    if (b.state !== BState.Active) continue;
    const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(b.x / GRID_CELL)));
    const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(b.z / GRID_CELL)));
    svcSum[j * GRID_RES + i]! += (b.covFire + b.covPolice + b.covHealth + b.covEdu) / 4;
    svcW[j * GRID_RES + i]! += 1;
  }
  const svcBlur = blur(svcSum, 4);
  const svcWBlur = blur(svcW, 4);
  const trees = sim.state.trees;
  const setting = settingValue(sim, water);
  for (let k = 0; k < n; k++) {
    const neighbour = wSum[k]! > 0 ? hSum[k]! / wSum[k]! - 0.5 : 0;
    let target = setting[k]! + 0.05 * (trees[k]! / 255) + 0.2 * neighbour;
    target -= 0.08 * Math.min(2, nuis[k]!);
    target -= 0.06 * Math.min(3, aband[k]!);
    target += civicEffect[k]!;
    target -= 0.2 * ground[k]!;
    target -= 0.3 * Math.min(1, air[k]!);
    target -= 0.2 * Math.min(1, crime[k]!);
    if (svcWBlur[k]! > 0) target += 0.12 * (svcBlur[k]! / svcWBlur[k]!);
    target = Math.max(0, Math.min(1, target));
    lv[k] = instant ? target : lv[k]! + (target - lv[k]!) * 0.25;
  }
}

/**
 * The fixed part of each cell's value, from the land itself: a base plus waterfront and hilltop
 * views. Cached per terrain (the water-distance raster stands in for it).
 */
const settingCache = new WeakMap<Float32Array, Float64Array>();
function settingValue(sim: Sim, water: Float32Array): Float64Array {
  let out = settingCache.get(water);
  if (out) return out;
  out = new Float64Array(GRID_RES * GRID_RES);
  for (let k = 0; k < out.length; k++) {
    const i = k % GRID_RES;
    const j = (k - i) / GRID_RES;
    const h = sim.terrain.heightAt((i + 0.5) * GRID_CELL, (j + 0.5) * GRID_CELL);
    const waterfront = Math.max(0, 1 - water[k]! / 120);
    const view = Math.max(0, Math.min(1, (h - 15) / 45));
    out[k] = 0.3 + 0.15 * waterfront + 0.07 * view;
  }
  settingCache.set(water, out);
  return out;
}

/** Cells within `r` cells of a centre, as (di, dj, 1 − distance / r) triples; cached per radius. */
const kernels = new Map<number, Float64Array>();
function kernel(r: number): Float64Array {
  let k = kernels.get(r);
  if (k) return k;
  const out: number[] = [];
  for (let dj = -Math.ceil(r); dj <= Math.ceil(r); dj++) {
    for (let di = -Math.ceil(r); di <= Math.ceil(r); di++) {
      const d = Math.hypot(di, dj) / r;
      if (d <= 1) out.push(di, dj, 1 - d);
    }
  }
  kernels.set(r, (k = Float64Array.from(out)));
  return k;
}

export function landValueAt(sim: Sim, x: number, z: number): number {
  const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(x / GRID_CELL)));
  const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(z / GRID_CELL)));
  return sim.state.landValue[j * GRID_RES + i]!;
}
