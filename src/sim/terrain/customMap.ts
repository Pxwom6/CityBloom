import { CLIMATES, PRESET_CLIMATE, type ClimateId } from '../../data/climate';
import { MAX_CELL_SLOPE } from '../../data/zones';
import {
  GRID_CELL,
  GRID_RES,
  HEIGHT_RES,
  MAP_PRESETS,
  MAP_SIZE,
  SHORE_HEIGHT,
  type MapPreset,
} from '../../data/world';
import { TERRAIN_VERSION, TerrainGen, generateTerrain, sampleHeights, type TerrainParams } from './generate';
import { clamp, smoothstep } from './noise';

/**
 * Custom maps (M24): a map made in the editor. The ground inside the map is its own (absolute
 * heights, forests, ore and oil); the scenery beyond the edges, the wind and the regional highway's
 * line come from a generator seed and preset, and the map says where the highway and railway come
 * in on the west edge. Cities founded on a map keep it in their save, since terrain is rebuilt
 * on load. Heights are kept in whole centimetres, delta-coded along each row: small numbers,
 * which compress well. DESIGN.md §3.25.
 */
export const MAP_FORMAT = 1;
export const MAP_FILE_FORMAT = 'citybloom-map';

/** Heights a map may have, metres (so row deltas fit a 16-bit centimetre count). */
export const MAP_MIN_HEIGHT = -30;
export const MAP_MAX_HEIGHT = 290;
/** The highway and railway come in at least this far from the map's corners, and this far apart. */
export const ENTRY_MARGIN = 200;
export const ENTRY_SPACING = 160;

export interface MapData {
  format: number;
  name: string;
  /** Scenery beyond the edges, the wind and the region's names come from these. */
  seed: string;
  preset: MapPreset;
  climate: ClimateId;
  /** HEIGHT_RES² heights, centimetres, delta-coded along rows (see `packHeights`). */
  heights: Int16Array;
  /** GRID_RES² forest density, ore and oil (0–255). */
  trees: Uint8Array;
  ore: Uint8Array;
  oil: Uint8Array;
  /** Where the regional highway comes in on the west edge (z, metres). */
  highwayZ: number;
  /** Where the regional railway comes in (z), or null for a map without one. */
  railZ: number | null;
}

/** Heights (metres) to delta-coded centimetres: the first column down, then along each row. */
export function packHeights(h: Float32Array): Int16Array {
  const cm = (v: number) => Math.round(clamp(v, MAP_MIN_HEIGHT, MAP_MAX_HEIGHT) * 100);
  const out = new Int16Array(HEIGHT_RES * HEIGHT_RES);
  let above = 0;
  for (let j = 0; j < HEIGHT_RES; j++) {
    const first = cm(h[j * HEIGHT_RES]!);
    out[j * HEIGHT_RES] = first - above;
    above = first;
    let prev = first;
    for (let i = 1; i < HEIGHT_RES; i++) {
      const v = cm(h[j * HEIGHT_RES + i]!);
      out[j * HEIGHT_RES + i] = v - prev;
      prev = v;
    }
  }
  return out;
}

export function unpackHeights(p: Int16Array): Float32Array {
  const out = new Float32Array(HEIGHT_RES * HEIGHT_RES);
  let above = 0;
  for (let j = 0; j < HEIGHT_RES; j++) {
    above += p[j * HEIGHT_RES]!;
    let v = above;
    out[j * HEIGHT_RES] = v / 100;
    for (let i = 1; i < HEIGHT_RES; i++) {
      v += p[j * HEIGHT_RES + i]!;
      out[j * HEIGHT_RES + i] = v / 100;
    }
  }
  return out;
}

/** The generator settings behind a map: its seed and preset, with the highway where the map says. */
export function mapParams(map: MapData, heights = unpackHeights(map.heights)): TerrainParams {
  const params = { ...TerrainGen.create(map.seed, map.preset, TERRAIN_VERSION).params };
  params.highway = {
    ...params.highway,
    connectZ: map.highwayZ,
    height: Math.max(SHORE_HEIGHT + 0.5, sampleHeights(heights, 20, map.highwayZ)),
  };
  params.custom = true;
  return params;
}

/**
 * Where a railway could come in on the west edge: the flattest dry stretch 260–700 m from the
 * highway (as for generated maps, M20), or null if there's none.
 */
export function autoRailZ(heights: Float32Array, highwayZ: number): number | null {
  let best: { z: number; score: number } | null = null;
  for (let d = 260; d <= 700; d += 20)
    for (const z of [highwayZ + d, highwayZ - d]) {
      if (z < 120 || z > MAP_SIZE - 120) continue;
      const why = railSite(heights, z);
      if (why.bad) continue;
      const score = why.spread + d / 400;
      if (!best || score < best.score) best = { z, score };
    }
  return best?.z ?? null;
}

function railSite(heights: Float32Array, z: number): { bad: boolean; spread: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = 4; x <= 160; x += 8) {
    const h = sampleHeights(heights, x, z);
    if (h < SHORE_HEIGHT + 0.5) return { bad: true, spread: Infinity };
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return { bad: hi - lo > 8, spread: hi - lo };
}

/** A map to start from: the generator's own (seed and preset), or flat meadow with no forests. */
export function mapFromGenerator(seed: string, preset: MapPreset, name: string, flat = false): MapData {
  const gen = TerrainGen.create(seed, preset, TERRAIN_VERSION);
  const data = generateTerrain(gen);
  const heights = flat ? new Float32Array(HEIGHT_RES * HEIGHT_RES).fill(6) : data.heights;
  const n = GRID_RES * GRID_RES;
  const highwayZ = gen.params.highway.connectZ;
  return {
    format: MAP_FORMAT,
    name,
    seed,
    preset,
    climate: PRESET_CLIMATE[preset],
    heights: packHeights(heights),
    trees: flat ? new Uint8Array(n) : data.trees,
    ore: flat ? new Uint8Array(n) : data.ore,
    oil: flat ? new Uint8Array(n) : data.oil,
    highwayZ,
    railZ: autoRailZ(heights, highwayZ),
  };
}

/**
 * Groundwater for a map's ground: higher in lowlands and near water (the generator's noise for the
 * rest), none under water, as generated maps have it.
 */
export function mapGroundwater(heights: Float32Array, gen: TerrainGen): Uint8Array {
  const n = GRID_RES * GRID_RES;
  const h = new Float32Array(n);
  // Distance to the nearest water cell (chamfer, two passes), metres.
  const dist = new Float32Array(n).fill(1e9);
  for (let j = 0; j < GRID_RES; j++)
    for (let i = 0; i < GRID_RES; i++) {
      const k = j * GRID_RES + i;
      h[k] = sampleHeights(heights, (i + 0.5) * GRID_CELL, (j + 0.5) * GRID_CELL);
      if (h[k]! < SHORE_HEIGHT) dist[k] = 0;
    }
  const D = GRID_CELL;
  const D2 = GRID_CELL * Math.SQRT2;
  for (let j = 0; j < GRID_RES; j++)
    for (let i = 0; i < GRID_RES; i++) {
      const k = j * GRID_RES + i;
      let d = dist[k]!;
      if (i > 0) d = Math.min(d, dist[k - 1]! + D);
      if (j > 0) d = Math.min(d, dist[k - GRID_RES]! + D);
      if (i > 0 && j > 0) d = Math.min(d, dist[k - GRID_RES - 1]! + D2);
      if (i < GRID_RES - 1 && j > 0) d = Math.min(d, dist[k - GRID_RES + 1]! + D2);
      dist[k] = d;
    }
  for (let j = GRID_RES - 1; j >= 0; j--)
    for (let i = GRID_RES - 1; i >= 0; i--) {
      const k = j * GRID_RES + i;
      let d = dist[k]!;
      if (i < GRID_RES - 1) d = Math.min(d, dist[k + 1]! + D);
      if (j < GRID_RES - 1) d = Math.min(d, dist[k + GRID_RES]! + D);
      if (i < GRID_RES - 1 && j < GRID_RES - 1) d = Math.min(d, dist[k + GRID_RES + 1]! + D2);
      if (i > 0 && j < GRID_RES - 1) d = Math.min(d, dist[k + GRID_RES - 1]! + D2);
      dist[k] = d;
    }
  const out = new Uint8Array(n);
  for (let j = 0; j < GRID_RES; j++)
    for (let i = 0; i < GRID_RES; i++) {
      const k = j * GRID_RES + i;
      if (h[k]! < 0.5) continue;
      const x = (i + 0.5) * GRID_CELL;
      const z = (j + 0.5) * GRID_CELL;
      const gw =
        0.45 +
        0.35 * gen.resourceNoise('water', x, z) +
        0.35 * (1 - smoothstep(0, 450, dist[k]!)) -
        Math.max(0, h[k]! - 18) / 70;
      out[k] = Math.round(clamp(gw, 0, 1) * 255);
    }
  return out;
}

// ------------------------------------------------------------------ playability

export interface MapIssue {
  text: string;
  at?: { x: number; z: number };
}

export interface MapCheck {
  /** Playable: nothing in `problems`. Warnings don't stop the map being played. */
  ok: boolean;
  problems: MapIssue[];
  warnings: MapIssue[];
  /** Buildable ground within reach of the highway, hectares, and its share of the land there. */
  startArea: number;
  startShare: number;
  /** Shares of the map under water and forest, and cells with ore and oil. */
  water: number;
  forest: number;
  ore: number;
  oil: number;
}

/**
 * How much buildable land the start area needs: hectares within `START_REACH` metres of where the
 * highway comes in (the half-disc there is 56 ha; a first town of a few streets takes about 15).
 */
export const START_NEED = 20;
export const START_REACH = 600;

/**
 * Is the map playable? The highway must come in on dry land gentle enough for a first road, with
 * enough buildable ground (dry, gentle enough for lots) within reach of it for a first town.
 */
export function checkMap(map: MapData, heights = unpackHeights(map.heights)): MapCheck {
  const problems: MapIssue[] = [];
  const warnings: MapIssue[] = [];
  const hz = map.highwayZ;
  const at = { x: 40, z: hz };
  if (!(hz >= ENTRY_MARGIN && hz <= MAP_SIZE - ENTRY_MARGIN))
    problems.push({ text: 'The highway must come in at least 200 m from the corners.', at });
  // The first 120 m of road in from the highway: dry, and no steeper than a street can be graded.
  let prev: number | null = null;
  let worst = 0;
  let wet = false;
  for (let x = 0; x <= 120; x += 8) {
    const h = sampleHeights(heights, x, hz);
    if (h < SHORE_HEIGHT + 0.3) wet = true;
    if (prev !== null) worst = Math.max(worst, Math.abs(h - prev) / 8);
    prev = h;
  }
  if (wet) problems.push({ text: 'The highway comes in under water: move it, or raise the land there.', at });
  else if (worst > 0.12)
    problems.push({
      text: `The ground where the highway comes in is too steep (${Math.round(worst * 100)} %): level it.`,
      at,
    });
  // Buildable cells (16 m) within reach of the entry.
  let land = 0;
  let good = 0;
  let water = 0;
  let forest = 0;
  let ore = 0;
  let oil = 0;
  const cellArea = (GRID_CELL * GRID_CELL) / 10_000;
  for (let j = 0; j < GRID_RES; j++)
    for (let i = 0; i < GRID_RES; i++) {
      const k = j * GRID_RES + i;
      const x = (i + 0.5) * GRID_CELL;
      const z = (j + 0.5) * GRID_CELL;
      const corners = [
        sampleHeights(heights, x - 8, z - 8),
        sampleHeights(heights, x + 8, z - 8),
        sampleHeights(heights, x - 8, z + 8),
        sampleHeights(heights, x + 8, z + 8),
      ];
      const lo = Math.min(...corners);
      const hi = Math.max(...corners);
      const dry = lo >= SHORE_HEIGHT;
      if (!dry) water++;
      if (map.trees[k]! > 40) forest++;
      if (map.ore[k]! > 60) ore++;
      if (map.oil[k]! > 60) oil++;
      if (Math.hypot(x, z - hz) > START_REACH) continue;
      land++;
      if (dry && (hi - lo) / (GRID_CELL * Math.SQRT2) <= MAX_CELL_SLOPE) good++;
    }
  const startArea = Math.round(good * cellArea * 10) / 10;
  const startShare = land ? good / land : 0;
  if (startArea < START_NEED)
    problems.push({
      text: `Only ${startArea} ha of buildable land near the highway (a first town needs ${START_NEED} ha): flatten or drain some.`,
      at: { x: 250, z: hz },
    });
  if (map.railZ !== null) {
    const site = railSite(heights, map.railZ);
    if (Math.abs(map.railZ - hz) < ENTRY_SPACING || map.railZ < 120 || map.railZ > MAP_SIZE - 120)
      warnings.push({
        text: 'The railway comes in too close to the highway or a corner, so the map will have none.',
        at: { x: 40, z: map.railZ },
      });
    else if (site.bad)
      warnings.push({
        text: 'The railway comes in over water or rough ground (it needs 160 m of gentle land), so the map will have none.',
        at: { x: 40, z: map.railZ },
      });
  } else
    warnings.push({ text: 'No railway comes in: this map will have no regional trains or rail freight.' });
  const n = GRID_RES * GRID_RES;
  if (water === 0)
    warnings.push({
      text: 'No water on the map: no river pumps, outflows, harbours or waterfront land values.',
    });
  if (ore + oil === 0)
    warnings.push({ text: 'No ore or oil: the mining and oil specialisations will be out of reach.' });
  return {
    ok: problems.length === 0,
    problems,
    warnings,
    startArea,
    startShare: Math.round(startShare * 100) / 100,
    water: Math.round((water / n) * 1000) / 1000,
    forest: Math.round((forest / n) * 1000) / 1000,
    ore,
    oil,
  };
}

// ------------------------------------------------------------------ files

/** Check a map read from a file or a save: every field present and the right size. */
export function validMap(m: unknown): m is MapData {
  const o = m as Partial<MapData> | null;
  if (!o || typeof o !== 'object') return false;
  const n = GRID_RES * GRID_RES;
  return (
    o.format === MAP_FORMAT &&
    typeof o.name === 'string' &&
    typeof o.seed === 'string' &&
    MAP_PRESETS.some((p) => p.id === o.preset) &&
    typeof o.climate === 'string' &&
    o.climate in CLIMATES &&
    o.heights instanceof Int16Array &&
    o.heights.length === HEIGHT_RES * HEIGHT_RES &&
    [o.trees, o.ore, o.oil].every((a) => a instanceof Uint8Array && a.length === n) &&
    typeof o.highwayZ === 'number' &&
    Number.isFinite(o.highwayZ) &&
    (o.railZ === null || (typeof o.railZ === 'number' && Number.isFinite(o.railZ)))
  );
}
