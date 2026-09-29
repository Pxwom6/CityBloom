import { CLIMATES, type ClimateId } from '../../data/climate';
import { MAP_BRUSHES, MAP_EDIT, type MapBrush } from '../../data/mapEditor';
import { GRID_CELL, GRID_RES, HEIGHT_RES, HEIGHT_STEP, MAP_SIZE, SHORE_HEIGHT } from '../../data/world';
import { fail, ok, type CommandResult } from '../commands';
import type { Vec2 } from '../geom';
import type { Sim } from '../sim';
import {
  ENTRY_MARGIN,
  ENTRY_SPACING,
  MAP_MAX_HEIGHT,
  MAP_MIN_HEIGHT,
  checkMap,
  packHeights,
  type MapCheck,
  type MapData,
} from '../terrain/customMap';
import { applyHeights } from '../world/earthworks';

/**
 * The map editor's brushes (M24): sculpt the ground, paint water, plant forests and lay ore and
 * oil, on the editor's city (`GameOptions.editor`). Heights go into the terrain delta (so undo
 * works as for earthworks) and are folded into the map when it's exported. DESIGN.md §3.25.
 */

/** Distance from a point to a polyline (a single point is a dab). */
function distToPath(x: number, z: number, pts: readonly Vec2[]): number {
  if (pts.length === 1) return Math.hypot(x - pts[0]!.x, z - pts[0]!.z);
  let best = Infinity;
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

const falloff = (d: number, r: number) => {
  const q = d / r;
  return q >= 1 ? 0 : (1 - q * q) ** 2;
};

const clampH = (h: number) => Math.max(MAP_MIN_HEIGHT, Math.min(MAP_MAX_HEIGHT, h));

function editorOnly(sim: Sim): CommandResult | null {
  return sim.state.options.editor && sim.state.map ? null : fail('Only in the map editor');
}

export function editMap(
  sim: Sim,
  brush: MapBrush,
  points: Vec2[],
  radius: number,
  strength: number,
  level: number | undefined,
  dryRun: boolean,
): CommandResult {
  const no = editorOnly(sim);
  if (no) return no;
  if (!MAP_BRUSHES.some((b) => b.id === brush)) return fail('Unknown brush');
  if (!(radius >= MAP_EDIT.radius.min && radius <= MAP_EDIT.radius.max)) return fail('Invalid brush');
  if (!(strength >= MAP_EDIT.strength.min && strength <= MAP_EDIT.strength.max))
    return fail('Invalid strength');
  if (
    !points.length ||
    points.length > 64 ||
    points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))
  )
    return fail('Invalid brush');
  if (brush === 'level' && !Number.isFinite(level)) return fail('Pick the height to level to');
  if (dryRun) return ok(0);
  const map = sim.state.map!;
  let changed = 0;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x - radius);
    z0 = Math.min(z0, p.z - radius);
    x1 = Math.max(x1, p.x + radius);
    z1 = Math.max(z1, p.z + radius);
  }
  const heightBrush = ['raise', 'lower', 'level', 'smooth', 'water', 'sea', 'land'].includes(brush);
  if (heightBrush) {
    const H = sim.terrain.heights;
    const idx: number[] = [];
    const to: number[] = [];
    const i0 = Math.max(0, Math.ceil(x0 / HEIGHT_STEP));
    const i1 = Math.min(HEIGHT_RES - 1, Math.floor(x1 / HEIGHT_STEP));
    const j0 = Math.max(0, Math.ceil(z0 / HEIGHT_STEP));
    const j1 = Math.min(HEIGHT_RES - 1, Math.floor(z1 / HEIGHT_STEP));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const w = falloff(distToPath(i * HEIGHT_STEP, j * HEIGHT_STEP, points), radius);
        if (w <= 0) continue;
        const k = j * HEIGHT_RES + i;
        const cur = H[k]!;
        const pull = (target: number) => cur + (target - cur) * Math.min(1, w * 1.5 * strength);
        let t: number;
        switch (brush) {
          case 'raise':
            t = cur + MAP_EDIT.step * strength * w;
            break;
          case 'lower':
            t = cur - MAP_EDIT.step * strength * w;
            break;
          case 'level':
            t = pull(level!);
            break;
          case 'water':
            t = Math.min(cur, pull(MAP_EDIT.waterBed));
            break;
          case 'sea':
            t = Math.min(cur, pull(MAP_EDIT.seaBed));
            break;
          case 'land':
            t = Math.max(cur, pull(MAP_EDIT.landHeight));
            break;
          default: {
            let sum = 0;
            let n = 0;
            for (let v = -2; v <= 2; v++)
              for (let u = -2; u <= 2; u++) {
                const a = i + u;
                const b = j + v;
                if (a < 0 || b < 0 || a >= HEIGHT_RES || b >= HEIGHT_RES) continue;
                sum += H[b * HEIGHT_RES + a]!;
                n++;
              }
            t = cur + (sum / n - cur) * Math.min(1, w * 0.8 * strength);
          }
        }
        t = clampH(t);
        if (Math.abs(t - cur) < 0.01) continue;
        idx.push(k);
        to.push(t);
      }
    if (idx.length) {
      applyHeights(sim.terrain, sim.state.terrainDelta, idx, to, (i) => sim.markTerrainDirty(i));
      changed += idx.length;
    }
  }
  // Forests, ore and oil on the 16 m grid; ground under water keeps no trees.
  const c0 = Math.max(0, Math.floor(x0 / GRID_CELL));
  const c1 = Math.min(GRID_RES - 1, Math.floor(x1 / GRID_CELL));
  const r0 = Math.max(0, Math.floor(z0 / GRID_CELL));
  const r1 = Math.min(GRID_RES - 1, Math.floor(z1 / GRID_CELL));
  const trees = sim.state.trees;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const x = (c + 0.5) * GRID_CELL;
      const z = (r + 0.5) * GRID_CELL;
      const k = r * GRID_RES + c;
      const wet = sim.terrain.heightAt(x, z) < SHORE_HEIGHT + 0.4;
      if (heightBrush) {
        if (wet && trees[k]) {
          trees[k] = 0;
          sim.markTreesDirty(k);
          changed++;
        }
        continue;
      }
      const w = falloff(distToPath(x, z, points), radius);
      if (w <= 0) continue;
      const set = (arr: Uint8Array, v: number) => {
        const n = Math.max(0, Math.min(255, Math.round(v)));
        if (n === arr[k]) return false;
        arr[k] = n;
        changed++;
        return true;
      };
      if (brush === 'forest' && !wet) {
        if (set(trees, trees[k]! + MAP_EDIT.forestStep * strength * w)) sim.markTreesDirty(k);
      } else if (brush === 'clearForest') {
        if (set(trees, trees[k]! - 255 * 1.5 * strength * w)) sim.markTreesDirty(k);
      } else if (brush === 'ore' && !wet) set(map.ore, map.ore[k]! + MAP_EDIT.resourceStep * strength * w);
      else if (brush === 'oil' && !wet) set(map.oil, map.oil[k]! + MAP_EDIT.resourceStep * strength * w);
      else if (brush === 'clearResources') {
        set(map.ore, map.ore[k]! - 255 * 1.5 * strength * w);
        set(map.oil, map.oil[k]! - 255 * 1.5 * strength * w);
      }
    }
  return changed ? ok(0, { info: { changed } }) : fail('Nothing to change here');
}

/** Where the highway or railway comes in on the west edge (z), or no railway (null). */
export function setMapEntry(
  sim: Sim,
  entry: 'highway' | 'rail',
  z: number | null,
  dryRun: boolean,
): CommandResult {
  const no = editorOnly(sim);
  if (no) return no;
  const map = sim.state.map!;
  if (entry === 'highway' && z === null) return fail('The map needs its highway');
  if (z !== null) {
    if (!Number.isFinite(z)) return fail('Invalid position');
    z = Math.round(Math.max(ENTRY_MARGIN, Math.min(MAP_SIZE - ENTRY_MARGIN, z)));
    const other = entry === 'highway' ? map.railZ : map.highwayZ;
    if (other !== null && Math.abs(other - z) < ENTRY_SPACING)
      return fail(`The highway and railway need ${ENTRY_SPACING} m between them`);
  }
  if (dryRun) return ok(0);
  if (entry === 'highway') map.highwayZ = z!;
  else map.railZ = z;
  return ok(0, { info: { z } });
}

/** The map's name and climate. */
export function setMapInfo(
  sim: Sim,
  name: string | undefined,
  climate: ClimateId | undefined,
  dryRun: boolean,
): CommandResult {
  const no = editorOnly(sim);
  if (no) return no;
  const n = name?.trim().slice(0, 40);
  if (name !== undefined && !n) return fail('Name cannot be empty');
  if (climate !== undefined && !(climate in CLIMATES)) return fail('Unknown climate');
  if (dryRun) return ok(0);
  const map = sim.state.map!;
  if (n) map.name = n;
  if (climate) {
    map.climate = climate;
    sim.state.weather.climate = climate;
  }
  return ok(0);
}

/** The map as edited, ready to save or play, and whether it's playable. */
export function exportMap(sim: Sim): { map: MapData; check: MapCheck } | null {
  const m = sim.state.map;
  if (!m) return null;
  const map: MapData = {
    ...m,
    heights: packHeights(sim.terrain.heights),
    trees: sim.state.trees.slice(),
    ore: m.ore.slice(),
    oil: m.oil.slice(),
  };
  return { map, check: checkMap(map, sim.terrain.heights) };
}
