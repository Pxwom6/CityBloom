import { DISTRICT } from '../../data/balance';
import { POLICY, type PolicyId } from '../../data/policies';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { fail, ok, type CommandResult } from '../commands';
import type { Vec2 } from '../geom';
import type { Sim } from '../sim';
import { BState } from '../world/buildings';
import { ZONE_R } from '../../data/zones';

/**
 * Districts (M21): named areas the player paints over the city, one 16 m raster cell at a time.
 * Each district can carry its own policies (DESIGN §3.22). `SimState.districts` holds them by id
 * (1–255, the lowest free one when created), and `SimState.districtCells` the district each raster
 * cell belongs to (0: none).
 */
export interface District {
  id: number;
  name: string;
  /** Palette slot for its colour. */
  color: number;
  /** Policies in force here only (sorted). */
  policies: string[];
}

export function emptyDistrictCells(): Uint8Array {
  return new Uint8Array(GRID_RES * GRID_RES);
}

/** The district at a point (0 if none or off the map). */
export function districtAt(cells: Uint8Array, x: number, z: number): number {
  const i = Math.floor(x / GRID_CELL);
  const j = Math.floor(z / GRID_CELL);
  if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) return 0;
  return cells[j * GRID_RES + i]!;
}

/** Raster cells whose centres lie within `radius` of the path through `points`. */
export function cellsNearPath(points: Vec2[], radius: number): number[] {
  const out = new Set<number>();
  const pts = points.length === 1 ? [points[0]!, points[0]!] : points;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius) / GRID_CELL));
    const i1 = Math.min(GRID_RES - 1, Math.floor((Math.max(a.x, b.x) + radius) / GRID_CELL));
    const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - radius) / GRID_CELL));
    const j1 = Math.min(GRID_RES - 1, Math.floor((Math.max(a.z, b.z) + radius) / GRID_CELL));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * GRID_CELL;
        const cz = (j + 0.5) * GRID_CELL;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cz - a.z) * dz) / len2)) : 0;
        if (Math.hypot(cx - (a.x + t * dx), cz - (a.z + t * dz)) <= radius) out.add(j * GRID_RES + i);
      }
  }
  return [...out].sort((x, y) => x - y);
}

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, DISTRICT.nameLength);

export function createDistrict(sim: Sim, name: string, dryRun: boolean): CommandResult {
  const s = sim.state;
  const n = cleanName(name);
  if (!n) return fail('A district needs a name');
  if (s.districts.size >= DISTRICT.limit) return fail(`A city can have ${DISTRICT.limit} districts`);
  let id = 1;
  while (s.districts.has(id)) id++;
  if (dryRun) return ok(0, { info: { id } });
  // Colours go round the palette in the order districts were made (the lowest slot not in use).
  const used = new Set([...s.districts.values()].map((d) => d.color));
  let color = 0;
  while (used.has(color) && color < DISTRICT.colors - 1) color++;
  s.districts.set(id, { id, name: n, color, policies: [] });
  sim.districtsChanged();
  return ok(0, { created: [id] });
}

/** Paint `district` (0 erases) over the cells a brush stroke covers. */
export function paintDistrict(
  sim: Sim,
  district: number,
  area: { kind: 'brush'; points: Vec2[]; radius: number },
  dryRun: boolean,
): CommandResult {
  const s = sim.state;
  if (district !== 0 && !s.districts.has(district)) return fail('No such district');
  if (area?.kind !== 'brush' || !area.points?.length || !(area.radius > 0) || area.radius > 200)
    return fail('Invalid brush');
  const cells = cellsNearPath(area.points, area.radius).filter((k) => s.districtCells[k] !== district);
  if (!cells.length) return fail(district ? 'Already part of this district' : 'No district here');
  if (dryRun) return ok(0, { info: { cells: cells.length } });
  for (const k of cells) s.districtCells[k] = district;
  sim.districtsChanged();
  return ok(0, { info: { cells: cells.length } });
}

export function renameDistrict(sim: Sim, district: number, name: string, dryRun: boolean): CommandResult {
  const d = sim.state.districts.get(district);
  if (!d) return fail('No such district');
  const n = cleanName(name);
  if (!n) return fail('A district needs a name');
  if (n === d.name) return fail('That is its name already');
  if (dryRun) return ok(0);
  d.name = n;
  sim.districtsChanged();
  return ok(0);
}

/** Dissolve a district: its cells go back to no district and its policies lapse. */
export function removeDistrict(sim: Sim, district: number, dryRun: boolean): CommandResult {
  const s = sim.state;
  if (!s.districts.has(district)) return fail('No such district');
  if (dryRun) return ok(0);
  const cells = s.districtCells;
  for (let k = 0; k < cells.length; k++) if (cells[k] === district) cells[k] = 0;
  s.districts.delete(district);
  sim.districtsChanged();
  return ok(0);
}

/** Put a policy in force in one district, or lift it there. */
export function setDistrictPolicy(
  sim: Sim,
  district: number,
  policy: PolicyId,
  on: boolean,
  dryRun: boolean,
): CommandResult {
  const d = sim.state.districts.get(district);
  if (!d) return fail('No such district');
  const def = POLICY.get(policy);
  if (!def) return fail('No such policy');
  if (def.scope === 'city') return fail(`${def.name} applies to the whole city`);
  if (on && !sim.isUnlocked(def.unlockPopulation))
    return fail(`Unlocks at ${def.unlockPopulation.toLocaleString('en-US')} residents`);
  if (on && sim.policy(policy)) return fail(`${def.name} is already in force across the city`);
  if (on === d.policies.includes(policy)) return fail(on ? 'Already in force here' : 'Not in force here');
  if (dryRun) return ok(0);
  const set = new Set(d.policies);
  if (on) set.add(policy);
  else set.delete(policy);
  d.policies = [...set].sort();
  sim.districtsChanged();
  if (policy === 'freeTransit') sim.transitChanged();
  return ok(0);
}

export interface DistrictFigures {
  population: number;
  jobs: number;
  workers: number;
  /** Mean happiness of its residents (0..1), and land value over its cells (0..1). */
  happiness: number;
  landValue: number;
  /** Buildings, and raster cells painted. */
  buildings: number;
  cells: number;
}

/** Population, jobs, happiness and land value per district (index 0: outside any district). */
export function districtFigures(sim: Sim): Map<number, DistrictFigures> {
  const s = sim.state;
  const out = new Map<number, DistrictFigures & { hsum: number; lvsum: number }>();
  const get = (id: number) => {
    let f = out.get(id);
    if (!f)
      out.set(
        id,
        (f = {
          population: 0,
          jobs: 0,
          workers: 0,
          happiness: 0,
          landValue: 0,
          buildings: 0,
          cells: 0,
          hsum: 0,
          lvsum: 0,
        }),
      );
    return f;
  };
  for (const id of [0, ...s.districts.keys()]) get(id);
  const cells = s.districtCells;
  for (let k = 0; k < cells.length; k++) {
    const f = get(cells[k]!);
    f.cells++;
    f.lvsum += s.landValue[k]!;
  }
  for (const b of s.buildings.values()) {
    if (b.state !== BState.Active) continue;
    const f = get(districtAt(cells, b.x, b.z));
    f.buildings++;
    if (b.zone === ZONE_R) {
      f.population += b.pop;
      f.workers += b.seekers;
      f.hsum += b.happiness * b.pop;
    } else f.jobs += b.pop;
  }
  const res = new Map<number, DistrictFigures>();
  for (const [id, f] of [...out].sort((a, b) => a[0] - b[0]))
    res.set(id, {
      population: f.population,
      jobs: f.jobs,
      workers: f.workers,
      happiness: f.population > 0 ? f.hsum / f.population : 0,
      landValue: f.cells > 0 ? f.lvsum / f.cells : 0,
      buildings: f.buildings,
      cells: f.cells,
    });
  return res;
}
