import { POLICY_EFFECTS } from '../../data/policies';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { ENVIRONMENT } from '../../data/balance';
import { seedFromString } from '../rng';
import { TICKS_PER_MONTH } from '../time';
import { ZONE_I } from '../../data/zones';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import { civicDef, civicOnline } from '../world/civic';

/**
 * Ground pollution raster (DESIGN §3.11). M4: industry, sewage outflows, landfills and unserved
 * sewage; slow spread and decay. Air pollution with wind drift joins in M7.
 */
/** Crime fades over time. */
export function decayCrime(sim: Sim, hours: number): void {
  const f = sim.state.crime;
  const k = Math.pow(0.97, hours);
  for (let i = 0; i < f.length; i++) f[i] = f[i]! < 0.001 ? 0 : f[i]! * k;
}

export function splatField(
  field: Float32Array,
  x: number,
  z: number,
  amount: number,
  radiusCells: number,
): void {
  splat(field, x, z, amount, radiusCells);
}

function splat(field: Float32Array, x: number, z: number, amount: number, radiusCells: number): void {
  const ci = Math.floor(x / GRID_CELL);
  const cj = Math.floor(z / GRID_CELL);
  const r = Math.max(1, Math.ceil(radiusCells));
  let wsum = 0;
  const cells: [number, number][] = [];
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) continue;
      const d2 = (di * di + dj * dj) / (radiusCells * radiusCells);
      if (d2 > 1) continue;
      const w = 1 - d2;
      cells.push([j * GRID_RES + i, w]);
      wsum += w;
    }
  }
  if (wsum <= 0) return; // only the zero-weight rim is on the map
  for (const [k, w] of cells) field[k] = field[k]! + (amount * w) / wsum;
}

export function updateGroundPollution(sim: Sim, hours: number): void {
  const s = sim.state;
  const field = s.groundPollution;
  const add = new Float32Array(field.length);
  // Clean industry grants, across the city or in a district (M21).
  const clean = (b: Building) => (sim.policyAt('cleanIndustry', b.x, b.z) ? POLICY_EFFECTS.cleanIndustry : 1);
  for (const b of s.buildings.values()) {
    if (b.state !== BState.Active) continue;
    if (b.zone === ZONE_I && b.wealth === 0) splat(add, b.x, b.z, 0.012 * b.w * b.d * hours * clean(b), 3);
    if (b.sewage < 0.99) splat(add, b.x, b.z, 0.01 * (1 - b.sewage) * b.w * b.d * hours, 2);
  }
  for (const c of s.civics.values()) {
    const def = civicDef(c);
    if (def.groundPollution) {
      const radius = def.pollutionRadius ?? (def.w + 80) / 2;
      const area = (radius / 60) ** 2;
      splat(add, c.x, c.z, def.groundPollution * 0.8 * area * hours, radius / GRID_CELL);
    }
  }
  // Slow spread, decay, sources; clamp to [0, 1].
  const out = new Float32Array(field.length);
  const decay = Math.pow(0.994, hours);
  for (let j = 0; j < GRID_RES; j++) {
    for (let i = 0; i < GRID_RES; i++) {
      const k = j * GRID_RES + i;
      let nb = 0;
      let cnt = 0;
      if (i > 0) {
        nb += field[k - 1]!;
        cnt++;
      }
      if (i < GRID_RES - 1) {
        nb += field[k + 1]!;
        cnt++;
      }
      if (j > 0) {
        nb += field[k - GRID_RES]!;
        cnt++;
      }
      if (j < GRID_RES - 1) {
        nb += field[k + GRID_RES]!;
        cnt++;
      }
      const v = field[k]! * 0.96 + (cnt ? (nb / cnt) * 0.04 : 0);
      out[k] = Math.max(0, Math.min(1, v * decay + add[k]!));
    }
  }
  field.set(out);
}

export function fieldAt(field: Float32Array, x: number, z: number): number {
  const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(x / GRID_CELL)));
  const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(z / GRID_CELL)));
  return field[j * GRID_RES + i]!;
}

/**
 * Direction the wind blows towards (radians, x/z plane) at a tick: a prevailing direction from the
 * map seed, wobbling slowly over the seasons. A pure function, so it needs no saved state.
 */
export function windAngle(seed: string, tick: number): number {
  const base = (seedFromString(`${seed}:wind`)[0] / 4294967296) * Math.PI * 2;
  return base + 0.35 * Math.sin((2 * Math.PI * tick) / (TICKS_PER_MONTH * 5));
}

/**
 * Air pollution raster (DESIGN §3.11), every 3 h: add sources (industry by tier, power plants and
 * incinerators, traffic along roads), move the whole field downwind (semi-Lagrangian), diffuse,
 * decay, and let trees and parks absorb some.
 */
export function updateAirPollution(sim: Sim, hours: number): void {
  const clean = (b: Building) => (sim.policyAt('cleanIndustry', b.x, b.z) ? POLICY_EFFECTS.cleanIndustry : 1);
  const s = sim.state;
  const E = ENVIRONMENT;
  const field = s.airPollution;
  const add = new Float32Array(field.length);
  const k = hours / 3;
  for (const b of s.buildings.values()) {
    if (b.state !== BState.Active || b.zone !== ZONE_I) continue;
    const busy = b.cap > 0 ? Math.min(1, b.pop / b.cap) : 0;
    splat(add, b.x, b.z, E.industryAir[b.wealth]! * b.w * b.d * busy * k * clean(b), 2);
  }
  for (const c of s.civics.values()) {
    const def = civicDef(c);
    if (!def.airPollution || !civicOnline(c)) continue;
    splat(add, c.x, c.z, def.airPollution * ENVIRONMENT.plantAir * k, Math.max(1.5, def.w / 2 / GRID_CELL));
  }
  for (const [segId, vol] of s.traffic) {
    if (!s.net.segments.has(segId) || vol < 50) continue;
    const curve = sim.net.curve(segId);
    const n = Math.max(1, Math.round(curve.length / GRID_CELL));
    const per = (vol * E.trafficAir * curve.length * k) / n;
    for (let i = 0; i < n; i++) {
      const p = curve.pointAt(((i + 0.5) * curve.length) / n);
      splat(add, p.x, p.z, per * GRID_CELL, 1);
    }
  }
  // Parks soak up pollution around them.
  const parks = new Float32Array(field.length);
  for (const c of s.civics.values()) {
    const def = civicDef(c);
    if (def.service?.kind !== 'park') continue;
    stamp(parks, c.x, c.z, Math.max(1.5, (def.w + 24) / 2 / GRID_CELL));
  }
  const a = windAngle(s.options.seed, s.tick);
  const dx = Math.cos(a) * E.windCells * k;
  const dz = Math.sin(a) * E.windCells * k;
  const decay = Math.pow(E.airDecay, k);
  const moved = new Float32Array(field.length);
  const at = (i: number, j: number) =>
    i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES ? 0 : field[j * GRID_RES + i]!;
  for (let j = 0; j < GRID_RES; j++) {
    for (let i = 0; i < GRID_RES; i++) {
      // Sample upwind with bilinear interpolation.
      const x = i - dx;
      const z = j - dz;
      const i0 = Math.floor(x);
      const j0 = Math.floor(z);
      const fx = x - i0;
      const fz = z - j0;
      moved[j * GRID_RES + i] =
        at(i0, j0) * (1 - fx) * (1 - fz) +
        at(i0 + 1, j0) * fx * (1 - fz) +
        at(i0, j0 + 1) * (1 - fx) * fz +
        at(i0 + 1, j0 + 1) * fx * fz;
    }
  }
  const out = new Float32Array(field.length);
  for (let j = 0; j < GRID_RES; j++) {
    for (let i = 0; i < GRID_RES; i++) {
      const idx = j * GRID_RES + i;
      let nb = 0;
      let cnt = 0;
      if (i > 0) {
        nb += moved[idx - 1]!;
        cnt++;
      }
      if (i < GRID_RES - 1) {
        nb += moved[idx + 1]!;
        cnt++;
      }
      if (j > 0) {
        nb += moved[idx - GRID_RES]!;
        cnt++;
      }
      if (j < GRID_RES - 1) {
        nb += moved[idx + GRID_RES]!;
        cnt++;
      }
      let v = moved[idx]! * (1 - E.airDiffusion) + (cnt ? (nb / cnt) * E.airDiffusion : 0);
      v *= decay;
      v *= 1 - E.treeAbsorb * (s.trees[idx]! / 255);
      v *= 1 - E.parkAbsorb * parks[idx]!;
      v += add[idx]!;
      out[idx] = v < 1e-4 ? 0 : Math.min(1, v);
    }
  }
  field.set(out);
}

/** Mark cells within `radiusCells` of (x, z) with 1 at the centre fading to 0.5 at the edge (max-combined). */
function stamp(field: Float32Array, x: number, z: number, radiusCells: number): void {
  const ci = Math.floor(x / GRID_CELL);
  const cj = Math.floor(z / GRID_CELL);
  const r = Math.ceil(radiusCells);
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) continue;
      const d = Math.hypot(di, dj) / radiusCells;
      if (d > 1) continue;
      const k = j * GRID_RES + i;
      field[k] = Math.max(field[k]!, 1 - 0.5 * d);
    }
  }
}
