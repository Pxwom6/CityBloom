import { GRADING, roadHalfWidth, type RoadTypeId } from '../../data/roads';
import { GRID_CELL, GRID_RES, HEIGHT_RES, HEIGHT_STEP, SHORE_HEIGHT } from '../../data/world';
import { pointRectDistance, type Curve, type ORect } from '../geom';
import type { Sim } from '../sim';
import type { Terrain } from '../terrain/terrain';
import type { Network } from './network';
import type { Box } from './spatial';
import { profileAt, type GradeProfile } from './grading';

/**
 * Earthworks (M13): the cut and fill that lays a graded road into the ground. A flat formation
 * (the road, its shoulders and a bench wide enough for the first row of lots) is set to the road's
 * profile, and side slopes run from its edge back to the natural ground: an embankment where the
 * road is above it, a cutting where it's below. Other roads, buildings and water are left alone.
 * Edits are to the terrain's height samples and are saved as deltas on the generated terrain.
 * DESIGN.md §3.15.
 */
export interface EarthPiece {
  curve: Curve;
  type: RoadTypeId;
  prof: GradeProfile;
  /** Ends that join an existing road: the ground beyond them belongs to that road. */
  joined: [boolean, boolean];
}

export interface EarthPlan {
  /** Height samples to change (ascending) and their new heights. */
  idx: number[];
  to: number[];
  /** Earth moved, cubic metres (cut + fill), and what it costs. */
  volume: number;
  cut: number;
  fill: number;
  cost: number;
  /** Area touched, or null when nothing changes. */
  box: Box | null;
}

/** What a set of edits replaced, for undo: the samples and their earlier deltas. */
export interface TerrainEdit {
  idx: number[];
  before: number[];
}

const AREA = HEIGHT_STEP * HEIGHT_STEP;

/** Half-width of the road's own corridor (road plus shoulders) and of the widest formation. */
export function formation(type: RoadTypeId): { corridor: number; inner: number } {
  const corridor = roadHalfWidth(type) + GRADING.shoulder;
  return { corridor, inner: corridor + GRADING.bench };
}

/**
 * Plan the earthworks for `pieces` over the current terrain. `keep(x, z)` marks ground that must
 * not change (existing buildings); ground inside other roads' corridors is never touched.
 */
export function planEarthworks(
  terrain: Terrain,
  net: Network,
  pieces: EarthPiece[],
  keep?: (x: number, z: number) => boolean,
  /** Roads whose corridors may be regraded too (a road being upgraded). */
  ignore?: ReadonlySet<number>,
): EarthPlan {
  const out: EarthPlan = { idx: [], to: [], volume: 0, cut: 0, fill: 0, cost: 0, box: null };
  if (!pieces.length) return out;
  // The nearest piece claims each sample it reaches.
  const best = new Map<number, { k: number; s: number; d: number }>();
  pieces.forEach((pc, k) => {
    const { inner } = formation(pc.type);
    // Side slopes reach out to where they meet the ground (a cutting deepens across a hillside).
    const reach =
      inner + Math.max(GRADING.fillSlope * (pc.prof.maxFill + 3), GRADING.cutSlope * (pc.prof.maxCut + 12));
    const box = pc.curve.bbox(reach);
    const i0 = Math.max(0, Math.ceil(box.minX / HEIGHT_STEP));
    const i1 = Math.min(HEIGHT_RES - 1, Math.floor(box.maxX / HEIGHT_STEP));
    const j0 = Math.max(0, Math.ceil(box.minZ / HEIGHT_STEP));
    const j1 = Math.min(HEIGHT_RES - 1, Math.floor(box.maxZ / HEIGHT_STEP));
    const L = pc.curve.length;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = pc.curve.project({ x: i * HEIGHT_STEP, z: j * HEIGHT_STEP });
        if (p.d > reach) continue;
        if ((pc.joined[0] && p.s <= 1e-6) || (pc.joined[1] && p.s >= L - 1e-6)) continue;
        const idx = j * HEIGHT_RES + i;
        const b = best.get(idx);
        if (!b || p.d < b.d) best.set(idx, { k, s: p.s, d: p.d });
      }
    }
  });
  // How deep each piece is cut or filled around each sample (±8 m): the level bench beside the
  // road widens with it, so a road at grade leaves the lots beside it as they were.
  const depths = pieces.map(({ prof }) => {
    const n = prof.h.length;
    const raw = Array.from(prof.h, (h, i) =>
      prof.ground[i]! < SHORE_HEIGHT ? 0 : Math.abs(h - prof.ground[i]!),
    );
    return raw.map((_, i) => Math.max(...raw.slice(Math.max(0, i - 2), Math.min(n, i + 3))));
  });
  const keys = [...best.keys()].sort((a, b) => a - b);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const idx of keys) {
    const { k, s, d } = best.get(idx)!;
    const pc = pieces[k]!;
    const prof = pc.prof;
    const x = (idx % HEIGHT_RES) * HEIGHT_STEP;
    const z = Math.floor(idx / HEIGHT_RES) * HEIGHT_STEP;
    const cur = terrain.heights[idx]!;
    if (cur < SHORE_HEIGHT || terrain.base[idx]! < SHORE_HEIGHT) continue; // water stays water
    const si = Math.max(0, Math.min(prof.h.length - 1, Math.round(s / prof.step)));
    if (prof.raised[si] || prof.ground[si]! < SHORE_HEIGHT) continue; // under a viaduct or bridge
    const { corridor } = formation(pc.type);
    const inner = corridor + Math.min(GRADING.bench, GRADING.benchPerDepth * depths[k]![si]!);
    if (d > corridor && keep?.(x, z)) continue;
    if (inOtherRoad(net, x, z, ignore)) continue;
    const H = profileAt(prof, s);
    let t: number;
    if (d <= inner) t = H;
    else if (H > cur) t = Math.max(cur, H - (d - inner) / GRADING.fillSlope);
    else t = Math.min(cur, H + (d - inner) / GRADING.cutSlope);
    // Never dig dry land down into the water table.
    if (t < SHORE_HEIGHT + 0.1) t = Math.max(t, Math.min(cur, SHORE_HEIGHT + 0.1));
    const dh = t - cur;
    if (Math.abs(dh) < GRADING.minEdit) continue;
    out.idx.push(idx);
    out.to.push(t);
    if (dh > 0) out.fill += dh * AREA;
    else out.cut -= dh * AREA;
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  out.cut = Math.round(out.cut);
  out.fill = Math.round(out.fill);
  out.volume = out.cut + out.fill;
  out.cost = Math.round(out.volume * GRADING.costPerCubicMetre);
  if (out.idx.length)
    out.box = {
      minX: minX - HEIGHT_STEP,
      minZ: minZ - HEIGHT_STEP,
      maxX: maxX + HEIGHT_STEP,
      maxZ: maxZ + HEIGHT_STEP,
    };
  return out;
}

/** Inside the corridor (road plus shoulders) of a road that already exists? */
function inOtherRoad(net: Network, x: number, z: number, ignore?: ReadonlySet<number>): boolean {
  for (const id of net.segHash.queryPoint(x, z, GRADING.shoulder + 0.5)) {
    if (ignore?.has(id)) continue;
    const r = net.halfWidth(id) + GRADING.shoulder;
    if (net.curve(id).project({ x, z }).d <= r) return true;
  }
  return false;
}

/**
 * Write planned heights (or, with `asDelta`, deltas) into the terrain and its saved delta. Returns
 * the deltas they replaced (for undo); `mark` hears about every changed sample.
 */
export function applyHeights(
  terrain: Terrain,
  delta: Float32Array,
  idx: readonly number[],
  to: readonly number[],
  mark: (idx: number) => void,
  asDelta = false,
): TerrainEdit {
  const before: number[] = [];
  for (let n = 0; n < idx.length; n++) {
    const i = idx[n]!;
    before.push(delta[i]!);
    // Height is always seed + delta, computed the same way as on load, so saves match exactly.
    // Deltas are whole centimetres, which keeps saves small (they compress well).
    delta[i] = asDelta ? to[n]! : Math.round((to[n]! - terrain.base[i]!) * 100) / 100;
    terrain.heights[i] = terrain.base[i]! + delta[i]!;
    mark(i);
  }
  return { idx: [...idx], before };
}

/**
 * Tree-grid cells (GRID_CELL) whose ground moved by more than half a metre, with the share of
 * their height samples that did: construction clears the vegetation on new slopes.
 */
export function disturbedTreeCells(
  delta: Float32Array,
  idx: readonly number[],
  before: readonly number[],
): Map<number, number> {
  const per = GRID_CELL / HEIGHT_STEP;
  const hit = new Map<number, number>();
  for (let n = 0; n < idx.length; n++) {
    const i = idx[n]!;
    if (Math.abs(delta[i]! - before[n]!) < 0.5) continue;
    const gx = Math.min(GRID_RES - 1, Math.floor((i % HEIGHT_RES) / per));
    const gz = Math.min(GRID_RES - 1, Math.floor(Math.floor(i / HEIGHT_RES) / per));
    const k = gz * GRID_RES + gx;
    hit.set(k, (hit.get(k) ?? 0) + 1 / (per * per));
  }
  return hit;
}

/**
 * Height a footprint sits at: the highest ground under its corners and centre (zoned lots), plus
 * its edge midpoints (civic buildings). Plinths hide the ground falling away below.
 */
export function seatHeight(
  heightAt: (x: number, z: number) => number,
  r: { x: number; z: number; hw: number; hd: number; angle: number },
  edges: boolean,
): number {
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  let hi = heightAt(r.x, r.z);
  for (const [u, v] of edges ? SEAT_EDGES : SEAT_CORNERS)
    hi = Math.max(hi, heightAt(r.x + u * r.hw * c - v * r.hd * s, r.z + u * r.hw * s + v * r.hd * c));
  return hi;
}

const SEAT_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
const SEAT_EDGES = [...SEAT_CORNERS, [0, -1], [0, 1], [-1, 0], [1, 0]] as const;

/**
 * Set terrain heights (earthworks), or deltas (their undo), and settle what stands on the ground:
 * trees on new slopes are cleared, buildings re-seated. Returns the deltas they replaced.
 */
export function reshapeGround(
  sim: Sim,
  idx: readonly number[],
  to: readonly number[],
  asDelta = false,
): TerrainEdit {
  const edit = applyHeights(
    sim.terrain,
    sim.state.terrainDelta,
    idx,
    to,
    (i) => sim.markTerrainDirty(i),
    asDelta,
  );
  const trees = sim.state.trees;
  for (const [k, share] of disturbedTreeCells(sim.state.terrainDelta, edit.idx, edit.before)) {
    const next = Math.round(trees[k]! * Math.max(0, 1 - share));
    if (next !== trees[k]) {
      trees[k] = next;
      sim.markTreesDirty(k);
    }
  }
  sim.groundMoved(samplesBox(idx));
  return edit;
}

/** Bounding box of terrain samples, grown by one sample spacing (the ground they shape). */
export function samplesBox(idx: readonly number[]): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const i of idx) {
    const x = (i % HEIGHT_RES) * HEIGHT_STEP;
    const z = Math.floor(i / HEIGHT_RES) * HEIGHT_STEP;
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  return {
    minX: minX - HEIGHT_STEP,
    minZ: minZ - HEIGHT_STEP,
    maxX: maxX + HEIGHT_STEP,
    maxZ: maxZ + HEIGHT_STEP,
  };
}

/**
 * A level pad for a civic building on uneven ground (M13): the footprint and a margin around it
 * set to `y`, with side slopes back to the natural ground. Roads, water and `keep` are left alone.
 */
export function planPad(
  terrain: Terrain,
  net: Network,
  rect: ORect,
  y: number,
  keep?: (x: number, z: number) => boolean,
): EarthPlan {
  const out: EarthPlan = { idx: [], to: [], volume: 0, cut: 0, fill: 0, cost: 0, box: null };
  const margin = GRADING.padMargin;
  const rad = Math.hypot(rect.hw, rect.hd);
  let span = 0;
  const scan = (r: number, f: (idx: number, x: number, z: number, d: number) => void) => {
    const i0 = Math.max(0, Math.ceil((rect.x - rad - r) / HEIGHT_STEP));
    const i1 = Math.min(HEIGHT_RES - 1, Math.floor((rect.x + rad + r) / HEIGHT_STEP));
    const j0 = Math.max(0, Math.ceil((rect.z - rad - r) / HEIGHT_STEP));
    const j1 = Math.min(HEIGHT_RES - 1, Math.floor((rect.z + rad + r) / HEIGHT_STEP));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = i * HEIGHT_STEP;
        const z = j * HEIGHT_STEP;
        const d = pointRectDistance({ x, z }, rect);
        if (d <= r) f(j * HEIGHT_RES + i, x, z, d);
      }
  };
  scan(margin, (idx) => (span = Math.max(span, Math.abs(terrain.heights[idx]! - y))));
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  scan(margin + Math.max(GRADING.fillSlope, GRADING.cutSlope) * (span + 1), (idx, x, z, d) => {
    const cur = terrain.heights[idx]!;
    if (cur < SHORE_HEIGHT || terrain.base[idx]! < SHORE_HEIGHT) return;
    if (inOtherRoad(net, x, z) || keep?.(x, z)) return;
    let t: number;
    if (d <= margin) t = y;
    else if (y > cur) t = Math.max(cur, y - (d - margin) / GRADING.fillSlope);
    else t = Math.min(cur, y + (d - margin) / GRADING.cutSlope);
    const dh = t - cur;
    if (Math.abs(dh) < 0.02) return;
    out.idx.push(idx);
    out.to.push(t);
    if (dh > 0) out.fill += dh * AREA;
    else out.cut -= dh * AREA;
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  });
  out.cut = Math.round(out.cut);
  out.fill = Math.round(out.fill);
  out.volume = out.cut + out.fill;
  out.cost = Math.round(out.volume * GRADING.costPerCubicMetre);
  if (out.idx.length)
    out.box = {
      minX: minX - HEIGHT_STEP,
      minZ: minZ - HEIGHT_STEP,
      maxX: maxX + HEIGHT_STEP,
      maxZ: maxZ + HEIGHT_STEP,
    };
  return out;
}
