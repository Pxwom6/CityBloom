import { GRID_CELL, GRID_RES, HEIGHT_RES, HEIGHT_STEP, MAP_SIZE, type MapPreset } from '../../data/world';
import { Rng } from '../rng';
import { Noise2D, clamp, lerp, smoothstep } from './noise';

/**
 * Terrain generator version for new cities. Saved cities keep the version they were founded with
 * (`GameOptions.terrain`), since terrain is regenerated from the seed on load. 1: original.
 * 2 (M12): the start area round the highway entrance is kept gentle, so every seed takes a first
 * grid of streets.
 */
export const TERRAIN_VERSION = 2;

/**
 * Deterministic terrain. `TerrainGen.height(x, z)` is a pure function defined everywhere, so the sim
 * samples it on the buildable area and the renderer uses it for the scenery beyond. DESIGN.md §2.1.
 */
export interface TerrainParams {
  seed: string;
  preset: MapPreset;
  river: { points: [number, number][]; halfWidth: number } | null;
  coast: { baseX: number; amp: number; phase: number } | null;
  lakes: { x: number; z: number; r: number }[];
  hillAmp: number;
  /** Regional highway: runs north–south at x = lineX (off-map); the connector enters at z = connectZ. */
  highway: { lineX: number; connectZ: number; height: number };
  /** Prevailing wind direction (unit vector). */
  wind: { x: number; z: number };
  /** Generator version (see TERRAIN_VERSION). */
  version: number;
  /**
   * A custom map (M24): the ground inside the map is the map's own; these settings only shape the
   * scenery beyond it, which blends from the map's edge into them.
   */
  custom?: boolean;
}

export class TerrainGen {
  readonly params: TerrainParams;
  private nBase: Noise2D;
  private nHills: Noise2D;
  private nDetail: Noise2D;
  private nForest: Noise2D;
  private nRes: Noise2D;
  private flattenHighway: boolean;

  constructor(params: TerrainParams, flattenHighway = true) {
    this.params = params;
    this.nBase = new Noise2D(`${params.seed}:base`);
    this.nHills = new Noise2D(`${params.seed}:hills`);
    this.nDetail = new Noise2D(`${params.seed}:detail`);
    this.nForest = new Noise2D(`${params.seed}:forest`);
    this.nRes = new Noise2D(`${params.seed}:res`);
    this.flattenHighway = flattenHighway;
  }

  static create(seed: string, preset: MapPreset, version = TERRAIN_VERSION): TerrainGen {
    const rng = Rng.fromSeed(`terrain:${seed}:${preset}`);
    const params: TerrainParams = {
      seed,
      preset,
      river: null,
      coast: null,
      lakes: [],
      hillAmp: preset === 'highlands' ? 120 : preset === 'lakes' ? 55 : 75,
      highway: { lineX: -110, connectZ: 1024, height: 10 },
      wind: { x: 1, z: 0 },
      version,
    };
    const windAngle = rng.range(-0.6, 0.6); // mostly westerly: pollution drifts east, away from the start
    params.wind = { x: Math.cos(windAngle), z: Math.sin(windAngle) };

    if (preset === 'river' || preset === 'highlands') {
      const x0 = rng.range(1150, 1450);
      const x1 = rng.range(1150, 1500);
      const phase = rng.range(0, Math.PI * 2);
      const amp = preset === 'river' ? rng.range(120, 200) : rng.range(60, 110);
      const pts: [number, number][] = [];
      const n = 48;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const z = lerp(-900, MAP_SIZE + 900, t);
        const x =
          lerp(x0, x1, t) + amp * Math.sin(t * Math.PI * 2.4 + phase) + 40 * Math.sin(t * 17 + phase * 3);
        pts.push([x, z]);
      }
      params.river = { points: pts, halfWidth: preset === 'river' ? rng.range(34, 44) : rng.range(16, 22) };
    }
    if (preset === 'coast') {
      params.coast = {
        baseX: rng.range(1500, 1650),
        amp: rng.range(90, 160),
        phase: rng.range(0, Math.PI * 2),
      };
    }
    if (preset === 'lakes') {
      const count = 3 + rng.int(2);
      for (let i = 0; i < count; i++) {
        params.lakes.push({ x: rng.range(800, 1900), z: rng.range(200, 1850), r: rng.range(90, 190) });
      }
    }
    // Pick the flattest dry spot on the west edge for the highway connection (with the original
    // start-area easing, which doesn't depend on where the connection is).
    const probe = new TerrainGen({ ...params, version: 1 }, false);
    let best = 1024;
    let bestScore = Infinity;
    for (let z = 500; z <= 1550; z += 25) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = -40; x <= 260; x += 20) {
        for (let dz = -60; dz <= 60; dz += 30) {
          const h = probe.height(x, z + dz);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      const score = (hi - lo) * 2 + Math.abs(z - 1024) * 0.02 + (lo < 2 ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = z;
      }
    }
    params.highway.connectZ = best;
    params.highway.height = probe.height(20, best);
    return new TerrainGen(params);
  }

  /** Distance from (x, z) to the river centreline (Infinity if there is no river). */
  riverDistance(x: number, z: number): number {
    const r = this.params.river;
    if (!r) return Infinity;
    let best = Infinity;
    const pts = r.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]!;
      const [bx, bz] = pts[i + 1]!;
      // Cheap reject: segment bounding box farther than the current best.
      if (x < Math.min(ax, bx) - best || x > Math.max(ax, bx) + best) continue;
      if (z < Math.min(az, bz) - best || z > Math.max(az, bz) + best) continue;
      const dx = bx - ax;
      const dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = ax + dx * t - x;
      const pz = az + dz * t - z;
      const d = Math.sqrt(px * px + pz * pz);
      if (d < best) best = d;
    }
    return best;
  }

  /** Signed distance to the coastline: negative on land, positive out to sea. */
  coastDistance(x: number, z: number): number {
    const c = this.params.coast;
    if (!c) return -Infinity;
    const cx = c.baseX + c.amp * Math.sin(z / 420 + c.phase) + 70 * this.nDetail.fbm(z / 600, 3.7, 3);
    return x - cx;
  }

  /** Distance to the nearest lake shore (negative inside a lake). */
  lakeDistance(x: number, z: number): number {
    let best = Infinity;
    for (const l of this.params.lakes) {
      const wobble = 25 * this.nDetail.noise(x / 90 + l.x, z / 90 + l.z);
      const d = Math.hypot(x - l.x, z - l.z) - l.r - wobble;
      if (d < best) best = d;
    }
    return best;
  }

  height(x: number, z: number): number {
    const p = this.params;
    // Rolling base, a few distinct hill ranges, and fine detail.
    let h = 10 + 5 * this.nBase.fbm(x / 1100, z / 1100, 4);
    const hillMask = smoothstep(0.12, 0.5, this.nHills.fbm(x / 1500 + 7, z / 1500 - 3, 3));
    const hillShape = 0.55 + 0.45 * this.nHills.fbm(x / 380 + 50, z / 380, 4);
    // Keep the start area near the highway gentler.
    let startEase = 0.3 + 0.7 * smoothstep(200, 900, x);
    // Version 2: hills fade out round the highway entrance (to about 4 m), whatever the seed.
    if (p.version >= 2) {
      const d = Math.hypot(x, (z - p.highway.connectZ) * 0.8);
      const floor = 4 / p.hillAmp;
      startEase = Math.min(startEase, floor + (1 - floor) * smoothstep(450, 1050, d));
    }
    h += p.hillAmp * hillMask * hillShape * hillShape * startEase;
    h += 0.7 * this.nDetail.fbm(x / 140, z / 140, 2);

    // Mountains ring beyond the buildable area.
    const ox = Math.max(0, -x, x - MAP_SIZE);
    const oz = Math.max(0, -z, z - MAP_SIZE);
    const out = Math.hypot(ox, oz);
    if (out > 0) {
      const ring = smoothstep(250, 2400, out);
      h += ring * (60 + 170 * this.nBase.ridged(x / 1100, z / 1100, 4));
    }

    // Highway corridor (off-map, north–south) and the connector into the map.
    if (this.flattenHighway) {
      const hw = p.highway;
      const wLine = 1 - smoothstep(45, 170, Math.abs(x - hw.lineX));
      const wConn =
        (1 - smoothstep(30, 110, Math.abs(z - hw.connectZ))) *
        (1 - smoothstep(40, 200, x)) *
        (x > hw.lineX ? 1 : 0);
      const w = Math.max(wLine, wConn);
      if (w > 0) h = lerp(h, hw.height, w);
    }

    // Lakes.
    if (p.lakes.length) {
      const d = this.lakeDistance(x, z);
      if (d < 160) {
        h = lerp(h, Math.min(h, 1.5 + Math.max(0, d) * 0.05), 1 - smoothstep(0, 160, d));
        if (d < 12) h = lerp(-5, h, smoothstep(-40, 12, d));
      }
    }

    // River valley and channel.
    if (p.river) {
      const d = this.riverDistance(x, z);
      const hw = p.river.halfWidth;
      if (d < hw + 420) {
        const valley = 1 - smoothstep(hw, hw + 420, d);
        h -= valley * (h - 2.5) * 0.6;
        const t = smoothstep(hw - 8, hw + 26, d);
        h = lerp(-4.5, h, t);
      }
    }

    // Sea to the east.
    if (p.coast) {
      const s = this.coastDistance(x, z);
      if (s > -260) {
        const beach = 1 - smoothstep(-260, -40, s);
        h = lerp(h, 1.4 + Math.max(0, -s) * 0.01, beach * 0.85);
        const sea = smoothstep(-40, 90, s);
        h = lerp(h, -14, sea);
      }
    }
    return h;
  }

  /** Forest density in [0, 1] from noise (before slope/water masking). */
  forestNoise(x: number, z: number): number {
    return smoothstep(0.02, 0.42, this.nForest.fbm(x / 380 + 900, z / 380 - 300, 4));
  }

  resourceNoise(kind: 'water' | 'ore' | 'oil', x: number, z: number): number {
    if (kind === 'water') return this.nRes.fbm(x / 500, z / 500, 3);
    if (kind === 'ore') return this.nRes.fbm(x / 330 + 300, z / 330 - 200, 3);
    return this.nRes.fbm(x / 600 - 500, z / 600 + 700, 3);
  }
}

export interface TerrainData {
  heights: Float32Array; // HEIGHT_RES²
  trees: Uint8Array; // GRID_RES², density 0..255
  groundwater: Uint8Array; // GRID_RES², 0..255
  ore: Uint8Array;
  oil: Uint8Array;
}

export function generateTerrain(gen: TerrainGen): TerrainData {
  const heights = new Float32Array(HEIGHT_RES * HEIGHT_RES);
  for (let j = 0; j < HEIGHT_RES; j++) {
    for (let i = 0; i < HEIGHT_RES; i++) {
      heights[j * HEIGHT_RES + i] = gen.height(i * HEIGHT_STEP, j * HEIGHT_STEP);
    }
  }
  const n = GRID_RES * GRID_RES;
  const trees = new Uint8Array(n);
  const groundwater = new Uint8Array(n);
  const ore = new Uint8Array(n);
  const oil = new Uint8Array(n);
  const hw = gen.params.highway;
  for (let j = 0; j < GRID_RES; j++) {
    for (let i = 0; i < GRID_RES; i++) {
      const x = (i + 0.5) * GRID_CELL;
      const z = (j + 0.5) * GRID_CELL;
      const h = sampleHeights(heights, x, z);
      const hx = sampleHeights(heights, x + 8, z) - sampleHeights(heights, x - 8, z);
      const hz = sampleHeights(heights, x, z + 8) - sampleHeights(heights, x, z - 8);
      const slope = Math.hypot(hx, hz) / 16;
      const k = j * GRID_RES + i;
      const nearWater = Math.min(
        gen.riverDistance(x, z),
        Math.max(0, -gen.coastDistance(x, z)),
        Math.max(0, gen.lakeDistance(x, z)),
      );
      // Trees: forests on dry, not-too-steep land, thinned near the highway so the start is open.
      let forest = gen.forestNoise(x, z);
      if (h < 1.6 || slope > 0.7) forest = 0;
      forest *= 0.3 + 0.7 * smoothstep(60, 320, Math.hypot(x - 0, z - hw.connectZ));
      trees[k] = Math.round(clamp(forest, 0, 1) * 255);
      // Groundwater: higher in lowlands and near water.
      const gw =
        0.45 +
        0.35 * gen.resourceNoise('water', x, z) +
        0.35 * (1 - smoothstep(0, 450, nearWater)) -
        Math.max(0, h - 18) / 70;
      groundwater[k] = h < 0.5 ? 0 : Math.round(clamp(gw, 0, 1) * 255);
      const o = smoothstep(0.3, 0.65, gen.resourceNoise('ore', x, z)) * smoothstep(12, 40, h);
      ore[k] = h < 0.5 ? 0 : Math.round(clamp(o, 0, 1) * 255);
      const oi = smoothstep(0.42, 0.72, gen.resourceNoise('oil', x, z));
      oil[k] = h < 0.5 ? 0 : Math.round(clamp(oi, 0, 1) * 255);
    }
  }
  return { heights, trees, groundwater, ore, oil };
}

/** Bilinear height lookup on the HEIGHT_RES² grid; clamps outside the map. */
export function sampleHeights(heights: Float32Array, x: number, z: number): number {
  const fx = clamp(x / HEIGHT_STEP, 0, HEIGHT_RES - 1.0001);
  const fz = clamp(z / HEIGHT_STEP, 0, HEIGHT_RES - 1.0001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const a = heights[j * HEIGHT_RES + i]!;
  const b = heights[j * HEIGHT_RES + i + 1]!;
  const c = heights[(j + 1) * HEIGHT_RES + i]!;
  const d = heights[(j + 1) * HEIGHT_RES + i + 1]!;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
