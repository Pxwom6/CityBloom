import { Color } from 'three';
import type { ZonedDef } from '../../data/buildings';
import { CELL, ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import {
  IN_FAR,
  IN_SKY,
  ModelBuilder,
  NEAR_ONLY,
  SEASONAL,
  SURF_GRASS,
  SURF_HEDGE,
  modelRng,
  pick,
  shade,
  type ModelData,
} from './builder';

const C = (hex: string) => new Color(hex);
const WALLS_R = [
  '#f3e3c3',
  '#efd5b0',
  '#e8c9a3',
  '#dfe8d0',
  '#cfe0e8',
  '#f2d0c4',
  '#e9e4da',
  '#f5ecd9',
  '#e6d3e8',
].map(C);
const WALLS_R_RICH = ['#ffffff', '#f7f3ea', '#eef1f4', '#f4ead8'].map(C);
const ROOFS = ['#b5553b', '#8d4a3a', '#5b6470', '#7a5b45', '#4f6b5a', '#a0673f', '#6b4e3d'].map(C);
const TRIM = C('#fbf8f1');
const DOOR = C('#6b4a33');
const GLASS = C('#3d5a73');
const GLASS_SHOP = C('#6f9fc4');
const GRASS = C('#8cc063');
const GRASS_RICH = C('#7fbb5c');
const PAVE = C('#cfcac0');
const CONCRETE = C('#b9b6ae');
const ASPHALT_LOT = C('#8a8d91');
const STONE = C('#bdb5a6');
const HEDGE = C('#4f8f45');
const POOL = C('#5ec3e8');
const WALLS_C = ['#e7e2da', '#d9dfe6', '#f0e4d0', '#cfd8d4', '#e9d8c8', '#dde3ea'].map(C);
const AWNINGS = ['#d9534f', '#2f86c9', '#3aa876', '#f0ad4e', '#8e5bb5', '#e2744a'].map(C);
const SIGNS = ['#ffcf3f', '#ff6f59', '#5ad1ff', '#9bf07a', '#ff8fd8'].map(C);
const OFFICE_GLASS = ['#6f9fc4', '#7fb0c9', '#5f88a8', '#86a8bd', '#7a9eb0'].map(C);
const WALLS_I = ['#c9c4ba', '#bdb8ae', '#d2c4a8', '#b3bcc0', '#c7baa3'].map(C);
const RUST = C('#a0583a');
const YELLOW = C('#e0b030');
const WHITE = C('#eef2f5');
const SOLAR = C('#2c3e66');
const METAL = C('#9aa0a6');

SEASONAL.set(GRASS, SURF_GRASS).set(GRASS_RICH, SURF_GRASS).set(HEDGE, SURF_HEDGE);

function lotBase(m: ModelBuilder, W: number, D: number, top: Color): void {
  // Foundation plinth: hides slopes under the lot; its top is the lot surface.
  m.box(-W / 2 + 0.2, W / 2 - 0.2, -5, 0.06, -D / 2 + 0.2, D / 2 - 0.2, STONE, top);
}

function litFn(r: () => number, p: number): (i: number) => number {
  return () => (r() < p ? 0.6 + r() * 0.4 : 0);
}

const LEAVES = ['#6aa84f', '#8dbb4f', '#5a9a45', '#79b04e', '#9aa84a'].map(C);
const TRUNK = C('#7a5a40');
const CAR_COLOURS = ['#c94c4c', '#3f6fb5', '#e8e4dc', '#3b3f45', '#d9a441', '#5e8f6a', '#9aa3ad'].map(C);
const CAR_GLASS = C('#2f3d4a');
const WOOD = C('#a0724f');
const BRICK = ['#a85a44', '#b86b4b', '#9c5540', '#c07a5a', '#8f4f3c'].map(C);
const FENCE = C('#f4f1ea');
const MODERN_WALLS = ['#f4f4f1', '#e6e7e4', '#d9dcdf', '#3f4448'].map(C);
const CONTAINERS = ['#c0392b', '#2e86c1', '#d4ac0d', '#1e8449', '#7d3c98', '#d35400'].map(C);
const TANK = C('#dcdad4');

/** A small garden tree: trunk, tapered crown and a rounded top (about 60 triangles). */
function yardTree(m: ModelBuilder, x: number, z: number, r: () => number): void {
  const h = 1.5 + r() * 1.2;
  const rad = 1.3 + r() * 1;
  const col = pick(r, LEAVES);
  m.detail(NEAR_ONLY, () => {
    m.cylinder(x, z, 0.2, 0, h, TRUNK, 5);
    m.frustum(x, z, rad * 0.55, rad, h - 0.3, h + rad * 0.45, col, 7, false);
    m.dome(x, z, rad, h + rad * 0.45, col, 2, 7);
  });
}

/** A parked car, nose along x (or z). */
function parkedCar(m: ModelBuilder, x: number, z: number, alongZ: boolean, col: Color): void {
  const [hx, hz] = alongZ ? [0.9, 2.1] : [2.1, 0.9];
  const [cx, cz] = alongZ ? [0.8, 1.1] : [1.1, 0.8];
  m.detail(NEAR_ONLY, () => {
    m.box(x - hx, x + hx, 0.3, 1.0, z - hz, z + hz, col);
    m.box(x - cx, x + cx, 1.0, 1.5, z - cz, z + cz, CAR_GLASS, col);
  });
}

/** Garden trees in the back yard (behind z1), if there's room. */
function backYard(m: ModelBuilder, W: number, D: number, z1: number, r: () => number, n: number): void {
  const za = z1 + 1.8;
  const zb = D / 2 - 1.8;
  if (zb < za) return;
  for (let k = 0; k < n; k++) yardTree(m, (r() - 0.5) * (W - 3.6), za + r() * (zb - za), r);
}

/** A low picket fence along the front, with a gap for the path at dx. */
function frontFence(m: ModelBuilder, W: number, D: number, dx: number): void {
  const z = -D / 2 + 0.45;
  m.detail(NEAR_ONLY, () => {
    if (dx - 0.8 > -W / 2 + 0.4) m.box(-W / 2 + 0.3, dx - 0.8, 0, 0.8, z - 0.06, z + 0.06, FENCE);
    if (dx + 0.8 < W / 2 - 0.4) m.box(dx + 0.8, W / 2 - 0.3, 0, 0.8, z - 0.06, z + 0.06, FENCE);
  });
}

function door(m: ModelBuilder, dx: number, z0: number, col = DOOR, w = 0.5, h = 2.1): void {
  m.detail(NEAR_ONLY, () =>
    m.quad(
      [dx - w, 0, z0 - 0.05],
      [dx - w, h, z0 - 0.05],
      [dx + w, h, z0 - 0.05],
      [dx + w, 0, z0 - 0.05],
      col,
    ),
  );
}

type HouseStyle = 'classic' | 'lshape' | 'modern' | 'cottage';

function houseStyle(def: ZonedDef, W: number, r: () => number): HouseStyle {
  const x = r();
  if (def.wealth === 2 && x < 0.45) return 'modern';
  if (def.wealth === 1 && x < 0.15) return 'modern';
  if (def.level === 1 && x > 0.68) return 'cottage';
  if (W >= 16 && x > 0.5) return 'lshape';
  return 'classic';
}

/** Detached homes in four styles, with gardens, fences, trees and cars. */
function house(m: ModelBuilder, def: ZonedDef, W: number, D: number, r: () => number): void {
  lotBase(m, W, D, def.wealth === 2 ? GRASS_RICH : GRASS);
  const style = houseStyle(def, W, r);
  const { dx, z1, drive } =
    style === 'modern'
      ? modernHouse(m, def, W, D, r)
      : style === 'lshape'
        ? lHouse(m, def, W, D, r)
        : style === 'cottage'
          ? cottage(m, def, W, D, r)
          : classicHouse(m, def, W, D, r);
  // Path to the street.
  m.detail(IN_FAR, () => m.ground(dx - 0.6, dx + 0.6, -D / 2 + 0.2, -D / 2 + 3.2, 0.08, PAVE));
  if (drive !== null && r() < 0.75) parkedCar(m, drive, -D / 2 + 3, true, pick(r, CAR_COLOURS));
  if (def.wealth === 0 && style !== 'modern' && r() < 0.5) frontFence(m, W, D, dx);
  if (def.wealth >= 1 && style !== 'modern') {
    // Hedges along the lot sides.
    m.detail(IN_FAR, () => {
      m.box(-W / 2 + 0.3, -W / 2 + 0.9, 0, 1.1, -D / 2 + 1.5, D / 2 - 0.3, HEDGE);
      m.box(W / 2 - 0.9, W / 2 - 0.3, 0, 1.1, -D / 2 + 1.5, D / 2 - 0.3, HEDGE);
    });
  }
  const pool = def.wealth === 2 && D / 2 - z1 > 6;
  if (pool) m.detail(IN_SKY, () => m.ground(-2.5, 2.5, z1 + 1.2, Math.min(D / 2 - 1, z1 + 5), 0.1, POOL));
  const trees = r() < 0.3 ? 0 : r() < 0.7 ? 1 : 2;
  if (!pool) backYard(m, W, D, z1, r, trees);
  else if (trees) yardTree(m, W / 2 - 2.2, D / 2 - 2.2, r);
}

interface HouseOut {
  /** Front door x, back wall z, and the driveway x (null if none). */
  dx: number;
  z1: number;
  drive: number | null;
}

function classicHouse(m: ModelBuilder, def: ZonedDef, W: number, D: number, r: () => number): HouseOut {
  const rich = def.wealth >= 1;
  const wall = rich && r() < 0.5 ? pick(r, WALLS_R_RICH) : pick(r, WALLS_R);
  const roof = pick(r, ROOFS);
  const floors = def.level >= 2 ? 2 : 1;
  const fh = 3;
  const bw = Math.min(W - 2.6, 5.5 + def.level * 1.6 + def.wealth * 0.8 + r() * 1.2);
  const bd = Math.min(D - 6, 6 + def.level * 1.2 + r() * 1.5);
  const x0 = -bw / 2 + (W > 10 ? (r() - 0.5) * 2 : 0);
  const x1 = x0 + bw;
  const z0 = -D / 2 + 3.2 + r() * 1.2;
  const z1 = z0 + bd;
  const top = floors * fh;
  m.box(x0, x1, 0, top, z0, z1, wall);
  const lit = litFn(r, 0.55);
  m.windows('front', x0, x1, z0, z1, 0, floors, fh, { col: GLASS, lit, spacing: 2.6 });
  m.windows('back', x0, x1, z0, z1, 0, floors, fh, { col: GLASS, lit, spacing: 3 });
  m.windows('left', x0, x1, z0, z1, 0, floors, fh, { col: GLASS, lit, spacing: 3.5 });
  m.windows('right', x0, x1, z0, z1, 0, floors, fh, { col: GLASS, lit, spacing: 3.5 });
  const dx = x0 + bw * (0.3 + r() * 0.4);
  door(m, dx, z0);
  if (def.level >= 2 || rich)
    m.detail(NEAR_ONLY, () => m.box(dx - 1.1, dx + 1.1, 2.4, 2.6, z0 - 1.3, z0, TRIM));
  m.detail(IN_FAR, () => m.ground(dx - 0.6, dx + 0.6, -D / 2 + 3.2, z0, 0.08, PAVE));
  // Roofs (M28): hipped, gabled, or now and then a mansard with dormers or a saltbox.
  const shape = r();
  if (shape < 0.12) {
    m.mansard(x0 - 0.2, x1 + 0.2, z0 - 0.2, z1 + 0.2, top, 2.2, 0.9, roof, shade(roof, 0.85));
    m.detail(IN_FAR, () => {
      const dx2 = (x0 + x1) / 2;
      m.box(dx2 - 0.7, dx2 + 0.7, top + 0.3, top + 1.9, z0 + 0.25, z0 + 0.9, wall);
    });
  } else if (shape < 0.22 && floors === 2) {
    // Saltbox: the ridge set back, a long slope down over the back.
    m.gable(x0, x1, z0, z0 + bd * 0.6, top, 1.9, roof, wall, true);
    m.quad(
      [x0 - 0.3, top + 1.9, z0 + bd * 0.6],
      [x0 - 0.3, top - 1.2, z1 + 0.3],
      [x1 + 0.3, top - 1.2, z1 + 0.3],
      [x1 + 0.3, top + 1.9, z0 + bd * 0.6],
      roof,
    );
    m.tri([x0, top, z0 + bd * 0.6], [x0, top - 1.2, z1], [x0, top + 1.9, z0 + bd * 0.6], -1, 0, 0, wall);
    m.tri([x1, top, z0 + bd * 0.6], [x1, top + 1.9, z0 + bd * 0.6], [x1, top - 1.2, z1], 1, 0, 0, wall);
  } else if (def.level === 3 || shape < 0.5) m.hip(x0, x1, z0, z1, top, 1.8 + r() * 0.6, roof);
  else m.gable(x0, x1, z0, z1, top, 1.8 + r() * 0.8, roof, wall, bw >= bd);
  if (r() < 0.5)
    m.detail(IN_FAR, () =>
      m.box(x1 - 1.4, x1 - 0.6, top, top + 2.8, z0 + bd * 0.6, z0 + bd * 0.6 + 0.8, C('#9c6b52')),
    );
  // Side garage for bigger homes, or a driveway.
  let drive: number | null = null;
  if (def.level >= 2 && W / 2 - x1 > 3.4) {
    const gx0 = x1 + 0.2;
    const gx1 = Math.min(W / 2 - 0.8, gx0 + 3.6);
    if (gx1 - gx0 > 2.5 && r() < 0.6) {
      m.box(gx0, gx1, 0, 2.8, z0 + 0.5, z0 + 6, wall);
      m.detail(IN_FAR, () =>
        m.quad(
          [gx0 + 0.3, 0, z0 + 0.45],
          [gx0 + 0.3, 2.3, z0 + 0.45],
          [gx1 - 0.3, 2.3, z0 + 0.45],
          [gx1 - 0.3, 0, z0 + 0.45],
          C('#e8e4dc'),
        ),
      );
      m.gable(gx0, gx1, z0 + 0.5, z0 + 6, 2.8, 1, roof, wall, false, 0.2);
    }
    const cx = (gx0 + Math.min(W / 2 - 0.8, gx0 + 3.6)) / 2;
    m.detail(IN_FAR, () => m.ground(cx - 1.4, cx + 1.4, -D / 2 + 0.2, z0 + 0.5, 0.08, PAVE));
    drive = cx;
  }
  return { dx, z1, drive };
}

/** An L-shaped home: a main range along the street and a wing running back. */
function lHouse(m: ModelBuilder, def: ZonedDef, W: number, D: number, r: () => number): HouseOut {
  const wall = pick(r, def.wealth ? WALLS_R_RICH : WALLS_R);
  const roof = pick(r, ROOFS);
  const floors = def.level >= 3 || r() < 0.4 ? 2 : 1;
  const fh = 3;
  const top = floors * fh;
  const bw = Math.min(W - 5.5, 9 + r() * 2);
  const x0 = -W / 2 + 1.2;
  const x1 = x0 + bw;
  const z0 = -D / 2 + 3.4 + r();
  const zm = z0 + 6;
  const left = r() < 0.5;
  const wx0 = left ? x0 : x1 - 4.6;
  const wx1 = wx0 + 4.6;
  const wz1 = Math.min(D / 2 - 2.5, zm + 4 + r() * 3);
  const lit = litFn(r, 0.55);
  m.box(x0, x1, 0, top, z0, zm, wall);
  m.box(wx0, wx1, 0, top, zm - 0.01, wz1, wall);
  m.windows('front', x0, x1, z0, zm, 0, floors, fh, { col: GLASS, lit, spacing: 2.6 });
  m.windows(left ? 'right' : 'left', wx0, wx1, zm, wz1, 0, floors, fh, { col: GLASS, lit, spacing: 3 });
  m.windows('back', wx0, wx1, zm, wz1, 0, floors, fh, { col: GLASS, lit, spacing: 3 });
  const h = 2 + r() * 0.6;
  m.gable(x0, x1, z0, zm, top, h, roof, wall, true);
  m.gable(wx0, wx1, zm, wz1, top, h * 0.8, roof, wall, false);
  const dx = left ? x1 - 2.4 : x0 + 2.4;
  door(m, dx, z0);
  m.detail(NEAR_ONLY, () => m.box(dx - 1.2, dx + 1.2, 2.4, 2.6, z0 - 1.4, z0, TRIM));
  m.detail(IN_FAR, () => m.ground(dx - 0.6, dx + 0.6, -D / 2 + 3.2, z0, 0.08, PAVE));
  // Driveway on the open side.
  const cx = left ? x1 + (W / 2 - x1) / 2 : 0;
  let drive: number | null = null;
  if (W / 2 - x1 > 3) {
    m.detail(IN_FAR, () => m.ground(cx - 1.4, cx + 1.4, -D / 2 + 0.2, z0 + 5, 0.08, PAVE));
    drive = cx;
  }
  return { dx, z1: wz1, drive };
}

/** A modern home: offset flat-roofed volumes, big glass and timber cladding. */
function modernHouse(m: ModelBuilder, def: ZonedDef, W: number, D: number, r: () => number): HouseOut {
  const wall = pick(r, MODERN_WALLS);
  const trim = wall.getHex() === 0x3f4448 ? C('#e6e7e4') : C('#5a6066');
  const fh = 3.1;
  const bw = Math.min(W - 3, 7 + def.level * 1.8 + r() * 1.5);
  const bd = Math.min(D - 7, 7 + def.level + r() * 1.5);
  const x0 = -W / 2 + 1.5;
  const x1 = x0 + bw;
  const z0 = -D / 2 + 4 + r();
  const z1 = z0 + bd;
  const glass = pick(r, OFFICE_GLASS);
  m.box(x0, x1, 0, fh, z0, z1, wall, trim);
  m.windows('front', x0, x1, z0, z1, 0, 1, fh, { col: glass, lit: litFn(r, 0.6), band: true, height: 2.2 });
  m.windows('back', x0, x1, z0, z1, 0, 1, fh, { col: glass, lit: litFn(r, 0.6), band: true, height: 2.2 });
  m.parapet(x0, x1, z0, z1, fh, trim, 0.25, 0.2);
  // Upper volume, shifted and cantilevered over the front.
  const ux0 = r() < 0.5 ? x0 : x0 + bw * 0.35;
  const ux1 = ux0 + bw * 0.65;
  const uz0 = z0 - 1.2;
  const uz1 = z1 - 1;
  m.box(ux0, ux1, fh, fh * 2, uz0, uz1, wall, trim);
  m.windows('front', ux0, ux1, uz0, uz1, fh, 1, fh, {
    col: glass,
    lit: litFn(r, 0.6),
    band: true,
    height: 1.6,
  });
  m.windows('left', ux0, ux1, uz0, uz1, fh, 1, fh, { col: glass, lit: litFn(r, 0.5), spacing: 3 });
  m.windows('right', ux0, ux1, uz0, uz1, fh, 1, fh, { col: glass, lit: litFn(r, 0.5), spacing: 3 });
  // Timber panel on part of the upper front.
  m.detail(IN_FAR, () =>
    m.quad(
      [ux0 + 0.1, fh + 0.1, uz0 - 0.06],
      [ux0 + 0.1, fh * 2 - 0.1, uz0 - 0.06],
      [ux0 + (ux1 - ux0) * 0.3, fh * 2 - 0.1, uz0 - 0.06],
      [ux0 + (ux1 - ux0) * 0.3, fh + 0.1, uz0 - 0.06],
      WOOD,
    ),
  );
  m.parapet(ux0, ux1, uz0, uz1, fh * 2, trim, 0.25, 0.2);
  const dx = ux0 > x0 ? x0 + 1.4 : x1 - 1.4;
  door(m, dx, z0, WOOD, 0.6, 2.3);
  m.detail(IN_FAR, () => m.ground(dx - 0.6, dx + 0.6, -D / 2 + 3.2, z0, 0.08, PAVE));
  let drive: number | null = null;
  if (W / 2 - x1 > 3.2) {
    const cx = (x1 + W / 2) / 2;
    m.detail(IN_FAR, () => m.ground(cx - 1.5, cx + 1.5, -D / 2 + 0.2, z0 + 4, 0.08, C('#b8b2a6')));
    drive = cx;
  }
  return { dx, z1, drive };
}

/** A one-storey cottage with a steep roof, a dormer and a chimney. */
function cottage(m: ModelBuilder, _def: ZonedDef, W: number, D: number, r: () => number): HouseOut {
  const wall = r() < 0.35 ? C('#d8cbb3') : pick(r, WALLS_R);
  const roof = pick(r, ROOFS);
  const bw = Math.min(W - 2.4, 5.4 + r() * 0.8);
  const bd = Math.min(D - 7, 6 + r());
  const x0 = -bw / 2;
  const x1 = bw / 2;
  const z0 = -D / 2 + 3.6 + r();
  const z1 = z0 + bd;
  const top = 2.7;
  const h = 2.8 + r() * 0.5;
  m.box(x0, x1, 0, top, z0, z1, wall);
  const lit = litFn(r, 0.55);
  m.windows('front', x0, x1, z0, z1, 0, 1, top, { col: GLASS, lit, spacing: 2.4 });
  m.windows('left', x0, x1, z0, z1, 0, 1, top, { col: GLASS, lit, spacing: 3 });
  m.windows('right', x0, x1, z0, z1, 0, 1, top, { col: GLASS, lit, spacing: 3 });
  m.gable(x0, x1, z0, z1, top, h, roof, wall, true, 0.45);
  // Dormer on the front slope.
  const zm = (z0 + z1) / 2;
  const zf = z0 + bd * 0.22;
  const dxm = (r() - 0.5) * (bw * 0.3);
  const dt = top + h * 0.72;
  m.detail(IN_FAR, () => {
    m.box(dxm - 0.8, dxm + 0.8, top + 0.3, dt, zf, zm, wall);
    m.quad(
      [dxm - 0.45, dt - 1.1, zf - 0.05],
      [dxm - 0.45, dt - 0.25, zf - 0.05],
      [dxm + 0.45, dt - 0.25, zf - 0.05],
      [dxm + 0.45, dt - 1.1, zf - 0.05],
      GLASS,
      lit(0),
    );
    m.gable(dxm - 0.8, dxm + 0.8, zf, zm, dt, 0.7, roof, wall, false, 0.12);
    m.box(x0 + 0.5, x0 + 1.2, top + h * 0.4, top + h + 0.9, zm + 0.4, zm + 1.1, C('#9c6b52'));
  });
  const dx = x0 + bw * (0.25 + r() * 0.2);
  door(m, dx, z0);
  m.detail(IN_FAR, () => m.ground(dx - 0.6, dx + 0.6, -D / 2 + 3.2, z0, 0.08, PAVE));
  return { dx, z1, drive: null };
}

function townhouses(m: ModelBuilder, _def: ZonedDef, W: number, D: number, r: () => number): void {
  lotBase(m, W, D, GRASS);
  const units = Math.max(2, Math.round(W / 5));
  const uw = (W - 1.2) / units;
  const floors = 3;
  const fh = 3;
  const z0 = -D / 2 + 2.5;
  const z1 = Math.min(D / 2 - 2, z0 + 10);
  const roofCol = pick(r, ROOFS);
  for (let u = 0; u < units; u++) {
    const x0 = -W / 2 + 0.6 + u * uw;
    const x1 = x0 + uw;
    const wall = pick(r, WALLS_R);
    const top = floors * fh + (r() < 0.3 ? fh : 0);
    m.box(x0, x1, 0, top, z0, z1, wall);
    const lit = litFn(r, 0.55);
    m.windows('front', x0, x1, z0, z1, 0, top / fh, fh, { col: GLASS, lit, spacing: 2.4 });
    m.windows('back', x0, x1, z0, z1, 0, top / fh, fh, { col: GLASS, lit, spacing: 2.4 });
    door(m, x0 + uw / 2, z0, DOOR, 0.5, 2.2);
    m.gable(x0, x1, z0, z1, top, 2.2, r() < 0.3 ? pick(r, ROOFS) : roofCol, wall, false, 0.2);
  }
  m.windows('left', -W / 2 + 0.6, W / 2 - 0.6, z0, z1, 0, floors, fh, {
    col: GLASS,
    lit: litFn(r, 0.5),
    spacing: 3,
  });
  m.windows('right', -W / 2 + 0.6, W / 2 - 0.6, z0, z1, 0, floors, fh, {
    col: GLASS,
    lit: litFn(r, 0.5),
    spacing: 3,
  });
  // Front gardens (M27): a path to each door between strips of lawn, low hedges between.
  const zf = -D / 2 + 0.3;
  for (let u = 0; u < units; u++) {
    const x0 = -W / 2 + 0.6 + u * uw;
    const xd = x0 + uw / 2;
    m.detail(IN_FAR, () => {
      m.ground(xd - 0.6, xd + 0.6, zf, z0, 0.08, PAVE);
      m.ground(x0 + 0.15, xd - 0.6, zf + 0.3, z0 - 0.1, 0.07, GRASS);
      m.ground(xd + 0.6, x0 + uw - 0.15, zf + 0.3, z0 - 0.1, 0.07, GRASS);
    });
    if (u > 0) m.detail(NEAR_ONLY, () => m.box(x0 - 0.15, x0 + 0.15, 0, 0.6, zf + 0.3, z0 - 0.1, HEDGE));
  }
}

function apartments(m: ModelBuilder, def: ZonedDef, W: number, D: number, r: () => number): void {
  lotBase(m, W, D, def.wealth ? GRASS_RICH : PAVE);
  const floors = def.floors + Math.floor(r() * 2);
  const fh = 3;
  const x0 = -W / 2 + 1.5;
  const x1 = W / 2 - 1.5;
  const z0 = -D / 2 + 2.5;
  const z1 = D / 2 - 2;
  const brick = def.wealth < 2 && r() < 0.45;
  const wall = brick ? pick(r, BRICK) : pick(r, def.wealth ? WALLS_R_RICH : WALLS_R);
  const accent = brick ? TRIM : pick(r, ROOFS);
  const top = floors * fh;
  // Roofs (M28): low brick walk-ups pitched, some others a mansard, the rest flat with plant.
  const pitched = brick && floors <= 4;
  const mansard = !pitched && floors <= 6 && r() < 0.35;
  m.box(x0, x1, 0, top, z0, z1, wall, C('#9a958c'));
  // A stone ground floor under brick, and a cornice under the roof of the older kinds.
  if (brick) m.box(x0 - 0.12, x1 + 0.12, 0, fh, z0 - 0.12, z1 + 0.12, STONE);
  if (brick || mansard) m.detail(IN_FAR, () => m.cornice(x0, x1, z0, z1, top, brick ? TRIM : accent));
  // A column of bay windows up one front corner (some).
  if (r() < 0.35 && x1 - x0 > 12) {
    const left = r() < 0.5;
    const bx0 = left ? x0 + 0.8 : x1 - 3.8;
    m.detail(IN_SKY, () => m.box(bx0, bx0 + 3, fh, top - 0.5, z0 - 0.9, z0, wall, accent));
  }
  const lit = litFn(r, 0.6);
  m.windows('front', x0, x1, z0, z1, 0, floors, fh, { col: GLASS, lit, spacing: 2.8 });
  m.windows('back', x0, x1, z0, z1, 0, floors, fh, { col: GLASS, lit, spacing: 2.8 });
  m.windows('left', x0, x1, z0, z1, 0, floors, fh, { col: GLASS, lit, spacing: 3 });
  m.windows('right', x0, x1, z0, z1, 0, floors, fh, { col: GLASS, lit, spacing: 3 });
  // Balcony slabs every other bay on the front.
  const bays = Math.floor((x1 - x0) / 5.6);
  for (let f = 1; f < floors; f++) {
    for (let b = 0; b < bays; b++) {
      if ((b + f) % 2) continue;
      const bx = x0 + (b + 0.5) * ((x1 - x0) / bays);
      m.detail(IN_SKY, () => m.box(bx - 1.3, bx + 1.3, f * fh - 0.15, f * fh + 0.15, z0 - 1.1, z0, accent));
    }
  }
  if (pitched) m.hip(x0, x1, z0, z1, top, 2.4, pick(r, ROOFS), 0.5);
  else if (mansard) {
    const roof = pick(r, ROOFS);
    m.mansard(x0, x1, z0, z1, top, 2.6, 1.1, roof, C('#8e8a83'));
    // Dormers in the front slope.
    const n = Math.max(1, Math.floor((x1 - x0) / 5));
    m.detail(IN_FAR, () => {
      for (let k = 0; k < n; k++) {
        const dx = x0 + (k + 0.5) * ((x1 - x0) / n);
        m.box(dx - 0.7, dx + 0.7, top + 0.3, top + 2.1, z0 + 0.35, z0 + 1.1, wall);
        m.quad(
          [dx - 0.45, top + 0.6, z0 + 0.3],
          [dx - 0.45, top + 1.8, z0 + 0.3],
          [dx + 0.45, top + 1.8, z0 + 0.3],
          [dx + 0.45, top + 0.6, z0 + 0.3],
          GLASS,
          lit(k + 999),
        );
      }
    });
  } else {
    m.parapet(x0, x1, z0, z1, top, wall);
    m.detail(IN_SKY, () => m.box(x0 + 1, x0 + 3.5, top, top + 2.2, z0 + 2, z0 + 4.5, C('#b0aba2')));
    // Roof garden for the better-off.
    if (def.wealth >= 1 && r() < 0.5) {
      m.detail(IN_SKY, () => m.ground(x0 + 5, x1 - 1.5, z0 + 1.5, z1 - 1.5, top + 0.1, GRASS_RICH));
      yardTree(m, x1 - 3, z1 - 3, r);
    }
  }
  // The front (M27): a path to the door, lawns either side of it on a paved lot.
  m.detail(IN_FAR, () => {
    m.ground(-1.1, 1.1, -D / 2 + 0.2, z0, 0.08, def.wealth ? PAVE : C('#bdb8ad'));
    if (!def.wealth) {
      m.ground(x0 - 1, -1.6, -D / 2 + 0.6, z0 - 0.4, 0.07, GRASS);
      m.ground(1.6, x1 + 1, -D / 2 + 0.6, z0 - 0.4, 0.07, GRASS);
    }
    // Entrance canopy.
    m.box(-1.8, 1.8, 2.6, 2.9, z0 - 1.6, z0, accent);
  });
  m.detail(NEAR_ONLY, () =>
    m.quad(
      [-0.8, 0, z0 - 0.05],
      [-0.8, 2.4, z0 - 0.05],
      [0.8, 2.4, z0 - 0.05],
      [0.8, 0, z0 - 0.05],
      GLASS_SHOP,
      0.5,
    ),
  );
}

type TowerForm = 'slab' | 'stepped' | 'twin' | 'offset' | 'crown';

/** A block of a tower: walls with windows all round, from y up `floors` floors; its top. */
function towerBlock(
  m: ModelBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  floors: number,
  fh: number,
  body: Color,
  glass: Color,
  residential: boolean,
  lit: (i: number) => number,
): number {
  const top = y + floors * fh;
  m.box(x0, x1, y, top, z0, z1, body, C('#8f949a'));
  for (const face of ['front', 'back', 'left', 'right'] as const)
    m.windows(face, x0, x1, z0, z1, y, floors, fh, {
      col: glass,
      lit,
      band: !residential,
      spacing: residential ? 3 : 4,
      height: residential ? fh * 0.5 : fh * 0.62,
    });
  return top;
}

/**
 * Towers (M28: refreshed to sit with the hand-made ones). A podium of shops or a lobby, and above
 * it one of five silhouettes: a slab with setbacks, a wedding cake of steps under a lit crown,
 * twin towers on one podium, a tall block beside a lower one, or a slab whose top floors step in
 * under a spire or a pyramid cap. Coloured corner piers, balcony bands or fins and the roof's
 * plant vary the rest; fine parts are kept only close up.
 */
function tower(
  m: ModelBuilder,
  def: ZonedDef,
  W: number,
  D: number,
  r: () => number,
  residential: boolean,
): void {
  lotBase(m, W, D, PAVE);
  const fh = residential ? 3 : 3.6;
  const floors = def.floors + Math.floor(r() * 5);
  const podiumFloors = residential ? (r() < 0.5 ? 1 : 2) : 2;
  const podiumH = fh * podiumFloors;
  const px0 = -W / 2 + 1;
  const px1 = W / 2 - 1;
  const pz0 = -D / 2 + 1.5;
  const pz1 = D / 2 - 1;
  const podium = residential ? pick(r, WALLS_R) : C('#d8d4cc');
  m.box(px0, px1, 0, podiumH, pz0, pz1, podium);
  m.windows('front', px0, px1, pz0, pz1, 0, 1, podiumH, {
    col: GLASS_SHOP,
    lit: () => 0.8,
    band: true,
    height: podiumH * 0.55,
  });
  m.parapet(px0, px1, pz0, pz1, podiumH, podium, 0.5, 0.3);
  // Homes in more colours than offices (M28): pastels and brick, the rich in white, modern greys
  // or glass with banded windows.
  const look = r();
  const luxury = residential && def.wealth === 2 && look < 0.3;
  const glass = residential && !luxury ? GLASS : pick(r, OFFICE_GLASS);
  const body = !residential
    ? pick(r, OFFICE_GLASS)
    : luxury
      ? pick(r, OFFICE_GLASS)
      : def.wealth === 0
        ? pick(r, look < 0.2 ? BRICK : WALLS_R)
        : def.wealth === 1
          ? pick(r, look < 0.15 ? BRICK : look < 0.55 ? WALLS_R_RICH : WALLS_R)
          : pick(r, look < 0.6 ? WALLS_R_RICH : MODERN_WALLS);
  const accent = residential
    ? pick(r, [...ROOFS, ...BRICK])
    : pick(r, [C('#e9ecef'), C('#c9ced3'), C('#3f4a55')]);
  const lit = litFn(r, residential ? 0.55 : 0.75);
  const x = r();
  const form: TowerForm =
    W >= 22 && x < 0.22
      ? 'twin'
      : x < 0.4
        ? 'stepped'
        : x < 0.58
          ? 'offset'
          : x < 0.78 && !residential
            ? 'crown'
            : 'slab';
  const tw = (px1 - px0) * (0.62 + r() * 0.12);
  const td = (pz1 - pz0) * (0.62 + r() * 0.12);
  const zc = (pz0 + pz1) / 2;
  const up = floors - podiumFloors;
  // The blocks drawn, for the details that follow them.
  const blocks: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }[] = [];
  const block = (x0: number, x1: number, z0: number, z1: number, y0: number, n: number) => {
    const y1 = towerBlock(m, x0, x1, z0, z1, y0, n, fh, body, glass, residential && !luxury, lit);
    blocks.push({ x0, x1, z0, z1, y0, y1 });
    return y1;
  };
  let top = podiumH;
  let roof = { x0: -tw / 2, x1: tw / 2, z0: zc - td / 2, z1: zc + td / 2 };
  if (form === 'twin') {
    // Two slimmer towers on the podium, one taller.
    const gap = 3;
    const w2 = (tw - gap) / 2 + (px1 - px0 - tw) * 0.25;
    const tall = r() < 0.5;
    const a = block(
      -gap / 2 - w2,
      -gap / 2,
      zc - td / 2,
      zc + td / 2,
      podiumH,
      tall ? up : Math.round(up * 0.75),
    );
    const b = block(
      gap / 2,
      gap / 2 + w2,
      zc - td / 2,
      zc + td / 2,
      podiumH,
      tall ? Math.round(up * 0.75) : up,
    );
    top = Math.max(a, b);
    roof = tall
      ? { x0: -gap / 2 - w2, x1: -gap / 2, z0: zc - td / 2, z1: zc + td / 2 }
      : { x0: gap / 2, x1: gap / 2 + w2, z0: zc - td / 2, z1: zc + td / 2 };
    m.parapet(-gap / 2 - w2, -gap / 2, zc - td / 2, zc + td / 2, a, body, 0.6, 0.3);
    m.parapet(gap / 2, gap / 2 + w2, zc - td / 2, zc + td / 2, b, body, 0.6, 0.3);
  } else if (form === 'offset') {
    // A tall block to one side of a lower, wider one.
    const left = r() < 0.5;
    const lw = (px1 - px0) * 0.88;
    const lx0 = -lw / 2;
    const lowTop = block(
      lx0,
      lx0 + lw,
      zc - td / 2,
      zc + td / 2,
      podiumH,
      Math.max(2, Math.round(up * 0.45)),
    );
    m.parapet(lx0, lx0 + lw, zc - td / 2, zc + td / 2, lowTop, body, 0.6, 0.3);
    const hw = lw * 0.5;
    const hx0 = left ? lx0 + 1 : lx0 + lw - 1 - hw;
    top = block(hx0, hx0 + hw, zc - td / 2 + 1, zc + td / 2 - 1, lowTop, up - Math.round(up * 0.45));
    roof = { x0: hx0, x1: hx0 + hw, z0: zc - td / 2 + 1, z1: zc + td / 2 - 1 };
  } else {
    // Slab, stepped or crowned: tiers narrowing upwards.
    const tiers = form === 'stepped' ? 3 : form === 'crown' ? 2 : floors > 14 ? 2 : 1;
    const shrink = form === 'stepped' ? 0.8 : 0.78;
    let w = tw;
    let d = td;
    const per = form === 'crown' ? [Math.max(1, up - 3), 3] : null;
    for (let t = 0; t < tiers; t++) {
      const n = per
        ? per[t]!
        : t === tiers - 1
          ? up - Math.ceil(up / tiers) * (tiers - 1)
          : Math.ceil(up / tiers);
      if (n <= 0) break;
      top = block(-w / 2, w / 2, zc - d / 2, zc + d / 2, top, n);
      roof = { x0: -w / 2, x1: w / 2, z0: zc - d / 2, z1: zc + d / 2 };
      if (t < tiers - 1) m.parapet(-w / 2, w / 2, zc - d / 2, zc + d / 2, top, accent, 0.5, 0.3);
      w *= form === 'crown' ? 0.86 : shrink;
      d *= form === 'crown' ? 0.86 : shrink;
    }
  }
  // Corner piers in the accent colour up the main block (some towers).
  const main = blocks[blocks.length - 1]!;
  if (r() < 0.45) {
    const t = 0.7;
    for (const [cx, cz] of [
      [main.x0, main.z0],
      [main.x1, main.z0],
      [main.x0, main.z1],
      [main.x1, main.z1],
    ] as const)
      m.box(cx - t / 2, cx + t / 2, main.y0, main.y1 + 0.4, cz - t / 2, cz + t / 2, accent);
  }
  // Facade: balcony bands across the front of homes, fins on offices (close up only for fins).
  if (residential && r() < 0.6) {
    const every = r() < 0.5 ? 1 : 2;
    m.detail(IN_SKY, () => {
      for (let f = 1; f * fh < main.y1 - main.y0 - 0.1; f += every) {
        const y = main.y0 + f * fh;
        m.box(main.x0 + 0.6, main.x1 - 0.6, y - 0.15, y + 0.15, main.z0 - 1, main.z0, accent);
      }
    });
  } else if (!residential && r() < 0.5) {
    m.detail(NEAR_ONLY, () => {
      const n = Math.max(2, Math.floor((main.x1 - main.x0) / 4));
      for (let k = 0; k <= n; k++) {
        const fx = main.x0 + (k * (main.x1 - main.x0)) / n;
        m.box(fx - 0.12, fx + 0.12, main.y0, main.y1, main.z0 - 0.5, main.z0, accent);
      }
    });
  }
  // The top: a lit crown, a spire, a pyramid cap, a water tank or plant.
  const cx = (roof.x0 + roof.x1) / 2;
  const cz = (roof.z0 + roof.z1) / 2;
  const rw = roof.x1 - roof.x0;
  const rd = roof.z1 - roof.z0;
  if (form === 'stepped' && !residential) {
    // A glowing band round the top, then a short mast.
    m.quad(
      [roof.x0 - 0.05, top - 1.2, roof.z0 - 0.06],
      [roof.x0 - 0.05, top - 0.3, roof.z0 - 0.06],
      [roof.x1 + 0.05, top - 0.3, roof.z0 - 0.06],
      [roof.x1 + 0.05, top - 1.2, roof.z0 - 0.06],
      C('#f6e7b8'),
      0.7,
    );
    m.parapet(roof.x0, roof.x1, roof.z0, roof.z1, top, accent, 1.2, 0.3);
    m.detail(IN_FAR, () => m.box(cx - 0.2, cx + 0.2, top, top + 8 + r() * 6, cz - 0.2, cz + 0.2, METAL));
  } else if (form === 'crown') {
    if (r() < 0.5) {
      m.hip(roof.x0, roof.x1, roof.z0, roof.z1, top, Math.min(rw, rd) * 0.6, accent, 0.2);
      m.detail(IN_FAR, () =>
        m.box(cx - 0.15, cx + 0.15, top, top + Math.min(rw, rd) * 0.6 + 6, cz - 0.15, cz + 0.15, METAL),
      );
    } else {
      m.box(cx - rw / 6, cx + rw / 6, top, top + 3, cz - rd / 6, cz + rd / 6, accent);
      m.frustum(cx, cz, Math.min(rw, rd) / 6, 0.15, top + 3, top + 14 + r() * 8, METAL, 6, false);
    }
  } else {
    m.parapet(roof.x0, roof.x1, roof.z0, roof.z1, top, form === 'slab' ? body : accent, 0.6, 0.3);
    m.detail(IN_SKY, () => {
      m.box(cx - rw / 3, cx + rw / 3, top, top + 2.5, cz - rd / 3, cz + rd / 3, METAL);
      if (residential && r() < 0.5) {
        // A water tank on legs, as the tenements have.
        const tx = roof.x0 + 2.2;
        const tz = roof.z1 - 2.2;
        for (const [lx, lz] of [
          [-0.9, -0.9],
          [0.9, -0.9],
          [-0.9, 0.9],
          [0.9, 0.9],
        ] as const)
          m.box(tx + lx - 0.1, tx + lx + 0.1, top, top + 2, tz + lz - 0.1, tz + lz + 0.1, METAL);
        m.cylinder(tx, tz, 1.3, top + 2, top + 4.2, WOOD, 8, C('#7a5a40'));
      } else if (!residential || r() < 0.4) {
        const mh = 6 + r() * 6;
        m.detail(IN_FAR, () =>
          m.box(cx - 0.2, cx + 0.2, top + 2.5, top + 2.5 + mh, cz - 0.2, cz + 0.2, METAL),
        );
      }
    });
  }
}

type ShopStyle = 'store' | 'cafe' | 'market';

/** Small shops: a corner store, a café with a terrace, or a mini-market behind its car park. */
function shop(m: ModelBuilder, def: ZonedDef, W: number, D: number, r: () => number): void {
  lotBase(m, W, D, PAVE);
  const x = r();
  const style: ShopStyle = W >= 14 && D >= 14 && x < 0.4 ? 'market' : x > 0.7 ? 'cafe' : 'store';
  const floors = def.level >= 3 && style !== 'market' ? 2 : 1;
  const fh = style === 'market' ? 4.6 : 3.8;
  const x0 = -W / 2 + 0.8;
  const x1 = W / 2 - 0.8;
  const setback = style === 'market' ? Math.min(8, D - 7) : style === 'cafe' ? Math.min(4.6, D - 5) : 2.2;
  const z0 = -D / 2 + setback;
  const z1 = Math.min(D / 2 - 0.8, z0 + Math.max(5, D - setback - 1.6));
  const wall = pick(r, WALLS_C);
  const top = floors * fh;
  m.box(x0, x1, 0, top, z0, z1, wall);
  // Shop window across the front, lit in the evening.
  m.quad(
    [x0 + 0.6, 0.4, z0 - 0.05],
    [x0 + 0.6, 2.8, z0 - 0.05],
    [x1 - 0.6, 2.8, z0 - 0.05],
    [x1 - 0.6, 0.4, z0 - 0.05],
    GLASS_SHOP,
    0.9,
  );
  if (floors > 1) m.windows('front', x0, x1, z0, z1, fh, floors - 1, fh, { col: GLASS, lit: litFn(r, 0.5) });
  if (style !== 'market') {
    const awning = pick(r, AWNINGS);
    m.detail(IN_SKY, () =>
      m.quad(
        [x0 + 0.3, 3.2, z0 - 1.8],
        [x0 + 0.3, 3.6, z0],
        [x1 - 0.3, 3.6, z0],
        [x1 - 0.3, 3.2, z0 - 1.8],
        awning,
      ),
    );
  }
  const sign = pick(r, SIGNS);
  m.box(
    (x0 + x1) / 2 - Math.min(2.5, (x1 - x0) / 3),
    (x0 + x1) / 2 + Math.min(2.5, (x1 - x0) / 3),
    top - 0.2,
    top + 1.1,
    z0 - 0.3,
    z0 - 0.05,
    sign,
  );
  m.detail(IN_FAR, () => m.parapet(x0, x1, z0, z1, top, wall, 0.5));
  // A false front over a store now and then (M28): a stepped or rounded-off board above the sign.
  if (style === 'store' && r() < 0.4) {
    const fw = x1 - x0;
    m.box(x0, x1, top, top + 1.2, z0, z0 + 0.3, wall);
    m.box(x0 + fw * 0.25, x1 - fw * 0.25, top + 1.2, top + 2, z0, z0 + 0.3, wall);
    m.detail(IN_FAR, () => m.box(x0 - 0.1, x1 + 0.1, top + 1.2, top + 1.35, z0 - 0.1, z0 + 0.4, TRIM));
  }
  if (r() < 0.6) m.detail(NEAR_ONLY, () => m.box(x0 + 1, x0 + 2.4, top, top + 1, z1 - 3, z1 - 1.6, METAL));
  if (style === 'cafe') {
    // Terrace umbrellas.
    const n = Math.max(1, Math.floor((x1 - x0) / 4));
    const col = pick(r, AWNINGS);
    for (let k = 0; k < n; k++) {
      const ux = x0 + (k + 0.5) * ((x1 - x0) / n);
      const uz = -D / 2 + 1.5;
      m.detail(NEAR_ONLY, () => {
        m.cylinder(ux, uz, 0.06, 0, 2.3, METAL, 4);
        m.frustum(ux, uz, 1.3, 0.08, 2.1, 2.7, k % 2 ? TRIM : col, 6, false);
      });
    }
  } else if (style === 'market') {
    // Car park in front with a few cars and a pole sign.
    m.detail(IN_SKY, () => m.ground(x0, x1, -D / 2 + 0.3, z0 - 0.3, 0.08, ASPHALT_LOT));
    const bays = Math.floor((x1 - x0) / 2.8);
    for (let k = 0; k < bays; k++)
      if (r() < 0.55) parkedCar(m, x0 + 1.4 + k * 2.8, z0 - 3, true, pick(r, CAR_COLOURS));
    m.detail(IN_SKY, () => {
      m.cylinder(x1 - 0.6, -D / 2 + 0.9, 0.12, 0, 5, METAL, 4);
      m.box(x1 - 1.9, x1 + 0.3, 4.2, 5.6, -D / 2 + 0.75, -D / 2 + 1.05, sign);
    });
  }
}

function midCommercial(m: ModelBuilder, def: ZonedDef, W: number, D: number, r: () => number): void {
  lotBase(m, W, D, PAVE);
  const floors = def.floors + Math.floor(r() * 2);
  const fh = 3.4;
  const x0 = -W / 2 + 0.8;
  const x1 = W / 2 - 0.8;
  const z0 = -D / 2 + 2;
  const z1 = D / 2 - 1.2;
  const wall = pick(r, WALLS_C);
  const top = floors * fh;
  m.box(x0, x1, 0, top, z0, z1, wall, C('#9a958c'));
  m.quad(
    [x0 + 0.4, 0.3, z0 - 0.05],
    [x0 + 0.4, 3, z0 - 0.05],
    [x1 - 0.4, 3, z0 - 0.05],
    [x1 - 0.4, 0.3, z0 - 0.05],
    GLASS_SHOP,
    0.9,
  );
  const lit = litFn(r, 0.6);
  for (const face of ['front', 'back', 'left', 'right'] as const) {
    m.windows(face, x0, x1, z0, z1, fh, floors - 1, fh, {
      col: pick(r, OFFICE_GLASS),
      lit,
      band: r() < 0.5,
      spacing: 3,
    });
  }
  const units = Math.max(1, Math.round((x1 - x0) / 7));
  for (let u = 0; u < units; u++) {
    const ax0 = x0 + (u * (x1 - x0)) / units + 0.3;
    const ax1 = x0 + ((u + 1) * (x1 - x0)) / units - 0.3;
    const col = pick(r, AWNINGS);
    m.detail(IN_SKY, () =>
      m.quad([ax0, 3.1, z0 - 1.6], [ax0, 3.5, z0], [ax1, 3.5, z0], [ax1, 3.1, z0 - 1.6], col),
    );
  }
  // Tops (M28): a cornice, a stepped parapet over the front, or a corner turret.
  const crown = r();
  if (crown < 0.35) m.detail(IN_FAR, () => m.cornice(x0, x1, z0, z1, top + 0.2, TRIM, 0.6, 0.4));
  m.parapet(x0, x1, z0, z1, top, wall);
  if (crown >= 0.35 && crown < 0.6) {
    const cw = Math.min(8, (x1 - x0) * 0.4);
    m.box(-cw / 2, cw / 2, top, top + 1.6, z0, z0 + 0.4, wall);
    m.box(-cw / 4, cw / 4, top + 1.6, top + 2.4, z0, z0 + 0.4, wall);
  } else if (crown >= 0.6 && crown < 0.8 && floors >= 3) {
    const tx = r() < 0.5 ? x0 + 1.8 : x1 - 1.8;
    m.cylinder(tx, z0 + 1.8, 2, 0, top + 2.2, wall, 8);
    m.frustum(tx, z0 + 1.8, 2.2, 0.1, top + 2.2, top + 4.6, pick(r, ROOFS), 8, false);
  }
  m.detail(IN_SKY, () => {
    for (let k = 0; k < 2; k++)
      m.box(x0 + 1.5 + k * 3, x0 + 3.5 + k * 3, top, top + 1.2, z0 + 2, z0 + 3.5, METAL);
  });
  if (r() < 0.5) {
    const col = pick(r, SIGNS);
    m.detail(IN_SKY, () => m.box(-2.5, 2.5, top - 0.5, top + 1.3, z0 - 0.4, z0 - 0.1, col));
  }
}

function industry(m: ModelBuilder, def: ZonedDef, W: number, D: number, r: () => number): void {
  const tier = def.wealth;
  lotBase(m, W, D, tier === 2 ? GRASS_RICH : CONCRETE);
  const x0 = -W / 2 + 1;
  const x1 = W / 2 - 1;
  const z0 = -D / 2 + 3;
  const z1 = D / 2 - 1.2;
  if (tier === 2) {
    // High-tech campus: white blocks, glass bands, solar roofs.
    const floors = 2 + def.level;
    const fh = 3.6;
    const wall = WHITE;
    const glass = pick(r, OFFICE_GLASS);
    const midZ = z0 + (z1 - z0) * 0.55;
    m.box(x0, x1, 0, floors * fh, z0, midZ, wall);
    for (const face of ['front', 'left', 'right'] as const)
      m.windows(face, x0, x1, z0, midZ, 0, floors, fh, { col: glass, lit: litFn(r, 0.7), band: true });
    m.box(x0 + 2, x1 - 2, 0, (floors - 1) * fh, midZ, z1, C('#e3e8ec'));
    for (let k = 0; k < 3; k++)
      m.quad(
        [x0 + 1 + k * ((x1 - x0 - 2) / 3), floors * fh + 0.3, z0 + 1],
        [x0 + 1 + k * ((x1 - x0 - 2) / 3), floors * fh + 0.9, midZ - 1],
        [x0 + (k + 1) * ((x1 - x0 - 2) / 3), floors * fh + 0.9, midZ - 1],
        [x0 + (k + 1) * ((x1 - x0 - 2) / 3), floors * fh + 0.3, z0 + 1],
        SOLAR,
      );
    m.parapet(x0, x1, z0, midZ, floors * fh, wall, 0.4);
    // Some campuses get a glass drum at the entrance corner.
    if (r() < 0.5) {
      const cx = r() < 0.5 ? x0 + 2.8 : x1 - 2.8;
      m.cylinder(cx, z0 + 1.6, 2.6, 0, floors * fh + 1.6, glass, 10, WHITE);
    }
    return;
  }
  const wall = pick(r, WALLS_I);
  const h = 6 + def.level * 1.5 + tier * 1.5;
  const hallZ1 = z1 - (W > 20 ? 6 : 3);
  // Heavy industry comes as saw-tooth sheds, barrel-roofed warehouses or tank farms.
  const style = tier === 1 ? 'works' : r() < 0.4 ? 'sawtooth' : r() < 0.55 ? 'warehouse' : 'tanks';
  const hx1 = style === 'tanks' && W >= 16 ? x0 + (x1 - x0) * 0.55 : x1;
  m.box(x0, hx1, 0, h, z0, hallZ1, wall, C('#8a8d91'));
  // Loading doors on the front.
  const doors = Math.max(1, Math.floor((hx1 - x0) / 7));
  for (let k = 0; k < doors; k++) {
    const cx = x0 + (k + 0.5) * ((hx1 - x0) / doors);
    m.detail(IN_FAR, () => {
      m.quad(
        [cx - 1.6, 0, z0 - 0.05],
        [cx - 1.6, 4, z0 - 0.05],
        [cx + 1.6, 4, z0 - 0.05],
        [cx + 1.6, 0, z0 - 0.05],
        C('#6f7479'),
      );
      m.box(cx - 2, cx + 2, 4.2, 4.5, z0 - 1.2, z0, YELLOW);
    });
  }
  m.windows('left', x0, hx1, z0, hallZ1, 0, 1, h, {
    col: GLASS,
    lit: litFn(r, 0.4),
    band: true,
    height: 1.2,
  });
  m.windows('right', x0, hx1, z0, hallZ1, 0, 1, h, {
    col: GLASS,
    lit: litFn(r, 0.4),
    band: true,
    height: 1.2,
  });
  const yard = hallZ1 < z1 - 2;
  if (style === 'sawtooth') {
    const teeth = Math.max(2, Math.floor((hallZ1 - z0) / 4));
    const step = (hallZ1 - z0) / teeth;
    for (let k = 0; k < teeth; k++) {
      const za = z0 + k * step;
      const zb = za + step;
      m.quad([x0, h, za], [x0, h + 2.2, za], [x1, h + 2.2, za], [x1, h, za], GLASS, 0.3);
      m.quad([x1, h, zb], [x1, h + 2.2, za], [x0, h + 2.2, za], [x0, h, zb], C('#7b7f84'));
    }
    if (W > 18) {
      m.cylinder(x0 + 3.5, Math.min(hallZ1 + 3, D / 2 - 3), 2.4, 0, 6, C('#c9c6bf'), 10, C('#a8a5a0'));
    }
  } else if (style === 'warehouse') {
    // Barrel roof.
    const segs = 6;
    const hw = (hx1 - x0) / 2;
    const xm = x0 + hw;
    const rise = Math.min(3.2, hw * 0.4);
    const roof = r() < 0.5 ? C('#8e969c') : C('#a0583a');
    const pt = (k: number) => {
      const a = Math.PI * (1 - k / segs);
      return [xm + Math.cos(a) * hw, h + Math.sin(a) * rise] as const;
    };
    for (let k = 0; k < segs; k++) {
      const [xa, ya] = pt(k);
      const [xb, yb] = pt(k + 1);
      m.quad([xa, ya, z0], [xa, ya, hallZ1], [xb, yb, hallZ1], [xb, yb, z0], roof);
      m.tri([xm, h, z0], [xa, ya, z0], [xb, yb, z0], 0, 0, -1, wall);
      m.tri([xm, h, hallZ1], [xb, yb, hallZ1], [xa, ya, hallZ1], 0, 0, 1, wall);
    }
  } else if (style === 'tanks') {
    m.parapet(x0, hx1, z0, hallZ1, h, wall, 0.4);
    const tx0 = hx1 + 1;
    const R = Math.max(1.6, Math.min(3.2, (x1 - tx0) / 2 - 0.2));
    const tx = W >= 16 ? tx0 + R : x1 - R - 0.5;
    const n = Math.max(1, Math.floor((z1 - z0) / (2 * R + 1)));
    const th = 5 + r() * 4;
    for (let k = 0; k < n; k++) {
      const tz = z0 + R + 0.5 + k * (2 * R + 1);
      if (W < 16 && tz < hallZ1 + R) continue;
      m.cylinder(tx, tz, R, 0, th, TANK, 10);
      m.dome(tx, tz, R, th, TANK, 2, 10);
      m.detail(NEAR_ONLY, () => m.box(tx - R - 1.2, tx - R + 0.1, 2.2, 2.7, tz - 0.25, tz + 0.25, METAL));
    }
  } else {
    // Manufacturing: flat roof with vents and a front office.
    m.parapet(x0, x1, z0, hallZ1, h, wall, 0.4);
    m.detail(IN_SKY, () => {
      for (let k = 0; k < 3; k++)
        m.cylinder(x0 + 3 + k * ((x1 - x0 - 6) / 2), (z0 + hallZ1) / 2, 0.7, h, h + 1.6, METAL, 6);
    });
    m.box(x0, Math.min(x1, x0 + 9), 0, 7, z0 - 0.1, z0 + 5, C('#d9d6cf'));
    m.windows('front', x0, Math.min(x1, x0 + 9), z0 - 0.1, z0 + 5, 0, 2, 3.5, {
      col: GLASS,
      lit: litFn(r, 0.6),
      band: true,
    });
  }
  if (style !== 'works' && style !== 'tanks' && (def.level >= 2 || r() < 0.35)) {
    const sx = x1 - 2.5;
    const sz = Math.min(hallZ1 + 2.5, D / 2 - 2);
    const stackH = h + 5 + def.level * 2.5;
    m.cylinder(sx, sz, 0.9, 0, stackH, RUST, 8);
    m.cylinder(sx, sz, 0.95, stackH - 1.8, stackH - 0.9, WHITE, 8);
  }
  if (yard) {
    // Yard behind the hall, with shipping containers now and then.
    m.detail(IN_SKY, () => m.ground(x0, hx1, hallZ1 + 0.3, z1, 0.08, ASPHALT_LOT));
    if ((style === 'warehouse' || style === 'works') && r() < 0.65) {
      const zc = (hallZ1 + z1) / 2;
      const n = Math.min(4, Math.floor((hx1 - x0 - 5) / 6.4));
      for (let k = 0; k < n; k++) {
        const cx0 = x0 + 1 + k * 6.4;
        const stack = r() < 0.3 ? 2 : 1;
        for (let l = 0; l < stack; l++) {
          const col = pick(r, CONTAINERS);
          m.detail(IN_SKY, () => m.box(cx0, cx0 + 6, l * 2.6, (l + 1) * 2.6, zc - 1.2, zc + 1.2, col));
        }
      }
    }
  }
}

/** The generator's palettes, for repainting hand-made models (phase 3). */
export const PALETTES = {
  wallsR: WALLS_R,
  wallsRich: WALLS_R_RICH,
  wallsC: WALLS_C,
  wallsI: WALLS_I,
  brick: BRICK,
  modern: MODERN_WALLS.slice(0, 3),
  roofs: ROOFS,
  awnings: AWNINGS,
  signs: SIGNS,
  stone: STONE,
  grass: GRASS,
  grassRich: GRASS_RICH,
  pave: PAVE,
  concrete: CONCRETE,
  asphalt: ASPHALT_LOT,
  hedge: HEDGE,
  wood: WOOD,
  cars: CAR_COLOURS,
  carGlass: CAR_GLASS,
  containers: CONTAINERS,
  yellow: YELLOW,
};

/** Build the procedural model for a zoned building on a w×d-cell lot. */
export function buildZonedModel(def: ZonedDef, w: number, d: number, variant: number): ModelData {
  const W = w * CELL;
  const D = d * CELL;
  // The type in the seed too (M28): two types on the same lot used to draw the same building.
  const r = modelRng(
    variant * 7919 + w * 31 + d * 17 + def.level * 3 + def.zone * 1009 + def.density * 211 + def.wealth * 53,
  );
  const m = new ModelBuilder();
  if (def.zone === ZONE_R) {
    if (def.density === 0) house(m, def, W, D, r);
    else if (def.density === 1)
      (def.level === 1 && W >= 12 && r() < 0.8 ? townhouses : apartments)(m, def, W, D, r);
    else tower(m, def, W, D, r, true);
  } else if (def.zone === ZONE_C) {
    if (def.density === 0) shop(m, def, W, D, r);
    else if (def.density === 1) midCommercial(m, def, W, D, r);
    else tower(m, def, W, D, r, false);
  } else if (def.zone === ZONE_I) {
    industry(m, def, W, D, r);
  }
  return m.build();
}
