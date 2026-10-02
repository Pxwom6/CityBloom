import { Color } from 'three';
import { SEASONAL, SURF_GRASS, type ModelBuilder } from './builder';

/**
 * Specialisation buildings (M10): hotels, landmarks, freight, mining, oil and research. All designs
 * are original. Local space as for every model: x along the road, front faces −z, y up.
 */
const C = (hex: string) => new Color(hex);
const PAVING = C('#d8d2c4');
const PLAZA = C('#cfc6b4');
const GRASS = C('#8cc063');
SEASONAL.set(GRASS, SURF_GRASS);
const ASPHALT = C('#8a8d91');
const GRAVEL = C('#bdb6a6');
const STONE = C('#c9bfae');
const STONE_DARK = C('#a89c88');
const BRICK = C('#a9553f');
const BRICK_DARK = C('#8a4433');
const WHITE = C('#f2f4f5');
const STEEL = C('#9aa0a6');
const STEEL_DARK = C('#6f757c');
const GLASS = C('#3d5a73');
const GLASS_LIGHT = C('#8fc3d8');
const TEAL = C('#1f9e8f');
const GOLD = C('#d9a938');
const RED = C('#c9423a');
const LEAF = C('#5f9a45');
const TRUNK = C('#6b4f36');
const EARTH = C('#8b7355');
const SPOIL = C('#7a6e62');
const CONTAINERS = ['#c0392b', '#2e86c1', '#d4ac0d', '#1e8449', '#7d3c98', '#d35400'].map(C);
const CABINS = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71'].map(C);

type V3 = [number, number, number];

function base(m: ModelBuilder, W: number, D: number, top: Color): void {
  m.box(-W / 2 + 0.2, W / 2 - 0.2, -5, 0.06, -D / 2 + 0.2, D / 2 - 0.2, STONE_DARK, top);
}

function tree(m: ModelBuilder, x: number, z: number, s: number): void {
  m.cylinder(x, z, 0.25 * s, 0, 2 * s, TRUNK, 5);
  m.dome(x, z, 1.8 * s, 1.6 * s, LEAF, 2, 7);
}

/** A square-section beam from a to b (any direction), thickness t. */
function beam(m: ModelBuilder, a: V3, b: V3, t: number, col: Color, emi = 0): void {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
  const n = d.map((x) => x / len) as V3;
  const up: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cross = (p: V3, q: V3): V3 => [
    p[1] * q[2] - p[2] * q[1],
    p[2] * q[0] - p[0] * q[2],
    p[0] * q[1] - p[1] * q[0],
  ];
  const norm = (p: V3): V3 => {
    const l = Math.hypot(...p) || 1;
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  const u = norm(cross(n, up));
  const v = norm(cross(n, u));
  const h = t / 2;
  const off = (k: number): V3 => {
    const a2 = (Math.PI / 2) * k + Math.PI / 4;
    const cu = Math.cos(a2) * h * Math.SQRT2;
    const cv = Math.sin(a2) * h * Math.SQRT2;
    return [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv, u[2] * cu + v[2] * cv];
  };
  const add = (p: V3, o: V3): number[] => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  for (let k = 0; k < 4; k++) {
    const o0 = off(k);
    const o1 = off(k + 1);
    const out: V3 = [o0[0] + o1[0], o0[1] + o1[1], o0[2] + o1[2]];
    face(m, add(a, o0), add(b, o0), add(b, o1), add(a, o1), out, col, emi);
  }
}

/** A quad wound so its normal points along `out`. */
function face(
  m: ModelBuilder,
  p0: number[],
  p1: number[],
  p2: number[],
  p3: number[],
  out: V3,
  col: Color,
  emi = 0,
): void {
  const ux = p1[0]! - p0[0]!;
  const uy = p1[1]! - p0[1]!;
  const uz = p1[2]! - p0[2]!;
  const vx = p3[0]! - p0[0]!;
  const vy = p3[1]! - p0[1]!;
  const vz = p3[2]! - p0[2]!;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) m.quad(p0, p1, p2, p3, col, emi);
  else m.quad(p0, p3, p2, p1, col, emi);
}

function lit(r: () => number, p = 0.6): () => number {
  return () => (r() < p ? 0.6 + r() * 0.4 : 0);
}

function hotel(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, PAVING);
  const x0 = -W / 2 + 3;
  const x1 = W / 2 - 3;
  const z0 = -D / 2 + 6;
  const z1 = D / 2 - 4;
  const floors = 9;
  const fh = 3.2;
  const wall = r() < 0.5 ? C('#e8dcc8') : C('#dfe6ea');
  m.box(x0, x1, 0, 5, z0 - 1, z1, C('#caa56a'));
  m.box(x0 + 2, x1 - 2, 5, 5 + floors * fh, z0, z1 - 2, wall, C('#9a958c'));
  for (const f of ['front', 'back', 'left', 'right'] as const)
    m.windows(f, x0 + 2, x1 - 2, z0, z1 - 2, 5, floors, fh, { col: GLASS, lit: lit(r, 0.7), spacing: 2.8 });
  // Balcony bands and an entrance canopy.
  for (let k = 1; k < floors; k++)
    m.box(x0 + 1.6, x1 - 1.6, 5 + k * fh - 0.15, 5 + k * fh + 0.1, z0 - 1, z0, WHITE);
  m.box(-5, 5, 3.4, 3.8, z0 - 5, z0 - 1, GOLD);
  for (const x of [-4.6, 4.6]) m.cylinder(x, z0 - 4.6, 0.2, 0, 3.4, GOLD, 6);
  m.quad([-2, 0.3, z0 - 1.05], [-2, 3, z0 - 1.05], [2, 3, z0 - 1.05], [2, 0.3, z0 - 1.05], GLASS_LIGHT, 0.8);
  const top = 5 + floors * fh;
  m.parapet(x0 + 2, x1 - 2, z0, z1 - 2, top, wall, 0.6);
  // A lit sign on the roof.
  m.box(-6, 6, top + 0.6, top + 3, z0 + 0.4, z0 + 0.8, RED, RED);
  m.quad(
    [-5.6, top + 0.9, z0 + 0.35],
    [-5.6, top + 2.7, z0 + 0.35],
    [5.6, top + 2.7, z0 + 0.35],
    [5.6, top + 0.9, z0 + 0.35],
    C('#ffe7b0'),
    0.9,
  );
  // Pool terrace at the back.
  m.ground(x0 + 3, x1 - 3, z1 - 1.6, D / 2 - 1, 5.1, C('#5ec3e8'));
}

function clocktower(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, PLAZA);
  const h = 34;
  const s = 3.6;
  m.box(-s - 1, s + 1, 0, 3, -s - 1, s + 1, STONE_DARK);
  m.box(-s, s, 3, h, -s, s, BRICK, BRICK_DARK);
  // Stone bands and corner piers.
  for (const y of [12, 22]) m.box(-s - 0.3, s + 0.3, y, y + 0.6, -s - 0.3, s + 0.3, STONE);
  for (const [x, z] of [
    [-s, -s],
    [s, -s],
    [-s, s],
    [s, s],
  ] as const)
    m.box(x - 0.5, x + 0.5, 3, h, z - 0.5, z + 0.5, BRICK_DARK);
  // Clock faces on all four sides, lit at night.
  const y = h - 4;
  const f = 2.4;
  m.quad(
    [-f, y - f, -s - 0.06],
    [-f, y + f, -s - 0.06],
    [f, y + f, -s - 0.06],
    [f, y - f, -s - 0.06],
    WHITE,
    0.6,
  );
  m.quad(
    [f, y - f, s + 0.06],
    [f, y + f, s + 0.06],
    [-f, y + f, s + 0.06],
    [-f, y - f, s + 0.06],
    WHITE,
    0.6,
  );
  m.quad(
    [-s - 0.06, y - f, f],
    [-s - 0.06, y + f, f],
    [-s - 0.06, y + f, -f],
    [-s - 0.06, y - f, -f],
    WHITE,
    0.6,
  );
  m.quad(
    [s + 0.06, y - f, -f],
    [s + 0.06, y + f, -f],
    [s + 0.06, y + f, f],
    [s + 0.06, y - f, f],
    WHITE,
    0.6,
  );
  // Hands (ten past ten) on the front.
  beam(m, [0, y, -s - 0.15], [-1.3, y + 1.0, -s - 0.15], 0.25, C('#222222'));
  beam(m, [0, y, -s - 0.15], [1.7, y + 1.3, -s - 0.15], 0.2, C('#222222'));
  m.box(-s - 0.4, s + 0.4, h, h + 0.8, -s - 0.4, s + 0.4, STONE);
  m.hip(-s, s, -s, s, h + 0.8, 7, C('#3f5f58'), 0.3);
  m.cylinder(0, 0, 0.12, h + 7.5, h + 11, GOLD, 5);
  // Square with trees and benches.
  for (const [x, z] of [
    [-8, -8],
    [8, -8],
    [-8, 8],
    [8, 8],
  ] as const)
    tree(m, x, z, 1.1);
}

function wheel(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, PAVING);
  const R = 15;
  const cy = R + 3.5;
  const zs = [-1.5, 1.5];
  // Legs: an A-frame on each side of the rim.
  for (const z of [-3.2, 3.2]) {
    beam(m, [-9, 0, z], [0, cy, z * 0.5], 0.8, WHITE);
    beam(m, [9, 0, z], [0, cy, z * 0.5], 0.8, WHITE);
  }
  beam(m, [0, cy, -2.2], [0, cy, 2.2], 1.4, STEEL_DARK);
  const n = 24;
  const pt = (k: number, rad: number, z: number): V3 => {
    const a = (k / n) * Math.PI * 2;
    return [Math.cos(a) * rad, cy + Math.sin(a) * rad, z];
  };
  for (const z of zs)
    for (let k = 0; k < n; k++) {
      beam(m, pt(k, R, z), pt(k + 1, R, z), 0.5, WHITE);
      if (k % 2 === 0) beam(m, [0, cy, z], pt(k, R, z), 0.22, STEEL);
    }
  // Cabins hang below the rim.
  for (let k = 0; k < n; k += 2) {
    const p = pt(k, R, 0);
    const col = CABINS[Math.floor(r() * CABINS.length)]!;
    m.box(p[0] - 1, p[0] + 1, p[1] - 2.6, p[1] - 0.6, -1.1, 1.1, col, WHITE);
    m.box(p[0] - 0.9, p[0] + 0.9, p[1] - 2.2, p[1] - 1.2, -1.15, 1.15, GLASS_LIGHT);
  }
  // Ticket booth and queue rails.
  m.box(-W / 2 + 3, -W / 2 + 9, 0, 3, -D / 2 + 3, -D / 2 + 7, TEAL, WHITE);
  m.box(W / 2 - 9, W / 2 - 3, 0, 3, -D / 2 + 3, -D / 2 + 7, TEAL, WHITE);
}

function conservatory(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, GRASS);
  m.ground(-W / 2 + 1, W / 2 - 1, -D / 2 + 1, -D / 2 + 7, 0.1, PLAZA);
  // A central glass dome on a white drum, with two smaller wings.
  m.cylinder(0, 2, 11, 0, 5, WHITE, 16);
  m.dome(0, 2, 11, 5, GLASS_LIGHT, 5, 16);
  m.cylinder(0, 2, 1.2, 15.5, 18, WHITE, 8);
  for (const x of [-16, 16]) {
    m.box(x - 6, x + 6, 0, 4, -4, 10, WHITE);
    m.dome(x, 3, 6.5, 4, GLASS_LIGHT, 4, 12);
  }
  // Ribs over the big dome.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (let j = 0; j < 4; j++) {
      const t0 = (j / 4) * (Math.PI / 2);
      const t1 = ((j + 1) / 4) * (Math.PI / 2);
      const p = (t: number): V3 => [
        Math.cos(a) * 11.05 * Math.cos(t),
        5 + 11.05 * Math.sin(t),
        2 + Math.sin(a) * 11.05 * Math.cos(t),
      ];
      beam(m, p(t0), p(t1), 0.35, WHITE);
    }
  }
  for (const [x, z] of [
    [-20, -10],
    [20, -10],
    [-20, 16],
    [20, 16],
  ] as const)
    tree(m, x, z, 1.2);
}

function skyneedle(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, PLAZA);
  // Three legs flaring to a slim shaft, a disc pod near the top and a spire.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    beam(m, [Math.cos(a) * 11, 0, Math.sin(a) * 11], [Math.cos(a) * 2, 40, Math.sin(a) * 2], 1.6, WHITE);
  }
  m.cylinder(0, 0, 2.2, 0, 100, WHITE, 10);
  m.frustum(0, 0, 3, 10, 96, 101, WHITE, 16);
  m.cylinder(0, 0, 10, 101, 106, GLASS, 16);
  m.windows('front', -7, 7, -10.1, 10.1, 101, 1, 5, {
    col: C('#ffe1a0'),
    lit: () => 0.9,
    band: true,
    height: 3,
  });
  m.frustum(0, 0, 10.5, 4, 106, 110, C('#e07b39'), 16);
  m.cylinder(0, 0, 0.5, 110, 132, STEEL, 6);
  m.cylinder(0, 0, 0.8, 131, 132, RED, 6);
  // A pavilion at the foot.
  m.box(-8, 8, 0, 4, -D / 2 + 2, -D / 2 + 8, GLASS_LIGHT, WHITE);
}

function grandarch(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, PLAZA);
  const h = 38;
  const pier = 8;
  const x0 = -W / 2 + 4;
  const x1 = W / 2 - 4;
  const z0 = -6;
  const z1 = 6;
  m.box(x0, x0 + pier, 0, h, z0, z1, STONE, STONE);
  m.box(x1 - pier, x1, 0, h, z0, z1, STONE, STONE);
  m.box(x0, x1, h, h + 9, z0, z1, STONE, STONE_DARK);
  // Stepped inner arch.
  for (let k = 0; k < 5; k++) {
    const y = h - 4 - k * 2.2;
    const inset = pier + k * 1.6;
    m.box(x0 + pier, x0 + inset + 1.6, y, h, z0 + 0.5, z1 - 0.5, STONE_DARK);
    m.box(x1 - inset - 1.6, x1 - pier, y, h, z0 + 0.5, z1 - 0.5, STONE_DARK);
  }
  m.box(x0 - 0.4, x1 + 0.4, h + 9, h + 10, z0 - 0.4, z1 + 0.4, GOLD);
  // Relief panels on the piers.
  for (const x of [x0 + pier / 2, x1 - pier / 2])
    m.quad(
      [x - 2.5, 10, z0 - 0.06],
      [x - 2.5, 26, z0 - 0.06],
      [x + 2.5, 26, z0 - 0.06],
      [x + 2.5, 10, z0 - 0.06],
      STONE_DARK,
    );
  for (const x of [-W / 2 + 3, W / 2 - 3]) for (const z of [-D / 2 + 3, D / 2 - 3]) tree(m, x, z, 1);
}

function freighthub(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, ASPHALT);
  // Container stacks.
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 5; col++) {
      const x = -W / 2 + 6 + col * 7;
      const z = -D / 2 + 10 + row * 4;
      const stack = 1 + Math.floor(r() * 3);
      for (let k = 0; k < stack; k++)
        m.box(x, x + 6, k * 2.6, (k + 1) * 2.6, z, z + 2.4, CONTAINERS[Math.floor(r() * CONTAINERS.length)]!);
    }
  // A gantry crane over the stacks.
  const gx0 = -W / 2 + 4;
  const gx1 = -W / 2 + 40;
  for (const x of [gx0, gx1])
    for (const z of [-D / 2 + 7, -D / 2 + 25]) m.box(x - 0.6, x + 0.6, 0, 14, z - 0.6, z + 0.6, YELLOW_C);
  m.box(gx0 - 0.8, gx1 + 0.8, 14, 15.4, -D / 2 + 6, -D / 2 + 8, YELLOW_C);
  m.box(gx0 - 0.8, gx1 + 0.8, 14, 15.4, -D / 2 + 24, -D / 2 + 26, YELLOW_C);
  m.box(gx0 + 12, gx0 + 16, 12, 16, -D / 2 + 6, -D / 2 + 26, YELLOW_C);
  // Transit shed and trucks.
  m.box(W / 2 - 16, W / 2 - 2, 0, 9, -D / 2 + 4, D / 2 - 4, C('#b9b4a8'), STEEL);
  for (let k = 0; k < 3; k++) {
    const z = D / 2 - 8 - k * 5;
    m.box(-W / 2 + 6, -W / 2 + 18, 0.6, 3.6, z - 1.2, z + 1.2, CONTAINERS[k]!);
    m.box(-W / 2 + 18, -W / 2 + 21, 0.6, 3.2, z - 1.1, z + 1.1, WHITE);
  }
}
const YELLOW_C = C('#e0b030');

function oremine(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, GRAVEL);
  // Headframe over the shaft.
  const hx = -W / 2 + 10;
  const hz = 0;
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ] as const)
    beam(m, [hx + x * 1.4, 0, hz + z * 1.4], [hx + x * 0.5, 22, hz + z * 0.5], 0.7, RED);
  m.box(hx - 2.5, hx + 2.5, 22, 24, hz - 2.5, hz + 2.5, RED);
  m.cylinder(hx, hz, 1.6, 24, 24.5, STEEL_DARK, 10);
  beam(m, [hx + 1, 23, hz], [hx + 12, 0.5, hz], 0.35, STEEL_DARK);
  // Spoil heaps and a conveyor to the loading shed.
  m.frustum(W / 2 - 10, -D / 2 + 10, 8, 1.5, 0, 8, SPOIL, 10);
  m.frustum(W / 2 - 12, D / 2 - 10, 7, 1.2, 0, 6, EARTH, 10);
  beam(m, [hx + 4, 3, hz + 4], [W / 2 - 12, 9, D / 2 - 10], 1, STEEL);
  m.box(-6, 6, 0, 7, D / 2 - 12, D / 2 - 3, C('#8e969c'), STEEL_DARK);
}

function oilwell(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, GRAVEL);
  // A pumpjack: base, samson post, walking beam and horse head.
  m.box(-6, 4, 0, 1, -1.5, 1.5, STEEL_DARK);
  beam(m, [-1, 1, -1.2], [0, 6, 0], 0.5, STEEL);
  beam(m, [-1, 1, 1.2], [0, 6, 0], 0.5, STEEL);
  beam(m, [1, 1, 0], [0, 6, 0], 0.5, STEEL);
  beam(m, [-5.5, 5.2, 0], [5, 6.8, 0], 0.8, C('#2c3e50'));
  m.box(5, 6.2, 4.5, 7.4, -0.7, 0.7, C('#2c3e50'));
  m.box(-6.5, -4.5, 1, 4, -1.4, 1.4, RED);
  m.cylinder(5.6, 0, 0.18, 0, 4.5, STEEL_DARK, 6);
  // Storage tanks and a pipe.
  for (const [x, z] of [
    [-6, 7],
    [2, 7],
  ] as const) {
    m.cylinder(x, z, 3, 0, 5, C('#dcdad4'), 12);
    m.dome(x, z, 3, 5, C('#dcdad4'), 2, 12);
  }
  beam(m, [5.6, 0.6, 0], [5.6, 0.6, 7], 0.4, STEEL_DARK);
  beam(m, [5.6, 0.6, 7], [5, 0.6, 7], 0.4, STEEL_DARK);
}

function techpark(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, GRASS);
  m.ground(-W / 2 + 1, W / 2 - 1, -D / 2 + 1, -D / 2 + 8, 0.08, ASPHALT);
  const block = (x0: number, x1: number, z0: number, z1: number, floors: number, glass: Color) => {
    m.box(x0, x1, 0, floors * 3.6, z0, z1, WHITE, C('#c8ccd0'));
    for (const f of ['front', 'back', 'left', 'right'] as const)
      m.windows(f, x0, x1, z0, z1, 0, floors, 3.6, { col: glass, lit: lit(r, 0.75), band: true });
  };
  block(-W / 2 + 3, -W / 2 + 21, -D / 2 + 10, -D / 2 + 24, 4, GLASS);
  block(-W / 2 + 25, -W / 2 + 41, -D / 2 + 12, D / 2 - 4, 3, C('#5f88a8'));
  // The lab with an observatory dome.
  m.box(W / 2 - 13, W / 2 - 3, 0, 8, -D / 2 + 10, -D / 2 + 22, C('#e3e8ec'));
  m.cylinder(W / 2 - 8, -D / 2 + 16, 3.4, 8, 9, STEEL, 12);
  m.dome(W / 2 - 8, -D / 2 + 16, 3.4, 9, WHITE, 3, 12);
  // Solar on the roofs, trees on the lawn.
  m.quad(
    [-W / 2 + 4, 14.6, -D / 2 + 11],
    [-W / 2 + 4, 15.2, -D / 2 + 23],
    [-W / 2 + 20, 15.2, -D / 2 + 23],
    [-W / 2 + 20, 14.6, -D / 2 + 11],
    C('#2c3e66'),
  );
  for (const [x, z] of [
    [-W / 2 + 8, D / 2 - 6],
    [-W / 2 + 16, D / 2 - 8],
    [W / 2 - 8, D / 2 - 7],
  ] as const)
    tree(m, x, z, 1.1);
}

/** Build a specialisation model into `m`; false if `model` isn't one of these. */
export function buildSpecialModel(
  model: string,
  m: ModelBuilder,
  W: number,
  D: number,
  r: () => number,
): boolean {
  switch (model) {
    case 'hotel':
      hotel(m, W, D, r);
      return true;
    case 'clocktower':
      clocktower(m, W, D);
      return true;
    case 'wheel':
      wheel(m, W, D, r);
      return true;
    case 'conservatory':
      conservatory(m, W, D);
      return true;
    case 'skyneedle':
      skyneedle(m, W, D);
      return true;
    case 'grandarch':
      grandarch(m, W, D);
      return true;
    case 'freighthub':
      freighthub(m, W, D, r);
      return true;
    case 'oremine':
      oremine(m, W, D);
      return true;
    case 'oilwell':
      oilwell(m, W, D);
      return true;
    case 'techpark':
      techpark(m, W, D, r);
      return true;
    case 'airport':
      airport(m, W, D, r);
      return true;
    case 'seaport':
      seaport(m, W, D, r);
      return true;
    default:
      return false;
  }
}

/** A parked plane (for the apron): fuselage along x, wings and tail, facing +x. */
export function plane(m: ModelBuilder, x: number, z: number, y: number, len: number, livery: Color): void {
  const r = len * 0.06;
  m.box(x - len / 2, x + len / 2, y, y + r * 2, z - r, z + r, WHITE, WHITE);
  m.box(x + len / 2 - r, x + len / 2 + r * 0.8, y + r * 0.3, y + r * 1.7, z - r * 0.8, z + r * 0.8, GLASS);
  m.box(x - len * 0.1, x + len * 0.12, y + r * 0.6, y + r * 0.9, z - len * 0.45, z + len * 0.45, WHITE);
  m.box(x - len / 2, x - len * 0.38, y + r * 2, y + r * 5, z - r * 0.25, z + r * 0.25, livery);
  m.box(x - len / 2, x - len * 0.4, y + r * 1.4, y + r * 1.7, z - len * 0.16, z + len * 0.16, WHITE);
  m.box(x - len * 0.2, x + len * 0.3, y + r * 1.9, y + r * 2.05, z - r * 1.02, z + r * 1.02, livery);
}

/** Airport (M23): terminal and tower on the landside, apron with parked planes, a runway at the back. */
function airport(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, GRASS);
  const front = -D / 2;
  // Forecourt and car park.
  m.ground(-W / 2 + 4, W / 2 - 4, front + 1, front + 10, 0.08, ASPHALT);
  // Terminal: a long glass hall with a curved-looking stepped roof.
  m.box(-70, 70, 0, 11, front + 11, front + 34, C('#e6e8ea'), C('#c3c9cf'));
  m.box(-66, 66, 11, 14, front + 14, front + 31, C('#dfe3e7'), STEEL);
  m.windows('front', -70, 70, front + 11, front + 34, 0, 2, 11, {
    col: GLASS,
    lit: lit(r, 0.8),
    band: true,
    height: 3.5,
  });
  // Jet bridges out to the apron.
  for (const x of [-45, -15, 15, 45]) m.box(x - 1.4, x + 1.4, 4, 6.5, front + 34, front + 46, STEEL);
  // Control tower.
  m.cylinder(95, front + 22, 2.8, 0, 34, C('#eef0f2'), 10);
  m.frustum(95, front + 22, 5.5, 6.5, 34, 38.5, GLASS, 10);
  m.frustum(95, front + 22, 6.8, 2, 38.5, 40, STEEL_DARK, 10);
  // Hangar.
  m.box(-W / 2 + 12, -W / 2 + 62, 0, 16, front + 12, front + 52, C('#b9c0c6'), C('#8f989f'));
  // Apron and taxiway.
  m.ground(-100, 100, front + 34, front + 74, 0.1, C('#c2c2bd'));
  m.ground(-W / 2 + 70, -W / 2 + 84, front + 74, D / 2 - 30, 0.1, C('#c2c2bd'));
  m.ground(W / 2 - 84, W / 2 - 70, front + 74, D / 2 - 30, 0.1, C('#c2c2bd'));
  // Runway with its markings.
  const rz0 = D / 2 - 30;
  const rz1 = D / 2 - 8;
  m.ground(-W / 2 + 6, W / 2 - 6, rz0, rz1, 0.12, C('#55595e'));
  const mid = (rz0 + rz1) / 2;
  for (let x = -W / 2 + 40; x < W / 2 - 40; x += 18) m.ground(x, x + 9, mid - 0.4, mid + 0.4, 0.14, WHITE);
  for (const end of [-1, 1])
    for (let k = -3; k <= 3; k++) {
      const x = end * (W / 2 - 14);
      m.ground(x - 5, x + 5, mid + k * 2.4 - 0.6, mid + k * 2.4 + 0.6, 0.14, WHITE);
    }
  // Parked planes at the gates.
  const liveries = [C('#1f6fb2'), C('#c9423a'), TEAL, GOLD];
  [-45, -15, 15, 45].forEach((x, k) => {
    if (r() < 0.85) plane(m, x, front + 58, 0.1, 30, liveries[k % liveries.length]!);
  });
  // Runway lights.
  for (let x = -W / 2 + 12; x < W / 2 - 12; x += 24) {
    m.box(x, x + 0.5, 0.1, 0.6, rz0 - 1, rz0 - 0.5, GOLD, GOLD);
    m.box(x, x + 0.5, 0.1, 0.6, rz1 + 0.5, rz1 + 1, GOLD, GOLD);
  }
}

/** Seaport (M23): warehouses on the landside, container stacks, and gantry cranes on the quay. */
function seaport(m: ModelBuilder, W: number, D: number, r: () => number): void {
  // The quay stands in the water: its walls go down to the sea bed.
  m.box(-W / 2 + 0.2, W / 2 - 0.2, -18, 0.06, -D / 2 + 0.2, D / 2 - 0.2, C('#8d8a84'), C('#c9c6bf'));
  const front = -D / 2;
  // Warehouses.
  for (const [x0, x1] of [
    [-W / 2 + 6, -W / 2 + 46],
    [-W / 2 + 50, -W / 2 + 86],
  ] as const) {
    m.box(x0, x1, 0, 10, front + 6, front + 30, C('#d7d2c8'), C('#8d6f5a'));
    m.windows('front', x0, x1, front + 6, front + 30, 0, 1, 10, {
      col: GLASS,
      lit: lit(r, 0.5),
      band: true,
      height: 1.4,
    });
  }
  // Container stacks in rows.
  const boxes = [C('#c9423a'), C('#1f6fb2'), C('#2f8f5a'), C('#e0913a'), C('#8a8f96'), C('#d9c23a')];
  for (let row = 0; row < 4; row++)
    for (let k = 0; k < 9; k++) {
      const x = -W / 2 + 96 + k * 9.5;
      if (x > W / 2 - 10) continue;
      const z = front + 8 + row * 6.5;
      const h = 1 + Math.floor(r() * 3);
      for (let t = 0; t < h; t++)
        m.box(x, x + 8.5, t * 2.6, t * 2.6 + 2.5, z, z + 5.4, boxes[Math.floor(r() * boxes.length)]!);
    }
  // Quay edge with bollards.
  m.box(-W / 2 + 0.2, W / 2 - 0.2, 0.06, 0.5, D / 2 - 2, D / 2 - 0.2, C('#e6e1d6'));
  for (let x = -W / 2 + 8; x < W / 2 - 4; x += 16) m.cylinder(x, D / 2 - 1.2, 0.4, 0.5, 1.3, STEEL_DARK, 6);
  // Gantry cranes: legs on rails along the quay, a boom reaching out over the water.
  for (const x of [-40, 20, 70]) {
    if (x > W / 2 - 12) continue;
    const zb = D / 2 - 16;
    for (const dx of [-5, 5])
      for (const z of [zb, D / 2 - 3])
        m.box(x + dx - 0.7, x + dx + 0.7, 0, 30, z - 0.7, z + 0.7, C('#3c6ea8'));
    m.box(x - 6, x + 6, 30, 33, zb - 12, D / 2 + 34, C('#3c6ea8'), C('#e0b030'));
    m.box(x - 2, x + 2, 26, 30, D / 2 + 2, D / 2 + 8, C('#e0b030'));
    m.box(x - 1.5, x + 1.5, 33, 38, zb - 11, zb - 7, STEEL_DARK);
  }
}

/** A module annex: a small wing in a back corner of the lot (one per module). */
export function moduleAnnex(m: ModelBuilder, W: number, D: number, k: number, col: Color): void {
  const w = Math.min(9, W / 3);
  const x0 = k % 2 === 0 ? W / 2 - 1 - w : -W / 2 + 1;
  const x1 = x0 + w;
  const z1 = D / 2 - 1;
  const z0 = z1 - Math.min(8, D / 3);
  m.box(x0, x1, 0, 5.5, z0, z1, col, C('#8f949a'));
  m.windows('left', x0, x1, z0, z1, 0, 1, 5.5, { col: GLASS, lit: () => 0.7, spacing: 2.5 });
  m.windows('right', x0, x1, z0, z1, 0, 1, 5.5, { col: GLASS, lit: () => 0.7, spacing: 2.5 });
  m.parapet(x0, x1, z0, z1, 5.5, col, 0.4, 0.25);
}
