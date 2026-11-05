import { Color } from 'three';
import { IN_FAR, NEAR_ONLY, SEASONAL, SURF_GRASS, SURF_HEDGE, type ModelBuilder } from './builder';

/**
 * Generated looks for the war buildings (phase 5, M34): the twelve military buildings in the
 * Military category and the nine that research and the final race bring later (M37, M40), keyed by
 * model id. Each follows its prompt in docs/models/PROMPTS-WAR.md in the game's toy style, on the
 * prompt's site, so a hand-made model and the generated look stand on the same ground; units park
 * in the same places on both (src/render/unitPoses.ts). Fine parts are marked so the distant
 * versions drop them. Local space as for every model: x along the road, the front faces −z, y up.
 */

const C = (hex: string) => new Color(hex);
const SAND = C('#dcc796');
const SAND_DARK = C('#c4ad7a');
const OLIVE = C('#a3ab72');
const OLIVE_DARK = C('#6f7a46');
const GREEN_ROOF = C('#5f8f4f');
const CONCRETE = C('#c9c6bf');
const CONCRETE_DARK = C('#a3a097');
const BUNKER = C('#b9b5aa');
const ASPHALT = C('#7f8388');
const RUNWAY = C('#5d6166');
const TAXIWAY = C('#8f9296');
const PAVING = C('#d8d2c4');
const QUAY = C('#c9c6bf');
const QUAY_WALL = C('#8d8a84');
const GRAVEL = C('#bdb6a6');
const GRASS = C('#8cc063');
const MOUND = C('#86b45c');
const HEDGE = C('#4f8f45');
SEASONAL.set(GRASS, SURF_GRASS).set(MOUND, SURF_GRASS).set(HEDGE, SURF_HEDGE);
const STONE = C('#a89c88');
const WHITE = C('#f2f4f5');
const LINE = C('#f4f1e6');
const YELLOW = C('#f0c21b');
const BLACK = C('#2b2b2e');
const RED = C('#cf4436');
const STEEL = C('#9aa0a6');
const STEEL_DARK = C('#6c737a');
const GLASS = C('#3d5a73');
const CRYSTAL = C('#9fe3ff');
const WOOD = C('#a2724a');
const TYRE = C('#34373b');
const SANDBAG = C('#cdb88a');
const EARTH = C('#9a8358');
const WATER = C('#4a9fc4');
const ROLLER = C('#e0913a');
const SIGN_BLUE = C('#2f6fb2');
const SIGN_TEAL = C('#1f9e8f');
const LAMP = C('#fff1c4');
const TRUNK = C('#6b4f36');
const LEAF = C('#5f9a45');
const WALLS = [SAND, C('#d6cfb2'), C('#cfc7a0')];
const ROOFS = [GREEN_ROOF, C('#7a8c56'), C('#5a7f6a')];

type V3 = [number, number, number];
type Win = Parameters<ModelBuilder['windows']>[8];
type Face = 'front' | 'back' | 'left' | 'right';

function lit(r: () => number, p = 0.6): (i: number) => number {
  return () => (r() < p ? 0.6 + r() * 0.4 : 0);
}

function base(m: ModelBuilder, W: number, D: number, top: Color): void {
  m.box(-W / 2 + 0.2, W / 2 - 0.2, -5, 0.06, -D / 2 + 0.2, D / 2 - 0.2, STONE, top);
}

function tree(m: ModelBuilder, x: number, z: number, s: number): void {
  m.cylinder(x, z, 0.25 * s, 0, 2 * s, TRUNK, 5);
  m.dome(x, z, 1.8 * s, 1.6 * s, LEAF, 2, 7);
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
) {
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

/** A triangle wound so its normal points along `out`. */
function tri(m: ModelBuilder, a: number[], b: number[], c: number[], out: V3, col: Color, emi = 0) {
  const ux = b[0]! - a[0]!;
  const uy = b[1]! - a[1]!;
  const uz = b[2]! - a[2]!;
  const vx = c[0]! - a[0]!;
  const vy = c[1]! - a[1]!;
  const vz = c[2]! - a[2]!;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) m.tri(a, b, c, nx, ny, nz, col, emi);
  else m.tri(a, c, b, -nx, -ny, -nz, col, emi);
}

/** A square-section beam from a to b, thickness t (cranes, pylons, conduits, frames). */
function beam(m: ModelBuilder, a: V3, b: V3, t: number, col: Color): void {
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
    face(
      m,
      add(a, o0),
      add(b, o0),
      add(b, o1),
      add(a, o1),
      [o0[0] + o1[0], o0[1] + o1[1], o0[2] + o1[2]],
      col,
    );
  }
  // End caps.
  const capA = [0, 1, 2, 3].map((k) => add(a, off(k)));
  const capB = [0, 1, 2, 3].map((k) => add(b, off(k)));
  face(m, capA[0]!, capA[1]!, capA[2]!, capA[3]!, [-n[0], -n[1], -n[2]], col);
  face(m, capB[0]!, capB[1]!, capB[2]!, capB[3]!, n, col);
}

/**
 * A curved roof (a hangar's or a dry dock's) spanning x0..x1 and running z0..z1, rising `rise` from
 * y0; its ends closed with `end` (or left open).
 */
function vault(
  m: ModelBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  rise: number,
  col: Color,
  end: { front?: Color; back?: Color } = {},
  seg = 6,
): void {
  const xm = (x0 + x1) / 2;
  const hw = (x1 - x0) / 2;
  const p = (i: number) => {
    const t = (i / seg) * Math.PI;
    return [xm - hw * Math.cos(t), y0 + rise * Math.sin(t)];
  };
  for (let i = 0; i < seg; i++) {
    const [ax, ay] = p(i);
    const [bx, by] = p(i + 1);
    const out: V3 = [(ax! + bx!) / 2 - xm, (ay! + by!) / 2 - y0 + 0.01, 0];
    face(m, [ax!, ay!, z0], [ax!, ay!, z1], [bx!, by!, z1], [bx!, by!, z0], out, col);
    if (end.front) tri(m, [xm, y0, z0], [ax!, ay!, z0], [bx!, by!, z0], [0, 0, -1], end.front);
    if (end.back) tri(m, [xm, y0, z1], [ax!, ay!, z1], [bx!, by!, z1], [0, 0, 1], end.back);
  }
}

/** A horizontal tube along z (a wind tunnel, a fuel tank on its side), with closed ends. */
function tubeZ(
  m: ModelBuilder,
  x: number,
  y: number,
  z0: number,
  z1: number,
  r: number,
  col: Color,
  sides = 10,
) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * r, y + Math.sin(a0) * r];
    const p1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r];
    const mid = (a0 + a1) / 2;
    face(
      m,
      [p0[0]!, p0[1]!, z0],
      [p0[0]!, p0[1]!, z1],
      [p1[0]!, p1[1]!, z1],
      [p1[0]!, p1[1]!, z0],
      [Math.cos(mid), Math.sin(mid), 0],
      col,
    );
    tri(m, [x, y, z0], [p0[0]!, p0[1]!, z0], [p1[0]!, p1[1]!, z0], [0, 0, -1], col);
    tri(m, [x, y, z1], [p0[0]!, p0[1]!, z1], [p1[0]!, p1[1]!, z1], [0, 0, 1], col);
  }
}

/** A grassy mound with sloping sides and a flat top. */
function mound(
  m: ModelBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  h: number,
  inset: number,
  col = MOUND,
) {
  m.mansard(x0, x1, z0, z1, 0.02, h, inset, col);
}

/** A dish on a stub, facing `yaw` (0: towards −z) and tipped up by `tilt` (radians). */
function dish(
  m: ModelBuilder,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  yaw: number,
  tilt: number,
  col: Color,
  back = STEEL_DARK,
) {
  // The dish's axis (where it looks) and two directions across its face.
  const n: V3 = [-Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt)];
  const u: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const v: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const sides = 10;
  const depth = r * 0.3;
  const at = (k: number, rr: number, d: number): number[] => {
    const a = (k / sides) * Math.PI * 2;
    return [
      cx + (Math.cos(a) * u[0] + Math.sin(a) * v[0]) * rr + n[0] * d,
      cy + (Math.cos(a) * u[1] + Math.sin(a) * v[1]) * rr + n[1] * d,
      cz + (Math.cos(a) * u[2] + Math.sin(a) * v[2]) * rr + n[2] * d,
    ];
  };
  const centre = [cx, cy, cz];
  const rear = [cx - n[0] * depth * 0.6, cy - n[1] * depth * 0.6, cz - n[2] * depth * 0.6];
  for (let k = 0; k < sides; k++) {
    // The bowl (facing out along n) and its back.
    tri(m, centre, at(k, r, depth), at(k + 1, r, depth), n, col);
    tri(m, rear, at(k, r, depth), at(k + 1, r, depth), [-n[0], -n[1], -n[2]], back);
  }
  // The feed: a chunky block standing out in front of the bowl.
  m.detail(IN_FAR, () =>
    beam(m, [cx, cy, cz], [cx + n[0] * r * 0.8, cy + n[1] * r * 0.8, cz + n[2] * r * 0.8], 0.45, back),
  );
}

/** A faceted crystal (two pyramids base to base), glowing at night. */
function crystal(m: ModelBuilder, x: number, y: number, z: number, r: number, h: number, sides = 6): void {
  const ring = (k: number) => {
    const a = (k / sides) * Math.PI * 2 + 0.3;
    return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  };
  for (let k = 0; k < sides; k++) {
    const a = ring(k);
    const b = ring(k + 1);
    const mid = ((k + 0.5) / sides) * Math.PI * 2 + 0.3;
    const out: V3 = [Math.cos(mid), 0.6, Math.sin(mid)];
    tri(m, a, b, [x, y + h, z], out, CRYSTAL, 0.9);
    tri(m, a, b, [x, y - h * 0.6, z], [out[0], -0.6, out[2]], CRYSTAL, 0.9);
  }
}

/** Yellow-and-black hazard stripes on a −z facing face at z, from x0 to x1 and y0 to y1. */
function hazard(m: ModelBuilder, x0: number, x1: number, y0: number, y1: number, z: number, n = 6): void {
  const w = (x1 - x0) / n;
  for (let k = 0; k < n; k++)
    m.box(x0 + k * w, x0 + (k + 1) * w, y0, y1, z - 0.12, z, k % 2 ? BLACK : YELLOW);
}

/** A row of sandbags (rounded tan blocks) from a to b on the ground. */
function sandbags(m: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 1.1): void {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / 1.6));
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    m.box(x - 0.85, x + 0.85, 0, h * 0.55, z - 0.6, z + 0.6, SANDBAG, C('#d8c69a'));
    m.detail(IN_FAR, () => m.box(x - 0.6, x + 0.6, h * 0.55, h, z - 0.5, z + 0.5, SANDBAG, C('#d8c69a')));
  }
}

/** A ring of sandbags round (x, z). */
function sandbagRing(m: ModelBuilder, x: number, z: number, r: number, gap = -1, h = 1.2): void {
  const n = Math.max(8, Math.round((Math.PI * 2 * r) / 1.7));
  for (let k = 0; k < n; k++) {
    if (gap >= 0 && Math.abs(((k / n + 0.25 - gap / (Math.PI * 2) + 1.5) % 1) - 0.5) < 0.05) continue;
    const a = (k / n) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    m.box(px - 0.8, px + 0.8, 0, h, pz - 0.8, pz + 0.8, SANDBAG, C('#d8c69a'));
  }
}

/** A striped barrier arm across the gate from x0 to x1 at z, on a post at x1. */
function barrier(m: ModelBuilder, x0: number, x1: number, z: number): void {
  m.detail(IN_FAR, () => {
    m.box(x1 - 0.25, x1 + 0.25, 0, 1.35, z - 0.25, z + 0.25, WHITE);
    const n = 8;
    const w = (x1 - x0) / n;
    for (let k = 0; k < n; k++)
      m.box(x0 + k * w, x0 + (k + 1) * w, 0.85, 1.3, z - 0.2, z + 0.2, k % 2 ? WHITE : RED);
  });
  m.detail(NEAR_ONLY, () => m.box(x0 - 0.25, x0 + 0.25, 0, 0.85, z - 0.25, z + 0.25, WHITE));
}

/** A flat block with windows on every face and a parapet. */
function block(
  m: ModelBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  floors: number,
  fh: number,
  wall: Color,
  roof: Color,
  win: Win,
  faces: readonly Face[] = ['front', 'back', 'left', 'right'],
): number {
  const h = floors * fh;
  m.box(x0, x1, 0, h, z0, z1, wall, roof);
  for (const f of faces) m.windows(f, x0, x1, z0, z1, 0, floors, fh, win);
  m.detail(IN_FAR, () => m.parapet(x0, x1, z0, z1, h, wall, 0.6, 0.35));
  return h;
}

/** A gatehouse at the road with a sign panel, and a striped barrier across the way in. */
function gatehouse(m: ModelBuilder, x: number, z: number, armTo: number, sign: Color): void {
  m.box(x - 2, x + 2, 0, 3.2, z - 1.6, z + 1.6, CONCRETE, CONCRETE_DARK);
  m.box(x - 2.35, x + 2.35, 3.2, 3.5, z - 1.95, z + 1.95, WHITE);
  m.windows('front', x - 2, x + 2, z - 1.6, z + 1.6, 0, 1, 3.2, { col: GLASS, lit: () => 0.8, width: 1.8 });
  m.detail(IN_FAR, () => m.box(x - 1.2, x + 1.2, 2.35, 2.95, z - 1.75, z - 1.6, sign));
  barrier(m, armTo, x - 2.3, z + 0.8);
}

/** Painted lines on the ground: a rectangle outline. */
function outline(
  m: ModelBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  col: Color,
  t = 0.3,
) {
  m.ground(x0, x1, z0, z0 + t, y, col);
  m.ground(x0, x1, z1 - t, z1, y, col);
  m.ground(x0, x0 + t, z0 + t, z1 - t, y, col);
  m.ground(x1 - t, x1, z0 + t, z1 - t, y, col);
}

/** A flat H on a pad (helipads), centred at (x, z). */
function helipad(m: ModelBuilder, x: number, z: number, y: number, r: number): void {
  m.cylinder(x, z, r, y, y + 0.04, ASPHALT, 16, C('#5b5f64'));
  m.detail(IN_FAR, () => {
    const s = r * 0.5;
    m.ground(x - s, x - s * 0.6, z - s, z + s, y + 0.06, LINE);
    m.ground(x + s * 0.6, x + s, z - s, z + s, y + 0.06, LINE);
    m.ground(x - s * 0.6, x + s * 0.6, z - s * 0.12, z + s * 0.12, y + 0.06, LINE);
  });
}

// ------------------------------------------------------------------ W1: military buildings

function militaryhq(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, PAVING);
  const wall = r() < 0.5 ? SAND : OLIVE;
  const x0 = -16;
  const x1 = 16;
  const z0 = -D / 2 + 6;
  const z1 = 2;
  const fh = 3.6;
  const top = block(m, x0, x1, z0, z1, 3, fh, wall, CONCRETE_DARK, {
    col: GLASS,
    lit: lit(r, 0.7),
    spacing: 2.6,
  });
  // A bold entrance: a deep canopy on chunky columns, and the doors under it.
  m.box(-6, 6, 4.6, 5.4, z0 - 4.6, z0, WHITE, SAND_DARK);
  for (const x of [-5.2, -1.8, 1.8, 5.2]) m.cylinder(x, z0 - 3.9, 0.55, 0, 4.6, WHITE, 8);
  m.box(-2.4, 2.4, 0, 3.2, z0 - 0.15, z0, C('#3a5a7a'));
  m.detail(IN_FAR, () => {
    m.box(-8, -6.6, 6.5, 9.5, z0 - 0.2, z0, SIGN_BLUE);
    m.box(6.6, 8, 6.5, 9.5, z0 - 0.2, z0, RED);
  });
  // The big round radar dome on the roof, and a helipad beside it.
  m.cylinder(-8, -4, 4.4, top, top + 1.4, CONCRETE, 12);
  m.dome(-8, -4, 4.2, top + 1.4, WHITE, 4, 14);
  helipad(m, 8, -4, top + 0.05, 5.2);
  m.detail(IN_FAR, () => m.box(-1, 2, top, top + 1.4, -1, 1, STEEL));
  // The walled courtyard behind: lawns, paths and trees.
  m.ground(-W / 2 + 1, W / 2 - 1, z1, D / 2 - 1, 0.08, GRASS);
  m.ground(-1.4, 1.4, z1, D / 2 - 2, 0.1, PAVING);
  m.ground(-W / 2 + 3, W / 2 - 3, 10, 12.4, 0.1, PAVING);
  const wt = 0.6;
  m.box(-W / 2 + 0.4, W / 2 - 0.4, 0, 2.4, D / 2 - 0.4 - wt, D / 2 - 0.4, wall, CONCRETE);
  m.box(-W / 2 + 0.4, -W / 2 + 0.4 + wt, 0, 2.4, z1, D / 2 - 0.4, wall, CONCRETE);
  m.box(W / 2 - 0.4 - wt, W / 2 - 0.4, 0, 2.4, z1, D / 2 - 0.4, wall, CONCRETE);
  for (const [x, z] of [
    [-12, 6],
    [12, 6],
    [-12, 15.5],
    [12, 15.5],
    [-5, 16],
    [5, 16],
  ] as const)
    m.detail(IN_FAR, () => tree(m, x, z, 1.4 + r() * 0.4));
  m.detail(NEAR_ONLY, () => {
    // Flagless masts are thin; a row of planters along the front instead.
    for (const x of [-14, -10, 10, 14]) m.box(x - 1, x + 1, 0, 0.6, -D / 2 + 1.4, -D / 2 + 2.6, HEDGE);
  });
}

function barracks(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, GRASS);
  // The parade square and the paving round it, with painted lines.
  m.ground(-8.6, W / 2 - 0.6, -D / 2 + 0.4, 15.4, 0.08, PAVING);
  m.detail(IN_FAR, () => {
    outline(m, -7.2, 7.2, -10.5, 6.8, 0.1, LINE, 0.25);
    for (const z of [-6.2, -1.85, 2.5]) m.ground(-7.2, 7.2, z - 0.12, z + 0.12, 0.1, LINE);
  });
  const wall = WALLS[Math.floor(r() * WALLS.length)]!;
  const roof = ROOFS[Math.floor(r() * ROOFS.length)]!;
  // Two long two-storey bunk blocks framing the square, with green roofs.
  for (const [x0, x1] of [
    [-19.4, -8.6],
    [8.6, 19.4],
  ] as const) {
    m.box(x0, x1, 0, 6.3, -14.5, 8.5, wall, wall);
    for (const f of ['front', 'back', 'left', 'right'] as const)
      m.windows(f, x0, x1, -14.5, 8.5, 0, 2, 3.15, { col: GLASS, lit: lit(r, 0.65), spacing: 2.6 });
    m.gable(x0, x1, -14.5, 8.5, 6.3, 2.6, roof, wall, false, 0.4);
    // Doors onto the square, under small awnings.
    const inner = x0 < 0 ? x1 : x0;
    const out = x0 < 0 ? 1 : -1;
    for (const z of [-8.8, 2.8]) {
      m.box(
        inner - (out < 0 ? 0.12 : 0),
        inner + (out > 0 ? 0.12 : 0),
        0,
        2.5,
        z - 0.8,
        z + 0.8,
        C('#7a5a3c'),
      );
      m.detail(IN_FAR, () =>
        m.box(
          Math.min(inner, inner + out * 1.2),
          Math.max(inner, inner + out * 1.2),
          2.75,
          2.95,
          z - 1.3,
          z + 1.3,
          RED,
        ),
      );
    }
  }
  // The gatehouse and its barrier at the road.
  gatehouse(m, 5.4, -13.8, -3.3, SIGN_TEAL);
  // A small mess hall at the back, and the obstacle course beside it.
  m.box(1.5, 19.4, 0, 3.6, 10, 15.4, C('#e9e1cc'), C('#e9e1cc'));
  m.windows('front', 1.5, 19.4, 10, 15.4, 0, 1, 3.6, { col: GLASS, lit: lit(r, 0.7), spacing: 2.8 });
  m.windows('back', 1.5, 19.4, 10, 15.4, 0, 1, 3.6, { col: GLASS, lit: lit(r, 0.7), spacing: 2.8 });
  m.gable(1.5, 19.4, 10, 15.4, 3.6, 1.8, roof, C('#e9e1cc'), true, 0.4);
  m.detail(IN_FAR, () => {
    m.box(-17.6, -14.6, 0, 2.2, 11, 11.45, WOOD);
    m.box(-12.6, -9.6, 0, 1.6, 13.4, 13.85, WOOD);
    m.box(-17.6, -14.6, 0, 1, 14.4, 14.85, WOOD);
  });
  m.detail(NEAR_ONLY, () => {
    // A climbing frame of thick beams, and stacks of tyres.
    for (const x of [-6.5, -3.5])
      for (const z of [11, 14]) m.box(x - 0.2, x + 0.2, 0, 3, z - 0.2, z + 0.2, WOOD);
    m.box(-6.7, -3.3, 2.8, 3.2, 10.8, 14.2, WOOD);
    m.box(-6.7, -3.3, 1.5, 1.8, 10.8, 11.2, WOOD);
    for (const [x, z] of [
      [-19, 12.3],
      [-11.2, 15.3],
      [-8.2, 12],
    ] as const)
      for (let k = 0; k < 3; k++) m.cylinder(x, z, 0.55, k * 0.3, k * 0.3 + 0.28, TYRE, 8);
  });
  m.detail(IN_FAR, () => {
    m.box(-19.6, -3.6, 0, 1.05, -15.8, -15, HEDGE);
    m.box(8.3, 19.6, 0, 1.05, -15.8, -15, HEDGE);
  });
}

function shelter(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, GRASS);
  // A grassy mound over most of the site, two vents on top.
  mound(m, -W / 2 + 0.8, W / 2 - 0.8, -D / 2 + 4.4, D / 2 - 0.8, 3, 3.4);
  for (const x of [-2.6, 2.6]) {
    m.cylinder(x, 3, 0.75, 2.5, 4.6, CONCRETE, 8);
    m.detail(IN_FAR, () => m.cylinder(x, 3, 1, 4.6, 4.95, CONCRETE_DARK, 8));
  }
  // The concrete entrance block on the road side, with a heavy striped door.
  const zf = -D / 2 + 3.6;
  m.box(-3, 3, 0, 2.8, zf, zf + 3.4, CONCRETE, CONCRETE_DARK);
  m.box(-1.2, 1.2, 0.06, 2.2, zf - 0.12, zf, C('#5b6168'));
  m.detail(IN_FAR, () => {
    hazard(m, -2.4, 2.4, 2.25, 2.6, zf, 6);
    m.box(-2.4, -1.4, 0.06, 2.25, zf - 0.12, zf, YELLOW);
    m.box(1.4, 2.4, 0.06, 2.25, zf - 0.12, zf, BLACK);
  });
  m.ground(-1.4, 1.4, -D / 2 + 0.2, zf, 0.1, PAVING);
}

function bunker(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, GRASS);
  // A grassy earth bank the bunker sits half sunk into.
  mound(m, -W / 2 + 0.6, W / 2 - 0.6, -D / 2 + 0.6, D / 2 - 0.6, 1.3, 2.2);
  // The thick block with rounded corners.
  const hw = 4.4;
  const y1 = 2.3;
  m.box(-hw, hw, 0, y1, -hw + 1.1, hw - 1.1, BUNKER, CONCRETE);
  m.box(-hw + 1.1, hw - 1.1, 0, y1, -hw, hw, BUNKER, CONCRETE);
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    m.cylinder(x * (hw - 1.1), z * (hw - 1.1), 1.1, 0, y1, BUNKER, 8, CONCRETE);
  m.box(-hw + 0.4, hw - 0.4, y1, y1 + 0.4, -hw + 0.4, hw - 0.4, CONCRETE_DARK);
  // Narrow dark firing slots, front and sides.
  for (const x of [-2.2, 0, 2.2]) m.box(x - 0.8, x + 0.8, 1.35, 1.75, -hw - 0.06, -hw, C('#1e2328'));
  for (const s of [-1, 1])
    m.box(s * hw - (s > 0 ? 0 : 0.06), s * hw + (s > 0 ? 0.06 : 0), 1.35, 1.75, -1, 1, C('#1e2328'));
  // A steel door at the back.
  m.box(-0.9, 0.9, 0, 2.1, hw, hw + 0.1, C('#5b6168'));
  // Sandbag walls round the front.
  sandbags(m, -6.5, -6.6, 6.5, -6.6);
  sandbags(m, -6.8, -5.4, -6.8, 1);
  sandbags(m, 6.8, -5.4, 6.8, 1);
}

function vehicledepot(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, ASPHALT);
  // The workshop hall: three wide roller doors on the road.
  const wall = r() < 0.5 ? C('#d9d4c4') : C('#cfd3d1');
  m.box(-23.4, 4.6, 0, 8, -9, 11, wall, wall);
  m.gable(-23.4, 4.6, -9, 11, 8, 2.3, C('#7d8c6a'), wall, true, 0.4);
  for (const x of [-17.4, -9.4, -1.4]) {
    m.box(x - 2.9, x + 2.9, 0.06, 5.06, -9.12, -9, ROLLER);
    m.detail(IN_FAR, () => m.box(x - 3.2, x + 3.2, 5.06, 5.4, -9.1, -9, CONCRETE_DARK));
  }
  m.windows('front', -23.4, 4.6, -9, 11, 5.6, 1, 2.4, { col: GLASS, lit: lit(r, 0.6), spacing: 3 });
  for (const f of ['left', 'right', 'back'] as const)
    m.windows(f, -23.4, 4.6, -9, 11, 0, 2, 4, { col: GLASS, lit: lit(r, 0.6), spacing: 3.5 });
  m.detail(IN_FAR, () => m.box(-11.2, -7.6, 6.4, 7.6, -9.15, -9, SIGN_TEAL));
  // The assembly shed beside it.
  m.box(8, 22, 0, 5.5, -3, 10, C('#e2d6b8'), C('#e2d6b8'));
  m.gable(8, 22, -3, 10, 5.5, 2, C('#7d8c6a'), C('#e2d6b8'), true, 0.4);
  m.box(12.5, 17.5, 0.06, 4.36, -3.12, -3, ROLLER);
  m.windows('right', 8, 22, -3, 10, 0, 1, 5.5, { col: GLASS, lit: lit(r, 0.6), spacing: 3 });
  // A fuel canopy over two chunky pumps.
  m.box(10, 20, 4.6, 5.4, -16.6, -10.4, WHITE, C('#c3c9cf'));
  m.detail(IN_FAR, () => m.box(10, 20, 4.6, 5.4, -16.65, -16.6, RED));
  for (const x of [11.2, 18.8]) m.box(x - 0.3, x + 0.3, 0, 4.6, -13.8, -13.2, WHITE);
  m.detail(NEAR_ONLY, () => {
    m.box(10.6, 19.4, 0.06, 0.26, -14.1, -12.9, CONCRETE);
    for (const x of [13.4, 16.6]) m.box(x - 0.5, x + 0.5, 0.26, 2.1, -13.9, -13.1, YELLOW);
  });
  // The test pad at the back under a gantry crane of thick beams; parking bays beside it.
  m.ground(-22.6, -5.4, 12.2, 19.4, 0.08, PAVING);
  m.detail(IN_FAR, () => {
    outline(m, -20.4, -7.6, 13.6, 17.8, 0.1, YELLOW, 0.3);
    for (let x = -3.1; x <= 21.2; x += 4) m.ground(x - 0.12, x + 0.12, 12.4, 19.1, 0.1, LINE);
  });
  for (const x of [-20.9, -7.1]) {
    m.box(x - 0.3, x + 0.3, 0, 7.4, 12.6, 13.2, YELLOW);
    m.box(x - 0.3, x + 0.3, 0, 7.4, 18.2, 18.8, YELLOW);
    m.box(x - 0.3, x + 0.3, 7.4, 8.2, 12.6, 18.8, YELLOW);
  }
  m.box(-20.6, -7.4, 7.5, 8.2, 13.3, 14, YELLOW);
  m.box(-20.6, -7.4, 7.5, 8.2, 17.5, 18.2, YELLOW);
  m.detail(IN_FAR, () => m.box(-15.4, -12.8, 8.2, 9, 13.1, 18.4, STEEL_DARK));
  m.detail(NEAR_ONLY, () => m.box(-14.6, -13.6, 6.2, 8.2, 15.3, 16.6, STEEL_DARK));
  m.detail(IN_FAR, () => {
    tree(m, -21.4, -17.6, 1.2);
    tree(m, 21.4, -17.6, 1.2);
    m.box(-19.6, -16.2, 0, 1, -19.9, -19.1, HEDGE);
  });
}

function airfield(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, GRASS);
  // The runway along the back, the taxiway in front of it, and the apron.
  m.ground(-W / 2 + 0.2, W / 2 - 0.2, 24, 38, 0.08, RUNWAY);
  m.ground(-90, 90, 13, 24, 0.08, TAXIWAY);
  m.ground(-W / 2 + 0.2, W / 2 - 0.2, -8, 13, 0.08, PAVING);
  m.detail(IN_FAR, () => {
    for (let x = -80; x < 80; x += 16) m.ground(x, x + 8, 30.6, 31.4, 0.11, LINE);
    for (const end of [-1, 1])
      for (let k = -2; k <= 2; k++) {
        const x = end * (W / 2 - 8);
        m.ground(x - 4, x + 4, 31 + k * 2.4 - 0.5, 31 + k * 2.4 + 0.5, 0.11, LINE);
      }
    m.ground(-88, 88, 18.3, 18.7, 0.1, YELLOW);
    for (const x of [-61, -25, 11]) m.ground(x - 0.2, x + 0.2, -7.5, 18.3, 0.1, YELLOW);
  });
  m.detail(NEAR_ONLY, () => {
    for (let x = -W / 2 + 6; x < W / 2 - 4; x += 20) {
      m.box(x, x + 0.5, 0.08, 0.5, 23.2, 23.7, LAMP, LAMP);
      m.box(x, x + 0.5, 0.08, 0.5, 38.3, 38.8, LAMP, LAMP);
    }
  });
  // Three curved-roof hangars opening onto the apron.
  const roof = r() < 0.5 ? C('#9aa3a8') : C('#8f9a7a');
  for (const [x0, x1] of [
    [-76, -46],
    [-40, -10],
    [-4, 26],
  ] as const) {
    m.box(x0, x1, 0, 5.5, -34, -33.4, C('#d8d4c8'));
    m.box(x0, x0 + 0.6, 0, 5.5, -34, -8, C('#d8d4c8'));
    m.box(x1 - 0.6, x1, 0, 5.5, -34, -8, C('#d8d4c8'));
    // Closed at the road end; open onto the apron, dark inside, the doors pushed back to the sides.
    vault(m, x0, x1, -34, -8, 5.5, 5.5, roof, { front: C('#d8d4c8'), back: C('#3a3f45') });
    m.box(x0 + 0.6, x1 - 0.6, 0.06, 5.5, -8.1, -8, C('#3a3f45'));
    m.box(x0 + 0.6, x0 + 4.4, 0.06, 5.3, -8, -7.7, ROLLER);
    m.box(x1 - 4.4, x1 - 0.6, 0.06, 5.3, -8, -7.7, ROLLER);
    m.detail(IN_FAR, () => m.box((x0 + x1) / 2 - 1.8, (x0 + x1) / 2 + 1.8, 7.9, 9.1, -34.15, -34, SIGN_BLUE));
  }
  // The control tower, operations block, crew building and gatehouse at the road.
  m.box(60, 65, 0, 15, -19, -14, C('#e8e4da'), C('#e8e4da'));
  m.box(59, 66, 15, 15.5, -20, -13, WHITE);
  m.box(59.5, 65.5, 15.5, 18.3, -19.5, -13.5, GLASS);
  m.box(58.8, 66.2, 18.3, 18.75, -20.2, -12.8, STEEL_DARK);
  for (const f of ['front', 'back', 'left', 'right'] as const)
    m.windows(f, 59.5, 65.5, -19.5, -13.5, 15.5, 1, 2.8, {
      col: C('#9fcbe0'),
      lit: () => 0.9,
      band: true,
      height: 2.2,
    });
  block(m, 42, 56, -22, -12, 2, 3.7, C('#e2d6b8'), CONCRETE_DARK, {
    col: GLASS,
    lit: lit(r, 0.6),
    spacing: 2.8,
  });
  m.box(50, 74, 0, 6.6, -38.5, -29.5, C('#dcc796'), C('#dcc796'));
  for (const f of ['front', 'back'] as const)
    m.windows(f, 50, 74, -38.5, -29.5, 0, 2, 3.3, { col: GLASS, lit: lit(r, 0.6), spacing: 2.8 });
  m.gable(50, 74, -38.5, -29.5, 6.6, 2.4, GREEN_ROOF, C('#dcc796'), true, 0.4);
  gatehouse(m, 42, -36.8, 31.6, SIGN_TEAL);
  // A helipad on the apron.
  helipad(m, 60, 2, 0.09, 7.2);
  // The fuel farm: round tanks inside a low bund.
  m.box(-98.6, -79.4, 0, 0.9, -32.6, -32.2, CONCRETE_DARK);
  m.box(-98.6, -79.4, 0, 0.9, -13.8, -13.4, CONCRETE_DARK);
  m.box(-98.6, -98.2, 0, 0.9, -32.2, -13.8, CONCRETE_DARK);
  m.box(-79.8, -79.4, 0, 0.9, -32.2, -13.8, CONCRETE_DARK);
  for (const [x, z] of [
    [-93, -27.5],
    [-85, -27.5],
    [-93, -18.5],
    [-85, -18.5],
  ] as const) {
    m.cylinder(x, z, 3.4, 0, 5.2, WHITE, 12, C('#dfe3e6'));
    m.detail(IN_FAR, () => m.cylinder(x, z, 3.45, 3.6, 4.1, RED, 12));
  }
  m.ground(-W / 2 + 4, 36, -38.5, -35, 0.08, ASPHALT);
}

function navalyard(m: ModelBuilder, W: number, D: number, r: () => number): void {
  // The quay stands in deep water: its walls go down to the sea bed (deeper than the prompt's 8 m,
  // since the site may stand high above the water on a steep shore). The dry dock's basin is drawn
  // on the quay (water inside a raised kerb), so the ground under the site can't hide it.
  const dx0 = -46;
  const dx1 = -30;
  const dz = 0;
  m.box(-W / 2 + 0.2, W / 2 - 0.2, -24, 0.06, -D / 2 + 0.2, D / 2, QUAY_WALL, PAVING);
  m.ground(dx0, dx1, dz, D / 2, 0.1, WATER);
  m.box(dx0 - 1.2, dx0, 0.06, 0.7, dz, D / 2, CONCRETE);
  m.box(dx1, dx1 + 1.2, 0.06, 0.7, dz, D / 2, CONCRETE);
  m.box(dx0 - 1.2, dx1 + 1.2, 0.06, 0.7, dz - 1.2, dz, CONCRETE);
  // The quay deck along the back, with its edge line and bollards.
  m.ground(-W / 2 + 0.2, dx0, 16, D / 2, 0.08, QUAY);
  m.ground(dx1, W / 2 - 0.2, 16, D / 2, 0.08, QUAY);
  m.detail(IN_FAR, () => {
    m.ground(-W / 2 + 0.2, dx0, D / 2 - 1.8, D / 2 - 1.5, 0.1, YELLOW);
    m.ground(dx1, W / 2 - 0.2, D / 2 - 1.8, D / 2 - 1.5, 0.1, YELLOW);
  });
  m.detail(NEAR_ONLY, () => {
    for (const x of [-56, -20, -4, 12, 28, 44, 56]) m.cylinder(x, D / 2 - 0.8, 0.4, 0.08, 0.9, STEEL_DARK, 6);
  });
  // The covered dry dock: side walls and a curved roof, open at the back to the water.
  const roof = C('#8f9a9e');
  m.box(-51, -50.4, 0, 7, -1.5, D / 2, C('#d8d4c8'));
  m.box(-25.6, -25, 0, 7, -1.5, D / 2, C('#d8d4c8'));
  m.box(-50.4, -25.6, 0, 7, -1.5, -0.9, C('#d8d4c8'));
  vault(m, -51, -25, -1.5, D / 2, 7, 6, roof, { front: C('#d8d4c8') });
  m.detail(IN_FAR, () => m.box(-40, -36, 8.8, 10, -1.65, -1.5, SIGN_BLUE));
  // The crane: a portal on the quay, a tower, and a jib of chunky beams over the water's edge.
  for (const x of [3, 9]) for (const z of [21, 27]) m.box(x - 0.5, x + 0.5, 0, 7, z - 0.5, z + 0.5, YELLOW);
  m.box(2.5, 9.5, 7, 8.4, 20.5, 27.5, YELLOW);
  m.box(4.6, 7.4, 8.4, 24, 22.6, 25.4, YELLOW);
  m.box(3.8, 8.2, 24, 25.4, 21.8, 26.2, STEEL_DARK);
  m.box(-3, 28, 25.4, 27, 23.2, 24.8, YELLOW);
  m.box(-3, 0.5, 22.4, 25.4, 22.7, 25.3, STEEL_DARK);
  m.box(8.2, 10.8, 23, 25.4, 22.8, 25.2, WHITE);
  m.detail(IN_FAR, () => m.box(21, 23, 24.6, 25.4, 23, 25, STEEL_DARK));
  m.detail(NEAR_ONLY, () => m.box(21.4, 22.6, 23.2, 24.6, 23.4, 24.6, YELLOW));
  // The workshop hall and the office at the road.
  const wall = r() < 0.5 ? C('#d9d4c4') : C('#d6cfb2');
  m.box(-20, 34, 0, 9, -14, 4, wall, wall);
  m.gable(-20, 34, -14, 4, 9, 2.3, C('#5a7f8a'), wall, true, 0.4);
  for (const x of [-4, 18]) {
    m.box(x - 2.8, x + 2.8, 0.06, 4.66, -14.12, -14, ROLLER);
    m.box(x - 2.8, x + 2.8, 0.06, 4.66, 4, 4.12, ROLLER);
  }
  m.windows('front', -20, 34, -14, 4, 5.8, 1, 3, { col: GLASS, lit: lit(r, 0.6), spacing: 3.2 });
  m.windows('back', -20, 34, -14, 4, 5.8, 1, 3, { col: GLASS, lit: lit(r, 0.6), spacing: 3.2 });
  block(m, -12, 18, -29, -19, 2, 3.7, C('#e8e4da'), CONCRETE_DARK, {
    col: GLASS,
    lit: lit(r, 0.65),
    spacing: 2.8,
  });
  m.detail(IN_FAR, () => {
    m.box(1, 5, 2.7, 2.92, -30.4, -29, SIGN_BLUE);
    m.box(1.4, 4.6, 3, 3.55, -29.12, -29, SIGN_BLUE);
  });
  // Stacks of crates between the hall and the quay.
  const crates = [C('#7d8a4a'), C('#a2724a'), C('#5f7f8f'), C('#b8863a')];
  for (let k = 0; k < 8; k++) {
    const x = 38 + (k % 4) * 5;
    const z = 6 + Math.floor(k / 4) * 5;
    const h = 1 + Math.floor(r() * 3);
    for (let t = 0; t < h; t++)
      m.box(x, x + 4, t * 1.6, t * 1.6 + 1.5, z, z + 3.6, crates[(k + t) % crates.length]!);
  }
  m.detail(IN_FAR, () => {
    for (const x of [-55, -46, -37, -28]) tree(m, x, x % 2 ? -24 : -27.5, 1.3);
  });
}

// ------------------------------------------------------------------ W2: defences and support

function radar(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, GRAVEL);
  // A small operations building at the front.
  block(m, -10.5, -1.5, -D / 2 + 1.5, -3.5, 1, 4, C('#e8e4da'), CONCRETE_DARK, {
    col: GLASS,
    lit: lit(r, 0.7),
    spacing: 2.6,
  });
  m.detail(IN_FAR, () => m.box(-7.6, -4.4, 2.6, 3.4, -D / 2 + 1.35, -D / 2 + 1.5, SIGN_BLUE));
  // The main tower of stacked solid blocks, the big dish on top.
  const tx = 5;
  const tz = 2;
  m.box(tx - 3, tx + 3, 0, 6, tz - 3, tz + 3, CONCRETE, CONCRETE_DARK);
  m.box(tx - 2.4, tx + 2.4, 6, 11.5, tz - 2.4, tz + 2.4, WHITE, CONCRETE_DARK);
  m.box(tx - 1.8, tx + 1.8, 11.5, 16, tz - 1.8, tz + 1.8, CONCRETE, CONCRETE_DARK);
  m.cylinder(tx, tz, 1.2, 16, 17.2, STEEL_DARK, 8);
  dish(m, tx, 19.6, tz, 4.2, 0.4, 0.45, WHITE);
  // The white radome ball on a lower tower.
  const bx = -6;
  const bz = 6;
  m.box(bx - 2, bx + 2, 0, 7, bz - 2, bz + 2, CONCRETE, CONCRETE_DARK);
  m.frustum(bx, bz, 2.6, 3.6, 7, 8.6, WHITE, 12, false);
  m.dome(bx, bz, 3.6, 8.6, WHITE, 3, 12);
  m.detail(NEAR_ONLY, () => {
    for (const [x, z] of [
      [-W / 2 + 1, -D / 2 + 1],
      [W / 2 - 1, D / 2 - 1],
    ] as const)
      m.box(x - 0.4, x + 0.4, 0, 2.5, z - 0.4, z + 0.4, STEEL);
  });
}

/** A twin gun on a turning base inside a ring of sandbags (anti-air). */
function antiair(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, GRAVEL);
  const cx = -1;
  const cz = 0.5;
  sandbagRing(m, cx, cz, 5, -Math.PI / 2);
  m.cylinder(cx, cz, 1.8, 0, 0.8, STEEL_DARK, 10);
  m.box(cx - 1.4, cx + 1.4, 0.8, 2.6, cz - 1.2, cz + 1.6, OLIVE_DARK, OLIVE);
  // Twin barrels raised towards the sky, forward.
  for (const dx of [-0.6, 0.6]) {
    beam(m, [cx + dx, 2.1, cz - 0.6], [cx + dx, 6.2, cz - 4.2], 0.38, STEEL_DARK);
    m.detail(NEAR_ONLY, () => beam(m, [cx + dx, 6.0, cz - 4.0], [cx + dx, 6.45, cz - 4.4], 0.5, BLACK));
  }
  // The ammunition hut.
  m.box(4.2, 7.4, 0, 2.6, 3.6, 7.4, OLIVE, OLIVE_DARK);
  m.box(5.2, 6.4, 0.06, 2.1, 3.48, 3.6, C('#5b6168'));
  m.detail(IN_FAR, () => hazard(m, 4.4, 7.2, 2.2, 2.5, 3.6, 4));
}

/** A big gun facing the sea at the back, a quay dropping into the water (coastal gun). */
function coastalgun(m: ModelBuilder, W: number, D: number): void {
  // The stone quay at the back drops 3 m into the water.
  m.box(-W / 2 + 0.2, W / 2 - 0.2, -3.5, 0.06, -D / 2 + 0.2, D / 2, QUAY_WALL, PAVING);
  m.ground(-W / 2 + 0.2, W / 2 - 0.2, D / 2 - 5, D / 2, 0.08, QUAY);
  // The gun house: a concrete block with a rounded front facing the water.
  const gz = 1.5;
  m.box(-5, 5, 0, 3.4, gz - 4.5, gz, CONCRETE, CONCRETE_DARK);
  m.cylinder(0, gz, 5, 0, 3.4, CONCRETE, 12, CONCRETE_DARK);
  m.box(-1, 1, 0.06, 2.2, gz - 4.62, gz - 4.5, C('#5b6168'));
  // The turret and its big barrel, pointing out to sea.
  m.cylinder(0, gz, 2.6, 3.4, 4.4, STEEL_DARK, 10);
  m.box(-1.9, 1.9, 4.4, 6.2, gz - 2.2, gz + 2.2, OLIVE, OLIVE_DARK);
  beam(m, [0, 5.2, gz + 2], [0, 5.9, D / 2 - 0.4], 0.8, STEEL_DARK);
  m.detail(NEAR_ONLY, () => beam(m, [0, 5.85, D / 2 - 0.9], [0, 5.92, D / 2 - 0.25], 1.05, BLACK));
  // A lookout hut at the front corner.
  m.box(-W / 2 + 1.2, -W / 2 + 4.6, 0, 2.8, -D / 2 + 1.2, -D / 2 + 4.4, OLIVE, OLIVE_DARK);
  m.windows('front', -W / 2 + 1.2, -W / 2 + 4.6, -D / 2 + 1.2, -D / 2 + 4.4, 0, 1, 2.8, {
    col: GLASS,
    lit: () => 0.8,
    width: 1.6,
  });
  m.detail(NEAR_ONLY, () => {
    for (const x of [-6, -2, 2, 6]) m.cylinder(x, D / 2 - 0.7, 0.35, 0.08, 0.8, STEEL_DARK, 6);
  });
}

function interceptor(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, PAVING);
  // The launcher: eight upright tubes in a box on a turning base.
  const lx = 3;
  const lz = 2;
  m.cylinder(lx, lz, 3.4, 0, 1.2, STEEL_DARK, 12);
  m.box(lx - 3, lx + 3, 1.2, 2.2, lz - 2.2, lz + 2.2, OLIVE_DARK);
  m.box(lx - 2.8, lx + 2.8, 2.2, 7.2, lz - 1.6, lz + 1.6, OLIVE, OLIVE_DARK);
  m.detail(IN_FAR, () => {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++) {
        const x = lx - 2.1 + i * 1.4;
        const z = lz - 0.75 + j * 1.5;
        m.cylinder(x, z, 0.55, 7.2, 7.5, WHITE, 8, RED);
      }
  });
  // A control cabin and a radar block.
  block(m, -10.5, -3.5, -D / 2 + 1.5, -4, 1, 3.4, C('#e8e4da'), CONCRETE_DARK, {
    col: GLASS,
    lit: lit(r, 0.7),
    spacing: 2.4,
  });
  m.box(-9, -4, 0, 3.4, 4, 9, CONCRETE, CONCRETE_DARK);
  face(m, [-8.6, 3.4, 4.4], [-4.4, 3.4, 4.4], [-4.4, 7.2, 6.4], [-8.6, 7.2, 6.4], [0, 0.5, -1], C('#4a5560'));
  m.detail(IN_FAR, () => outline(m, lx - 5, lx + 5, lz - 5, lz + 5, 0.1, YELLOW, 0.3));
}

function shieldgen(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, PAVING);
  // The squat round power building.
  m.cylinder(0, 1, 6, 0, 5, C('#e8ecef'), 14, C('#c3c9cf'));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const x = Math.cos(a) * 6.05;
    const z = 1 + Math.sin(a) * 6.05;
    const tx = -Math.sin(a) * 0.7;
    const tz = Math.cos(a) * 0.7;
    face(
      m,
      [x - tx, 1.4, z - tz],
      [x + tx, 1.4, z + tz],
      [x + tx, 3.4, z + tz],
      [x - tx, 3.4, z - tz],
      [Math.cos(a), 0, Math.sin(a)],
      GLASS,
      r() < 0.7 ? 0.8 : 0,
    );
  }
  m.box(-1.2, 1.2, 0.06, 2.6, -5.1, -4.9, C('#3a5a7a'));
  // Four chunky pylons lean in to hold the crystal emitter about 14 m up.
  for (const [x, z] of [
    [-8.5, -7.5],
    [8.5, -7.5],
    [-8.5, 9.5],
    [8.5, 9.5],
  ] as const) {
    m.box(x - 1.1, x + 1.1, 0, 1.2, z - 1.1, z + 1.1, CONCRETE_DARK);
    beam(m, [x, 1.2, z], [x * 0.3, 13.4, 1 + (z - 1) * 0.3], 1.1, C('#7d8a96'));
  }
  m.cylinder(0, 1, 1.2, 5, 12.6, C('#7d8a96'), 8);
  crystal(m, 0, 14.4, 1, 2.4, 3.4, 6);
}

function armsfactory(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, ASPHALT);
  // The high earth bank at the back, where the test range is.
  mound(m, -W / 2 + 0.6, W / 2 - 0.6, 12.6, D / 2 - 0.6, 5, 2.4, EARTH);
  // The production hall with a saw-tooth roof; its roof lights face the road.
  const x0 = -22;
  const x1 = 14;
  const z0 = -8;
  const z1 = 10;
  const wall = r() < 0.5 ? C('#c8c3b8') : C('#bdb8ad');
  const h = 7;
  m.box(x0, x1, 0, h, z0, z1, wall, wall);
  m.windows('left', x0, x1, z0, z1, 0, 1, 4, { col: GLASS, lit: lit(r, 0.5), spacing: 3.2, height: 1.6 });
  const teeth = 4;
  const tw = (z1 - z0) / teeth;
  for (let k = 0; k < teeth; k++) {
    const a = z0 + k * tw;
    const b = a + tw;
    // Glazed upright face towards −z, sloping roof down to the back.
    face(m, [x0, h, a], [x1, h, a], [x1, h + 3, a], [x0, h + 3, a], [0, 0, -1], wall);
    for (let x = x0 + 0.6; x < x1 - 0.6; x += 3.6)
      m.quad(
        [x, h + 0.5, a - 0.05],
        [x, h + 2.6, a - 0.05],
        [x + 3, h + 2.6, a - 0.05],
        [x + 3, h + 0.5, a - 0.05],
        GLASS,
        r() < 0.6 ? 0.8 : 0,
      );
    face(m, [x0, h + 3, a], [x1, h + 3, a], [x1, h, b], [x0, h, b], [0, 1, 0.3], C('#7c8086'));
    tri(m, [x0, h, a], [x0, h + 3, a], [x0, h, b], [-1, 0, 0], wall);
    tri(m, [x1, h, a], [x1, h + 3, a], [x1, h, b], [1, 0, 0], wall);
  }
  // Two smoke stacks behind the hall.
  for (const x of [-16, -8]) {
    m.frustum(x, 11.8, 1.5, 1.2, 0, 19, C('#b5654a'), 10);
    m.detail(IN_FAR, () => m.frustum(x, 11.8, 1.25, 1.25, 16, 17.2, WHITE, 10, false));
  }
  // The loading dock with roller doors facing the road.
  m.box(x0 + 2, x1 - 2, 0, 1.2, z0 - 4, z0, CONCRETE, CONCRETE);
  for (const x of [-15, -6, 3]) m.box(x - 2.6, x + 2.6, 1.2, 5.6, z0 - 0.12, z0, ROLLER);
  m.detail(IN_FAR, () => m.box(-20, -17.6, 5.2, 6.4, z0 - 0.15, z0, RED));
  // An office wing, and crates in the yard.
  block(m, 16, 23, -D / 2 + 1.5, -6, 2, 3.4, C('#e8e4da'), CONCRETE_DARK, {
    col: GLASS,
    lit: lit(r, 0.6),
    spacing: 2.6,
  });
  for (let k = 0; k < 6; k++) {
    const x = 16.5 + (k % 3) * 2.4;
    const z = 0 + Math.floor(k / 3) * 3;
    const n = 1 + Math.floor(r() * 2);
    for (let t = 0; t < n; t++)
      m.box(x, x + 2, t * 1.3, t * 1.3 + 1.2, z, z + 2.4, t % 2 ? OLIVE_DARK : WOOD);
  }
}

function militarylab(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, PAVING);
  // A sleek white two-storey building with a glass front.
  const x0 = -13;
  const x1 = 7;
  const z0 = -D / 2 + 3;
  const z1 = 3;
  m.box(x0, x1, 0, 7.6, z0, z1, WHITE, C('#dfe3e6'));
  m.windows('front', x0, x1, z0, z1, 0, 2, 3.8, {
    col: C('#5d86a3'),
    lit: lit(r, 0.8),
    band: true,
    height: 3,
    spacing: 3.4,
  });
  for (const f of ['back', 'left'] as const)
    m.windows(f, x0, x1, z0, z1, 0, 2, 3.8, { col: GLASS, lit: lit(r, 0.6), spacing: 2.6 });
  m.box(x0 - 0.3, x1 + 0.3, 7.6, 8.1, z0 - 0.6, z1 + 0.3, C('#dfe3e6'));
  // A test dish on the roof.
  m.cylinder(-3, -4, 0.8, 8.1, 9.4, STEEL, 8);
  dish(m, -3, 10.6, -4, 2.2, 0.3, 0.8, WHITE);
  // The wind tunnel: a chunky tube of segments along the side.
  const tx = 12;
  tubeZ(m, tx, 2.6, -12, 12, 2.1, C('#dfe3e6'), 10);
  m.detail(IN_FAR, () => {
    for (const z of [-8, -2, 4, 10]) tubeZ(m, tx, 2.6, z - 0.4, z + 0.4, 2.35, STEEL_DARK, 10);
  });
  m.box(tx - 1.6, tx + 1.6, 0, 0.6, -11, 11, CONCRETE_DARK);
  // The test yard behind, with chunky blast walls.
  m.ground(-W / 2 + 1, W / 2 - 1, 6, D / 2 - 1, 0.08, GRAVEL);
  for (const [a, b, c, d] of [
    [-12, 0, 13, 14],
    [-13, -12, 6.5, 14],
    [-1, 0, 6.5, 14],
  ] as const)
    m.box(a, b, 0, 3.4, c, d, CONCRETE, CONCRETE_DARK);
}

function provingground(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, GRASS);
  // A sandy dirt test track loops round the site.
  const cx = -4;
  const cz = 2;
  const ax = 20;
  const az = 13;
  const seg = 24;
  const DIRT = C('#d5b77a');
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    const p = (a: number, s: number) => [cx + Math.cos(a) * (ax + s), 0.1, cz + Math.sin(a) * (az + s)];
    face(m, p(a0, -3), p(a0, 3), p(a1, 3), p(a1, -3), [0, 1, 0], DIRT);
  }
  // Chunky ramps and a water splash pool on the track.
  for (const [x, dir] of [
    [cx - 6, 1],
    [cx + 6, -1],
  ] as const) {
    const z = cz - az;
    face(
      m,
      [x - 3 * dir, 0.1, z - 2.6],
      [x - 3 * dir, 0.1, z + 2.6],
      [x, 1.4, z + 2.6],
      [x, 1.4, z - 2.6],
      [-dir * 0.4, 1, 0],
      C('#a89470'),
    );
    m.box(Math.min(x, x + 1.2 * dir), Math.max(x, x + 1.2 * dir), 0, 1.4, z - 2.6, z + 2.6, C('#a89470'));
  }
  m.ground(cx + ax - 3, cx + ax + 3, cz - 4, cz + 4, 0.14, WATER);
  // The firing range at the far end: big round targets on earth banks.
  mound(m, -W / 2 + 1, -W / 2 + 22, D / 2 - 6, D / 2 - 1, 3, 1.6, EARTH);
  for (const x of [-25, -18, -11]) {
    const z = D / 2 - 5.2;
    m.cylinder(x, z, 0.3, 3, 4, WOOD, 6);
    m.detail(IN_FAR, () => {
      face(
        m,
        [x - 1.6, 3.2, z - 0.3],
        [x + 1.6, 3.2, z - 0.3],
        [x + 1.6, 6.4, z - 0.3],
        [x - 1.6, 6.4, z - 0.3],
        [0, 0, -1],
        WHITE,
      );
      face(
        m,
        [x - 1, 3.8, z - 0.35],
        [x + 1, 3.8, z - 0.35],
        [x + 1, 5.8, z - 0.35],
        [x - 1, 5.8, z - 0.35],
        [0, 0, -1],
        RED,
      );
    });
  }
  // The observation bunker with a long viewing slot facing the range, and a small hangar.
  m.box(-W / 2 + 2, -W / 2 + 14, 0, 3, -D / 2 + 2, -D / 2 + 9, BUNKER, CONCRETE);
  m.box(-W / 2 + 3, -W / 2 + 13, 1.6, 2.2, -D / 2 + 9, -D / 2 + 9.08, C('#1e2328'));
  m.box(W / 2 - 16, W / 2 - 2, 0, 4, -D / 2 + 2, -D / 2 + 12, C('#d8d4c8'));
  vault(m, W / 2 - 16, W / 2 - 2, -D / 2 + 2, -D / 2 + 12, 4, 3.5, C('#8f9a7a'), {
    front: C('#d8d4c8'),
    back: C('#d8d4c8'),
  });
  m.box(W / 2 - 13, W / 2 - 5, 0.06, 3.6, -D / 2 + 1.88, -D / 2 + 2, ROLLER);
  m.detail(IN_FAR, () => tree(m, W / 2 - 4, D / 2 - 4, 1.4 + r() * 0.3));
}

function spyagency(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, GRASS);
  // The ramp down to the basement: a dark drive between walls that rise towards the heavy door
  // (drawn above the ground, which would hide a real pit).
  const rx0 = 2;
  const rx1 = 6.4;
  const rz0 = 4;
  const rz1 = 11.4;
  m.ground(rx0, rx1, rz0, rz1, 0.08, ASPHALT);
  for (const [a, b] of [
    [rx0 - 0.5, rx0],
    [rx1, rx1 + 0.5],
  ] as const)
    face(m, [a, 0.06, rz1], [a, 2.9, rz0], [b, 2.9, rz0], [b, 0.06, rz1], [0, 1, 0.5], CONCRETE_DARK);
  for (const x of [rx0 - 0.5, rx0, rx1, rx1 + 0.5])
    tri(
      m,
      [x, 0.06, rz1],
      [x, 2.9, rz0],
      [x, 0.06, rz0],
      [x === rx0 || x === rx1 + 0.5 ? 1 : -1, 0, 0],
      CONCRETE_DARK,
    );
  // The dullest office in town: four plain beige storeys, identical windows all round.
  const wall = C('#d9cba8');
  const x0 = -9;
  const x1 = 9;
  const z0 = -8;
  const z1 = 4;
  block(m, x0, x1, z0, z1, 4, 3.4, wall, CONCRETE_DARK, { col: GLASS, lit: lit(r, 0.5), spacing: 2.4 });
  m.box(rx0 + 0.3, rx1 - 0.3, 0.08, 2.7, rz0, rz0 + 0.12, C('#5b6168'));
  m.detail(IN_FAR, () => hazard(m, rx0 + 0.3, rx1 - 0.3, 2.7, 3.1, rz0 + 0.24, 4));
  m.box(-1, 1, 0, 2.4, z0 - 0.12, z0, C('#7a5a3c'));
  m.ground(-1.2, 1.2, -D / 2 + 0.2, z0, 0.1, PAVING);
  // Very neat hedges.
  m.detail(IN_FAR, () => {
    m.box(-W / 2 + 1, -1.8, 0, 1, -D / 2 + 1, -D / 2 + 2, HEDGE);
    m.box(1.8, W / 2 - 1, 0, 1, -D / 2 + 1, -D / 2 + 2, HEDGE);
  });
  // The give-away: three chunky satellite dishes and a big antenna block on the roof.
  const top = 13.6;
  for (const [x, z, yaw] of [
    [-5.5, -4.5, 0.6],
    [-1, -4.5, -0.4],
    [-5.5, 0.8, 2.5],
  ] as const) {
    m.cylinder(x, z, 0.5, top + 0.6, top + 1.4, STEEL, 6);
    dish(m, x, top + 2.4, z, 1.6, yaw, 0.7, WHITE);
  }
  m.box(3, 7, top + 0.6, top + 5.6, -2.6, 1.4, C('#c9ced2'), STEEL);
  m.detail(IN_FAR, () => m.box(4, 6, top + 5.6, top + 6.8, -1.6, 0.4, STEEL_DARK));
}

// ------------------------------------------------------------------ W5, W6: superweapons and the final race

function domeshield(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, PAVING);
  // A stepped round base.
  m.cylinder(0, 0, 14, 0, 1.2, CONCRETE, 18, C('#d6d3cc'));
  m.cylinder(0, 0, 10.5, 1.2, 2.4, C('#d6d3cc'), 18);
  m.cylinder(0, 0, 7, 2.4, 3.6, CONCRETE, 16);
  // Four transformer blocks feeding heavy conduits into the spire.
  for (const [x, z] of [
    [-15.5, -15.5],
    [15.5, -15.5],
    [-15.5, 15.5],
    [15.5, 15.5],
  ] as const) {
    m.box(x - 2.6, x + 2.6, 0, 4.2, z - 2.6, z + 2.6, C('#7d8a96'), STEEL_DARK);
    m.detail(IN_FAR, () => {
      for (const d of [-1.6, 0, 1.6])
        m.box(x + d - 0.25, x + d + 0.25, 0.4, 3.8, z - 2.9, z + 2.9, STEEL_DARK);
    });
    beam(m, [x * 0.86, 3, z * 0.86], [x * 0.18, 8, z * 0.18], 1, YELLOW);
  }
  // The tall central spire, topped by a big faceted crystal emitter.
  m.frustum(0, 0, 4.2, 2.6, 3.6, 18, C('#e8ecef'), 10);
  m.frustum(0, 0, 2.6, 1.4, 18, 34, C('#c9ced2'), 10);
  m.detail(IN_FAR, () => {
    for (const y of [10, 22, 30])
      m.frustum(0, 0, 3.5 - y * 0.06, 3.5 - y * 0.06, y, y + 1, SIGN_BLUE, 10, false);
  });
  crystal(m, 0, 37.4, 0, 3.4, 3.8, 8);
}

function blackouttower(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, GRAVEL);
  // The control building at its foot.
  block(m, -11, -3, -D / 2 + 1.5, -3, 1, 4, C('#5f6670'), C('#4b5159'), {
    col: GLASS,
    lit: lit(r, 0.7),
    spacing: 2.6,
  });
  // A tall tapering tower of stacked solid blocks, about 55 m.
  const tx = 4;
  const tz = 3;
  const sizes = [4.6, 4, 3.5, 3, 2.6, 2.2];
  const DARK = C('#4b5159');
  const MID = C('#6c737a');
  let y = 0;
  sizes.forEach((s, k) => {
    const h = 9;
    m.box(tx - s, tx + s, y, y + h, tz - s, tz + s, k % 2 ? MID : DARK, MID);
    y += h;
  });
  // Three chunky dish clusters at different heights.
  for (const [hy, yaw] of [
    [16, 0],
    [30, 2.1],
    [44, 4.2],
  ] as const) {
    const ox = tx + Math.sin(yaw) * -4.5;
    const oz = tz + Math.cos(yaw) * -4.5;
    dish(m, ox, hy, oz, 2.4, yaw, 0.15, WHITE, DARK);
    dish(m, ox + Math.cos(yaw) * 2.6, hy + 2.6, oz - Math.sin(yaw) * 2.6, 1.6, yaw, 0.5, WHITE, DARK);
  }
  // The glowing ring near the top.
  m.cylinder(tx, tz, 3.4, 50, 51.4, CRYSTAL, 12);
  for (let k = 0; k < 12; k++) {
    const a = ((k + 0.5) / 12) * Math.PI * 2;
    const x = tx + Math.cos(a) * 3.42;
    const z = tz + Math.sin(a) * 3.42;
    const t = 0.8;
    face(
      m,
      [x - Math.sin(a) * t, 50.1, z + Math.cos(a) * t],
      [x + Math.sin(a) * t, 50.1, z - Math.cos(a) * t],
      [x + Math.sin(a) * t, 51.3, z - Math.cos(a) * t],
      [x - Math.sin(a) * t, 51.3, z + Math.cos(a) * t],
      [Math.cos(a), 0, Math.sin(a)],
      CRYSTAL,
      0.95,
    );
  }
  m.box(tx - 1, tx + 1, y, y + 3, tz - 1, tz + 1, YELLOW);
}

function expressgate(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, PAVING);
  // A wide platform with ramps up from the road side and down at the back.
  const py = 2;
  m.box(-15, 15, 0, py, -6, 8, CONCRETE, C('#d6d3cc'));
  face(
    m,
    [-12, 0.06, -D / 2 + 1],
    [12, 0.06, -D / 2 + 1],
    [12, py, -6],
    [-12, py, -6],
    [0, 1, -0.3],
    C('#bdb9b0'),
  );
  face(
    m,
    [-12, py, 8],
    [12, py, 8],
    [12, 0.06, D / 2 - 1],
    [-12, 0.06, D / 2 - 1],
    [0, 1, 0.3],
    C('#bdb9b0'),
  );
  // The giant upright ring, about 30 m across, ringed with segmented lights.
  const cy = py + 15.5;
  const R = 14;
  const n = 24;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    const p = (a: number, rr: number, z: number) => [Math.cos(a) * rr, cy + Math.sin(a) * rr, z];
    const mid = (a0 + a1) / 2;
    const out: V3 = [Math.cos(mid), Math.sin(mid), 0];
    // Outer and inner faces, and the two sides.
    face(
      m,
      p(a0, R + 1.4, -1.4),
      p(a1, R + 1.4, -1.4),
      p(a1, R + 1.4, 1.4),
      p(a0, R + 1.4, 1.4),
      out,
      C('#7d8a96'),
    );
    face(
      m,
      p(a0, R - 1.4, -1.4),
      p(a1, R - 1.4, -1.4),
      p(a1, R - 1.4, 1.4),
      p(a0, R - 1.4, 1.4),
      [-out[0], -out[1], 0],
      C('#c9ced2'),
    );
    face(
      m,
      p(a0, R - 1.4, -1.4),
      p(a1, R - 1.4, -1.4),
      p(a1, R + 1.4, -1.4),
      p(a0, R + 1.4, -1.4),
      [0, 0, -1],
      C('#9aa3ab'),
    );
    face(
      m,
      p(a0, R - 1.4, 1.4),
      p(a1, R - 1.4, 1.4),
      p(a1, R + 1.4, 1.4),
      p(a0, R + 1.4, 1.4),
      [0, 0, 1],
      C('#9aa3ab'),
    );
    // A light segment on the front face.
    if (k % 2 === 0)
      face(
        m,
        p(a0 + 0.03, R - 0.6, -1.46),
        p(a1 - 0.03, R - 0.6, -1.46),
        p(a1 - 0.03, R + 0.6, -1.46),
        p(a0 + 0.03, R + 0.6, -1.46),
        [0, 0, -1],
        CRYSTAL,
        0.95,
      );
  }
  // Feet where the ring meets the platform.
  for (const s of [-1, 1]) m.box(s * 9 - 2, s * 9 + 2, py, py + 4.5, -2, 2, C('#7d8a96'), STEEL_DARK);
  // A control tower on each side.
  for (const s of [-1, 1]) {
    const x = s * 20;
    m.box(x - 2.6, x + 2.6, 0, 14, -3, 3, C('#e8ecef'), C('#c3c9cf'));
    m.box(x - 3.2, x + 3.2, 14, 17, -3.6, 3.6, GLASS);
    m.windows('front', x - 3.2, x + 3.2, -3.6, 3.6, 14, 1, 3, {
      col: C('#9fcbe0'),
      lit: () => 0.9,
      band: true,
      height: 2.4,
    });
    m.box(x - 3.5, x + 3.5, 17, 17.5, -3.9, 3.9, STEEL_DARK);
  }
}

function enrichment(m: ModelBuilder, W: number, D: number, r: () => number): void {
  base(m, W, D, CONCRETE);
  // Thick blast walls along the edges, a gap at the gate.
  const t = 1.4;
  const wh = 4;
  m.box(-W / 2 + 0.3, W / 2 - 0.3, 0, wh, D / 2 - 0.3 - t, D / 2 - 0.3, BUNKER, CONCRETE);
  m.box(-W / 2 + 0.3, -W / 2 + 0.3 + t, 0, wh, -D / 2 + 0.3, D / 2 - 0.3 - t, BUNKER, CONCRETE);
  m.box(W / 2 - 0.3 - t, W / 2 - 0.3, 0, wh, -D / 2 + 0.3, D / 2 - 0.3 - t, BUNKER, CONCRETE);
  m.box(-W / 2 + 0.3 + t, -6, 0, wh, -D / 2 + 0.3, -D / 2 + 0.3 + t, BUNKER, CONCRETE);
  m.box(6, W / 2 - 0.3 - t, 0, wh, -D / 2 + 0.3, -D / 2 + 0.3 + t, BUNKER, CONCRETE);
  m.detail(IN_FAR, () => {
    hazard(m, -W / 2 + 2, -6.2, wh - 0.8, wh - 0.3, -D / 2 + 0.3, 10);
    hazard(m, 6.2, W / 2 - 2, wh - 0.8, wh - 0.3, -D / 2 + 0.3, 10);
  });
  gatehouse(m, 9, -D / 2 + 4.6, -5.6, YELLOW);
  // Two long, low halls with rows of round vents on their roofs.
  const wall = C('#e3e0d6');
  for (const [z0, z1] of [
    [-10, -1],
    [3, 12],
  ] as const) {
    m.box(-19, 14, 0, 5.6, z0, z1, wall, C('#b8bcc0'));
    m.windows('front', -19, 14, z0, z1, 0, 1, 5.6, {
      col: GLASS,
      lit: lit(r, 0.5),
      spacing: 4.4,
      height: 1.2,
    });
    for (let x = -16; x <= 11; x += 4.5) m.cylinder(x, (z0 + z1) / 2, 0.9, 5.6, 6.8, STEEL, 8, STEEL_DARK);
    // Doors with hazard panels.
    m.box(-17, -14.6, 0.06, 3, z0 - 0.12, z0, C('#5b6168'));
    m.detail(IN_FAR, () => hazard(m, -17.4, -14.2, 3, 3.5, z0, 4));
  }
  // The tall cooling stack, with hazard stripes (a vent: no smoke).
  m.frustum(18, 12, 3.4, 2.6, 0, 30, C('#e3e0d6'), 12);
  m.frustum(18, 12, 3.05, 2.95, 22, 24, YELLOW, 12, false);
  m.frustum(18, 12, 2.95, 2.85, 24, 26, BLACK, 12, false);
  m.frustum(18, 12, 2.85, 2.75, 26, 28, YELLOW, 12, false);
}

function atomsilo(m: ModelBuilder, W: number, D: number): void {
  base(m, W, D, GRASS);
  // A solid wall round the site, a gate at the road.
  const t = 0.8;
  const wh = 3.2;
  m.box(-W / 2 + 0.2, W / 2 - 0.2, 0, wh, D / 2 - 0.2 - t, D / 2 - 0.2, BUNKER, CONCRETE);
  m.box(-W / 2 + 0.2, -W / 2 + 0.2 + t, 0, wh, -D / 2 + 0.2, D / 2 - 0.2 - t, BUNKER, CONCRETE);
  m.box(W / 2 - 0.2 - t, W / 2 - 0.2, 0, wh, -D / 2 + 0.2, D / 2 - 0.2 - t, BUNKER, CONCRETE);
  m.box(-W / 2 + 0.2 + t, -4, 0, wh, -D / 2 + 0.2, -D / 2 + 0.2 + t, BUNKER, CONCRETE);
  m.box(4, W / 2 - 0.2 - t, 0, wh, -D / 2 + 0.2, -D / 2 + 0.2 + t, BUNKER, CONCRETE);
  // A low grassy hill with the huge round hatch in two halves, ringed with hazard stripes.
  const cz = 3;
  mound(m, -15, 15, cz - 13, cz + 13, 2.4, 5);
  const hy = 2.42;
  const rr = 6.4;
  const seg = 20;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    const p = (a: number, rad: number) => [Math.cos(a) * rad, hy + 0.06, cz + Math.sin(a) * rad];
    face(m, p(a0, rr), p(a1, rr), p(a1, rr + 1.3), p(a0, rr + 1.3), [0, 1, 0], k % 2 ? BLACK : YELLOW);
  }
  // The hatch: two half-discs that slide apart along x, standing a little proud of the ring.
  const top = hy + 0.5;
  for (const s of [-1, 1]) {
    const half = seg / 2;
    for (let k = 0; k < half; k++) {
      const a0 = (k / half) * Math.PI;
      const a1 = ((k + 1) / half) * Math.PI;
      const p = (a: number, y: number) => [s * (0.15 + Math.sin(a) * rr), y, cz + Math.cos(a) * rr];
      tri(m, [s * 0.15, top, cz], p(a0, top), p(a1, top), [0, 1, 0], C('#9aa0a6'));
      const mid = (a0 + a1) / 2;
      face(
        m,
        p(a0, hy),
        p(a1, hy),
        p(a1, top),
        p(a0, top),
        [s * Math.sin(mid), 0, Math.cos(mid)],
        STEEL_DARK,
      );
    }
    face(
      m,
      [s * 0.15, hy, cz - rr],
      [s * 0.15, hy, cz + rr],
      [s * 0.15, top, cz + rr],
      [s * 0.15, top, cz - rr],
      [-s, 0, 0],
      STEEL_DARK,
    );
  }
  // A squat concrete control bunker with a thick blast door.
  m.box(8, 17, 0, 3.2, -D / 2 + 3, -D / 2 + 10, BUNKER, CONCRETE);
  m.box(10.8, 14.2, 0.06, 2.6, -D / 2 + 2.85, -D / 2 + 3, C('#5b6168'));
  m.detail(IN_FAR, () => hazard(m, 10.4, 14.6, 2.6, 3, -D / 2 + 3, 4));
  // Searchlight blocks at the four corners.
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const px = x * (W / 2 - 2.6);
    const pz = z * (D / 2 - 2.6);
    m.box(px - 0.6, px + 0.6, 0, 5, pz - 0.6, pz + 0.6, CONCRETE_DARK);
    m.box(px - 1, px + 1, 5, 6.4, pz - 1, pz + 1, STEEL_DARK);
    m.quad(
      [px - 0.8, 5.2, pz - 1.05],
      [px - 0.8, 6.2, pz - 1.05],
      [px + 0.8, 6.2, pz - 1.05],
      [px + 0.8, 5.2, pz - 1.05],
      LAMP,
      1,
    );
    m.quad(
      [px + 0.8, 5.2, pz + 1.05],
      [px + 0.8, 6.2, pz + 1.05],
      [px - 0.8, 6.2, pz + 1.05],
      [px - 0.8, 5.2, pz + 1.05],
      LAMP,
      1,
    );
  }
}

/**
 * The war buildings' generated looks by model id (the prompts' file names): true if `model` is
 * one of them, drawn into `m` on a W × D site.
 */
export function buildMilitaryModel(
  model: string,
  m: ModelBuilder,
  W: number,
  D: number,
  r: () => number,
): boolean {
  switch (model) {
    case 'militaryhq':
      militaryhq(m, W, D, r);
      return true;
    case 'barracks':
      barracks(m, W, D, r);
      return true;
    case 'shelter':
      shelter(m, W, D);
      return true;
    case 'bunker':
      bunker(m, W, D);
      return true;
    case 'vehicledepot':
      vehicledepot(m, W, D, r);
      return true;
    case 'airfield':
      airfield(m, W, D, r);
      return true;
    case 'navalyard':
      navalyard(m, W, D, r);
      return true;
    case 'radar':
      radar(m, W, D, r);
      return true;
    case 'antiair':
      antiair(m, W, D);
      return true;
    case 'coastalgun':
      coastalgun(m, W, D);
      return true;
    case 'interceptor':
      interceptor(m, W, D, r);
      return true;
    case 'shieldgen':
      shieldgen(m, W, D, r);
      return true;
    case 'armsfactory':
      armsfactory(m, W, D, r);
      return true;
    case 'militarylab':
      militarylab(m, W, D, r);
      return true;
    case 'provingground':
      provingground(m, W, D, r);
      return true;
    case 'spyagency':
      spyagency(m, W, D, r);
      return true;
    case 'domeshield':
      domeshield(m, W, D);
      return true;
    case 'blackouttower':
      blackouttower(m, W, D, r);
      return true;
    case 'expressgate':
      expressgate(m, W, D);
      return true;
    case 'enrichment':
      enrichment(m, W, D, r);
      return true;
    case 'atomsilo':
      atomsilo(m, W, D);
      return true;
    default:
      return false;
  }
}

/** Every war building's site (m) by model id, from PROMPTS-WAR.md (later ones not in the game yet). */
export const MILITARY_SITES: Record<string, [number, number]> = {
  militaryhq: [40, 40],
  barracks: [40, 32],
  shelter: [16, 16],
  bunker: [16, 16],
  vehicledepot: [48, 40],
  airfield: [200, 80],
  navalyard: [120, 64],
  radar: [24, 24],
  antiair: [16, 16],
  coastalgun: [16, 16],
  interceptor: [24, 24],
  shieldgen: [24, 24],
  armsfactory: [48, 40],
  militarylab: [32, 32],
  provingground: [64, 48],
  spyagency: [24, 24],
  domeshield: [40, 40],
  blackouttower: [24, 24],
  expressgate: [48, 32],
  enrichment: [48, 40],
  atomsilo: [40, 40],
};
