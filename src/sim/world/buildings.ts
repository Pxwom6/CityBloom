import { ZONED_DEFS, type Density, type Level, type Wealth, type ZonedDef } from '../../data/buildings';
import { CELL, ROWS, type ZoneCode } from '../../data/zones';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { pointInRect, type ORect, type Vec2 } from '../geom';
import { seatHeight } from './earthworks';
import type { Sim } from '../sim';

export const BState = { Construction: 0, Active: 1, Abandoned: 2, Rubble: 3 } as const;
export type BState = (typeof BState)[keyof typeof BState];

/** A zoned building on a lot of cells. DESIGN.md §2.2. */
export interface Building {
  id: number;
  def: string;
  zone: ZoneCode;
  density: Density;
  wealth: Wealth;
  level: Level;
  /** Lot: block, first column, width in columns, depth in rows. */
  block: number;
  col: number;
  w: number;
  d: number;
  /** Footprint centre, base height, and the road tangent angle. */
  x: number;
  z: number;
  y: number;
  angle: number;
  side: 1 | -1;
  state: BState;
  progress: number;
  /** Residents (R) or workers (C/I) present. */
  pop: number;
  /** Capacity currently in effect (the old one while an upgrade is being built). */
  cap: number;
  /** R: residents with jobs. */
  employed: number;
  /** R: job seekers counted at the last matching round (new arrivals aren't unemployed yet). */
  seekers: number;
  /** R: average commute in seconds of travel. */
  commute: number;
  /** R: share of shopping met; C: share of customer capacity used. */
  shop: number;
  happiness: number;
  distress: number;
  /** Utility supply (0..1) from the last allocation, and polluted share of the water. */
  power: number;
  water: number;
  sewage: number;
  polluted: number;
  /** Uncollected garbage (units). */
  garbage: number;
  /** Consecutive hours without power / water; businesses close after a while. */
  noPowerH: number;
  noWaterH: number;
  closed: boolean;
  /** Service coverage 0..1 from the last update (education = share of students seated). */
  covFire: number;
  covPolice: number;
  covHealth: number;
  covEdu: number;
  covPark: number;
  /** R: residents who are sick now, and the share of them in a hospital or clinic bed. */
  sick: number;
  treated: number;
  /** R: average education of the residents, 0..3 (none, primary, high school, university). */
  edu: number;
  /** R: share of pupils seated at primary, high school and university level. */
  seat1: number;
  seat2: number;
  seat3: number;
  /** Fire intensity 0..1, ticks burnt at full intensity, hours spent as rubble. */
  fire: number;
  burn: number;
  rubbleH: number;
  /** Hours under flood water (0 when dry). */
  flooded: number;
  /** Consecutive good hourly checks (upgrade) or hours of recovery (abandoned). */
  good: number;
  variant: number;
  born: number;
}

export function defOf(b: Building): ZonedDef {
  return ZONED_DEFS.get(b.def)!;
}

/** Capacity of a building's archetype scaled to its actual lot (upgrades can happen in place). */
export function buildingCapacity(b: Building): number {
  const def = defOf(b);
  return Math.max(2, Math.round((def.capacity * (b.w * b.d)) / (def.w * def.d)));
}

/** Oriented rectangle of a building's footprint (x along the road, z across it). */
export function footprint(b: Building, shrink = 0): ORect {
  return { x: b.x, z: b.z, hw: (b.w * CELL) / 2 - shrink, hd: (b.d * CELL) / 2 - shrink, angle: b.angle };
}

/** Recompute position/orientation from the lot's cells (after placement or a block move). */
export function placeOnLot(sim: Sim, b: Building): void {
  const net = sim.net;
  const block = sim.state.net.blocks.get(b.block)!;
  let x = 0;
  let z = 0;
  for (let c = b.col; c < b.col + b.w; c++) {
    for (let r = 0; r < b.d; r++) {
      const p = net.cellCenter(block.id, c * ROWS + r);
      x += p.x;
      z += p.z;
    }
  }
  const n = b.w * b.d;
  b.x = x / n;
  b.z = z / n;
  // Average tangent angle of the lot's front cells.
  let sx = 0;
  let sz = 0;
  for (let c = b.col; c < b.col + b.w; c++) {
    const a = net.cellAngle(block.id, c * ROWS);
    sx += Math.cos(a);
    sz += Math.sin(a);
  }
  b.angle = Math.atan2(sz, sx);
  b.side = block.side;
  b.y = seatHeight((x, z) => sim.terrain.heightAt(x, z), footprint(b), false);
}

/** The point on the road where the building's lot meets it: segment and arc length. */
export function accessOf(sim: Sim, b: Building): { seg: number; s: number } | null {
  const block = sim.state.net.blocks.get(b.block);
  if (!block) return null;
  return { seg: block.seg, s: block.s0 + (b.col + b.w / 2) * CELL };
}

export function setLotCells(sim: Sim, b: Building, id: number): void {
  const block = sim.state.net.blocks.get(b.block);
  if (!block) return;
  for (let c = b.col; c < b.col + b.w; c++) for (let r = 0; r < b.d; r++) block.bld[c * ROWS + r] = id;
  sim.net.dirty.blocks.add(block.id);
}

/** Reduce the tree-density grid under a footprint. */
export function clearTreesUnder(sim: Sim, rect: ORect): void {
  const trees = sim.state.trees;
  const rad = Math.hypot(rect.hw, rect.hd) + GRID_CELL;
  const i0 = Math.max(0, Math.floor((rect.x - rad) / GRID_CELL));
  const i1 = Math.min(GRID_RES - 1, Math.floor((rect.x + rad) / GRID_CELL));
  const j0 = Math.max(0, Math.floor((rect.z - rad) / GRID_CELL));
  const j1 = Math.min(GRID_RES - 1, Math.floor((rect.z + rad) / GRID_CELL));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * GRID_RES + i;
      if (!trees[k]) continue;
      let hit = 0;
      for (let u = 0; u < 4; u++) {
        for (let v = 0; v < 4; v++) {
          const p: Vec2 = { x: (i + (u + 0.5) / 4) * GRID_CELL, z: (j + (v + 0.5) / 4) * GRID_CELL };
          if (pointInRect(p, rect)) hit++;
        }
      }
      if (!hit) continue;
      const next = Math.round(trees[k]! * (1 - hit / 16));
      if (next !== trees[k]) {
        trees[k] = next;
        sim.markTreesDirty(k);
      }
    }
  }
}
