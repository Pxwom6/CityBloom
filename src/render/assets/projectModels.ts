import { Color } from 'three';
import type { ModelBuilder } from './builder';

/**
 * Big projects (M17): a finished model for each, and a building site for each construction stage
 * (earthworks, frames and cranes, then nearly done). All designs are original. Local space as for
 * every model: x along the road, front faces −z, y up.
 */
const C = (hex: string) => new Color(hex);
const CONCRETE = C('#c9c6bf');
const CONCRETE_DARK = C('#a3a09a');
const EARTH = C('#8b7355');
const EARTH_DARK = C('#6e5a44');
const GRAVEL = C('#bdb6a6');
const GRASS = C('#8cc063');
const PITCH = C('#5aa04a');
const PITCH_LINE = C('#eef2ea');
const SEATS = C('#2f6fb3');
const SEATS_2 = C('#c9423a');
const WHITE = C('#f2f4f5');
const STEEL = C('#9aa0a6');
const STEEL_DARK = C('#6f757c');
const CRANE = C('#e0a526');
const HOARDING = C('#d9d4c7');
const GLASS = C('#3d5a73');
const GLASS_LIGHT = C('#8fc3d8');
const MIRROR = C('#9fc6df');
const MIRROR_FRAME = C('#707880');
const MIRROR_BACK = C('#b9bec4');
const FACADE = C('#e6e8ea');
const GATE = C('#3a4048');
const RECEIVER = C('#ffd27a');
const TANK = C('#d7d9dc');
const WATER = C('#4aa3c8');
const PATH = C('#e3d9c0');
const LEAF = C('#5f9a45');
const TRUNK = C('#6b4f36');
const FLOWERS = ['#e8608a', '#f2c14e', '#9b6ad1', '#f08a3c', '#f4f0e6'].map(C);
const PAVILION = ['#e9e3d4', '#9fd0c8', '#f0c98a', '#c7b8e0', '#e7a4a0'].map(C);
const ROOF_WAVE = C('#dfe4e8');
const ROCKET = C('#f5f6f7');
const ROCKET_BAND = C('#2b2f36');

type Stage = { stage: number; stages: number };

function lot(m: ModelBuilder, W: number, D: number, top: Color): void {
  m.box(-W / 2 + 0.2, W / 2 - 0.2, -5, 0.06, -D / 2 + 0.2, D / 2 - 0.2, CONCRETE_DARK, top);
}

/** Site hoarding around the lot, with a gate on the road side. */
function hoarding(m: ModelBuilder, W: number, D: number): void {
  const h = 2.4;
  const x0 = -W / 2 + 1;
  const x1 = W / 2 - 1;
  const z0 = -D / 2 + 1;
  const z1 = D / 2 - 1;
  m.box(x0, -6, 0, h, z0, z0 + 0.3, HOARDING);
  m.box(6, x1, 0, h, z0, z0 + 0.3, HOARDING);
  m.box(x0, x1, 0, h, z1 - 0.3, z1, HOARDING);
  m.box(x0, x0 + 0.3, 0, h, z0, z1, HOARDING);
  m.box(x1 - 0.3, x1, 0, h, z0, z1, HOARDING);
}

/** A tower crane: lattice-ish mast, a jib pointing at `yaw`, a counter-jib and a hook. */
function crane(m: ModelBuilder, x: number, z: number, h: number, yaw: number): void {
  m.box(x - 1, x + 1, 0, h, z - 1, z + 1, CRANE);
  for (let y = 4; y < h - 2; y += 6) m.box(x - 1.2, x + 1.2, y, y + 0.4, z - 1.2, z + 1.2, STEEL_DARK);
  m.box(x - 1.4, x + 1.4, h, h + 2.4, z - 1.4, z + 1.4, CRANE);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const seg = (a: number, b: number, y0: number, y1: number, w: number, col: Color) => {
    // A horizontal beam along the jib direction from a to b metres from the mast.
    const ax = x + c * a;
    const az = z + s * a;
    const bx = x + c * b;
    const bz = z + s * b;
    const nx = -s * w;
    const nz = c * w;
    m.quad(
      [ax + nx, y1, az + nz],
      [bx + nx, y1, bz + nz],
      [bx - nx, y1, bz - nz],
      [ax - nx, y1, az - nz],
      col,
    );
    m.quad(
      [ax - nx, y0, az - nz],
      [bx - nx, y0, bz - nz],
      [bx + nx, y0, bz + nz],
      [ax + nx, y0, az + nz],
      col,
    );
    m.quad(
      [ax + nx, y0, az + nz],
      [bx + nx, y0, bz + nz],
      [bx + nx, y1, bz + nz],
      [ax + nx, y1, az + nz],
      col,
    );
    m.quad(
      [ax - nx, y1, az - nz],
      [bx - nx, y1, bz - nz],
      [bx - nx, y0, bz - nz],
      [ax - nx, y0, az - nz],
      col,
    );
  };
  seg(-12, 34, h + 2.4, h + 3.6, 0.7, CRANE);
  m.box(
    x - c * 11 - 1.6,
    x - c * 11 + 1.6,
    h + 0.6,
    h + 2.8,
    z - s * 11 - 1.6,
    z - s * 11 + 1.6,
    CONCRETE_DARK,
  );
  m.box(
    x + c * 26 - 0.15,
    x + c * 26 + 0.15,
    h * 0.45,
    h + 2.4,
    z + s * 26 - 0.15,
    z + s * 26 + 0.15,
    STEEL_DARK,
  );
}

/** Site cabins and a pile of materials near the gate. */
function siteKit(m: ModelBuilder, W: number, D: number): void {
  const x = -W / 2 + 10;
  const z = -D / 2 + 8;
  m.box(x, x + 9, 0, 2.8, z, z + 3.2, C('#e4e0d5'), C('#b9b4a8'));
  m.box(x, x + 9, 2.8, 5.6, z, z + 3.2, C('#e4e0d5'), C('#b9b4a8'));
  m.box(x + 12, x + 18, 0, 1.2, z, z + 4, GRAVEL);
  m.box(x + 20, x + 26, 0, 0.8, z, z + 3, STEEL);
}

/** An elliptical ring from (rx0, rz0) at y0 out and up to (rx1, rz1) at y1, facing inward. */
function ellipseRing(
  m: ModelBuilder,
  rx0: number,
  rz0: number,
  y0: number,
  rx1: number,
  rz1: number,
  y1: number,
  col: Color,
  from = 0,
  to = 1,
  n = 32,
  cx = 0,
  cz = 0,
): void {
  const k0 = Math.floor(n * from);
  const k1 = Math.ceil(n * to);
  for (let i = k0; i < k1; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (rx: number, rz: number, y: number, a: number) => [
      cx + Math.cos(a) * rx,
      y,
      cz + Math.sin(a) * rz,
    ];
    m.quad(p(rx0, rz0, y0, a1), p(rx1, rz1, y1, a1), p(rx1, rz1, y1, a0), p(rx0, rz0, y0, a0), col);
  }
}

function stadium(m: ModelBuilder, W: number, D: number, st: Stage): void {
  const done = st.stage >= st.stages;
  const rx = W / 2 - 6;
  const rz = D / 2 - 6;
  lot(m, W, D, done ? GRAVEL : EARTH);
  if (!done) hoarding(m, W, D);
  // The pitch in its bowl: dug out first, then turfed.
  m.box(-rx * 0.55, rx * 0.55, 0.06, 0.12, -rz * 0.5, rz * 0.5, st.stage >= 2 ? PITCH : EARTH_DARK);
  if (done) {
    m.box(-0.2, 0.2, 0.12, 0.16, -rz * 0.5, rz * 0.5, PITCH_LINE);
    ellipseRing(m, 7, 7, 0.14, 7.4, 7.4, 0.16, PITCH_LINE, 0, 1, 20);
  }
  // Stands: a lower tier (stage 1), the upper tier (stage 2), the roof ring (done).
  const tier = (s0: number, s1: number, y0: number, y1: number, col: Color, from = 0, to = 1) =>
    ellipseRing(m, rx * s0, rz * s0, y0, rx * s1, rz * s1, y1, col, from, to);
  if (st.stage === 0) {
    // Foundations: a ring of footings.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = Math.cos(a) * rx * 0.85;
      const z = Math.sin(a) * rz * 0.85;
      m.box(x - 1.2, x + 1.2, 0, 1.6, z - 1.2, z + 1.2, CONCRETE);
    }
    crane(m, W / 2 - 12, 0, 34, Math.PI);
    siteKit(m, W, D);
    return;
  }
  tier(0.62, 0.8, 0.5, 9, done ? SEATS : CONCRETE, 0, st.stage === 1 ? 0.6 : 1);
  // Outer wall of the lower tier.
  ellipseRing(m, rx * 0.8, rz * 0.8, 9, rx * 0.8, rz * 0.8, 0, CONCRETE_DARK, 0, st.stage === 1 ? 0.6 : 1);
  if (st.stage === 1) {
    crane(m, W / 2 - 10, -D / 4, 40, Math.PI * 0.9);
    crane(m, -W / 2 + 12, D / 4, 38, -0.2);
    siteKit(m, W, D);
    return;
  }
  tier(0.8, 1, 9, 22, done ? SEATS_2 : CONCRETE, 0, 1);
  ellipseRing(m, rx, rz, 22, rx, rz, 0, done ? FACADE : CONCRETE_DARK);
  // The facade: slender ribs round the bowl, a coloured band under the roof and gates at ground level.
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const x = Math.cos(a) * (rx + 0.6);
    const z = Math.sin(a) * (rz + 0.6);
    m.box(x - 0.35, x + 0.35, 0, 22.5, z - 0.35, z + 0.35, done ? WHITE : STEEL);
  }
  if (done) {
    ellipseRing(m, rx + 0.7, rz + 0.7, 21, rx + 0.7, rz + 0.7, 18, SEATS, 0, 1, 40);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * (rx + 0.8);
      const z = Math.sin(a) * (rz + 0.8);
      m.box(x - 2.2, x + 2.2, 0, 4.5, z - 2.2, z + 2.2, GATE);
    }
  }
  // Roof: a ring of cantilevered trusses, then the membrane.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    m.box(x * rx - 0.4, x * rx + 0.4, 22, 26, z * rz - 0.4, z * rz + 0.4, STEEL);
  }
  if (done) {
    ellipseRing(m, rx * 1.02, rz * 1.02, 26, rx * 0.72, rz * 0.72, 24, WHITE);
    ellipseRing(m, rx * 0.72, rz * 0.72, 23.8, rx * 1.02, rz * 1.02, 25.8, WHITE);
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const x = sx * (W / 2 - 5);
      const z = sz * (D / 2 - 5);
      m.box(x - 0.6, x + 0.6, 0, 40, z - 0.6, z + 0.6, STEEL);
      m.box(x - 3, x + 3, 40, 43, z - 0.8, z + 0.8, WHITE, WHITE);
    }
  } else {
    crane(m, W / 2 - 10, 0, 44, Math.PI);
    siteKit(m, W, D);
  }
  m.height = Math.max(m.height, done ? 43 : 48);
}

function launchsite(m: ModelBuilder, W: number, D: number, st: Stage): void {
  const done = st.stage >= st.stages;
  lot(m, W, D, done || st.stage >= 1 ? CONCRETE : EARTH);
  if (!done) hoarding(m, W, D);
  // The pad and its flame trench, back right.
  const px = W / 4;
  const pz = D / 5;
  m.box(px - 14, px + 14, 0, 1.2, pz - 14, pz + 14, CONCRETE);
  m.box(px - 3, px + 3, 0.1, 1.25, pz - 14, pz + 22, EARTH_DARK);
  if (st.stage === 0) {
    crane(m, px - 20, pz - 18, 30, 0.8);
    siteKit(m, W, D);
    return;
  }
  // The assembly hall, front left: tall with a door the height of the rocket.
  const hx0 = -W / 2 + 8;
  const hx1 = -W / 2 + 36;
  const hz0 = -D / 2 + 14;
  const hz1 = -D / 2 + 50;
  const hallTop = st.stage === 1 ? 26 : 52;
  m.box(hx0, hx1, 0, hallTop, hz0, hz1, WHITE, CONCRETE);
  // Panel seams up the hall's sides.
  for (let z = hz0 + 4; z < hz1; z += 6) m.box(hx0 - 0.15, hx0, 0, hallTop, z - 0.2, z + 0.2, CONCRETE_DARK);
  for (let z = hz0 + 4; z < hz1; z += 6) m.box(hx1, hx1 + 0.15, 0, hallTop, z - 0.2, z + 0.2, CONCRETE_DARK);
  if (st.stage >= 2) {
    // The tall door facing the pad, a band of colour and a low annexe.
    m.box(hx1, hx1 + 0.2, 0.2, 44, hz0 + 8, hz1 - 8, STEEL_DARK);
    m.box(hx0 - 0.1, hx1 + 0.1, 46, 49, hz0 - 0.1, hz1 + 0.1, C('#3a6ea8'));
    m.box(hx0 - 0.1, hx1 + 0.1, 43, 44.5, hz0 - 0.1, hz1 + 0.1, C('#c9423a'));
    m.box(hx0 + 2, hx1 - 2, 0, 9, hz0 - 10, hz0, CONCRETE, CONCRETE_DARK);
    m.windows('front', hx0 + 2, hx1 - 2, hz0 - 10, hz0, 0, 2, 3, {
      col: GLASS,
      band: true,
      height: 1.4,
      lit: () => 0.3,
    });
  }
  // The launch tower beside the pad (a steel lattice), growing with the stages.
  const tx = px + 10;
  const tz = pz;
  const th = st.stage === 1 ? 24 : 70;
  for (const [dx, dz] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ] as const)
    m.box(tx + dx - 0.5, tx + dx + 0.5, 0, th, tz + dz - 0.5, tz + dz + 0.5, C('#b8403a'));
  for (let y = 4; y < th; y += 5) m.box(tx - 3.5, tx + 3.5, y, y + 0.5, tz - 3.5, tz + 3.5, C('#b8403a'));
  // Propellant tanks.
  for (let k = 0; k < (st.stage >= 2 ? 3 : 1); k++)
    m.dome(-W / 2 + 16 + k * 12, D / 2 - 14, 5, 0, TANK, 4, 12);
  if (!done) {
    crane(m, px - 16, pz - 20, st.stage === 1 ? 50 : 80, 0.9);
    siteKit(m, W, D);
    m.height = Math.max(m.height, st.stage === 1 ? 54 : 84);
    return;
  }
  // The rocket on the pad: core, two boosters, nose cone.
  m.cylinder(px, pz, 3, 1.2, 58, ROCKET, 12);
  m.cylinder(px, pz, 3.05, 40, 42, ROCKET_BAND, 12);
  m.frustum(px, pz, 3, 0.2, 58, 68, ROCKET, 12);
  for (const s of [-1, 1]) {
    m.cylinder(px + s * 4.4, pz, 1.4, 1.2, 36, ROCKET, 10);
    m.frustum(px + s * 4.4, pz, 1.4, 0.2, 36, 40, ROCKET_BAND, 10);
  }
  m.height = Math.max(m.height, 70);
}

function helioarray(m: ModelBuilder, W: number, D: number, st: Stage): void {
  const done = st.stage >= st.stages;
  lot(m, W, D, GRAVEL);
  if (!done) hoarding(m, W, D);
  // Rings of heliostats round the tower, all turned to face it; built out ring by ring.
  const rings = st.stage === 0 ? 3 : 6;
  for (let k = 1; k <= rings; k++) {
    const r = 12 + k * 8.5;
    const n = Math.floor((2 * Math.PI * r) / 7);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.3;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) > W / 2 - 4 || Math.abs(z) > D / 2 - 4) continue;
      m.box(x - 0.15, x + 0.15, 0, 1.6, z - 0.15, z + 0.15, MIRROR_FRAME);
      // A mirror tilted up towards the tower.
      const ux = -Math.cos(a);
      const uz = -Math.sin(a);
      const vx = -uz;
      const vz = ux;
      const h = 1.6;
      const s = 1.8;
      const tilt = 0.5;
      const p = (u: number, v: number) => [
        x + vx * v * s + ux * u * s * 0.7,
        h + u * tilt,
        z + vz * v * s + uz * u * s * 0.7,
      ];
      m.quad(p(-1, -1), p(-1, 1), p(1, 1), p(1, -1), MIRROR);
      m.quad(p(1, -1), p(1, 1), p(-1, 1), p(-1, -1), MIRROR_BACK);
    }
  }
  // The receiver tower in the middle.
  const th = st.stage === 0 ? 0 : st.stage === 1 ? 40 : 86;
  if (th > 0) {
    m.frustum(0, 0, 7, 4.5, 0, th, CONCRETE, 16);
    if (st.stage >= 2) {
      m.cylinder(0, 0, 6, th, th + 12, done ? RECEIVER : STEEL_DARK, 16);
      m.frustum(0, 0, 6, 2, th + 12, th + 16, STEEL, 16);
    }
  }
  // Heat store tanks by the road.
  if (st.stage >= 2)
    for (const x of [-W / 2 + 14, -W / 2 + 30]) m.cylinder(x, -D / 2 + 14, 6, 0, 14, TANK, 16);
  if (!done) {
    crane(m, 14, -14, st.stage === 1 ? 60 : 100, Math.PI * 1.25);
    siteKit(m, W, D);
  }
  m.height = Math.max(m.height, th + 16);
}

function expoTree(m: ModelBuilder, x: number, z: number, s: number): void {
  m.cylinder(x, z, 0.25 * s, 0, 2.2 * s, TRUNK, 5);
  m.dome(x, z, 1.8 * s, 1.8 * s, LEAF, 2, 7);
}

function gardenexpo(m: ModelBuilder, W: number, D: number, st: Stage, r: () => number): void {
  const done = st.stage >= st.stages;
  lot(m, W, D, st.stage === 0 ? EARTH : GRASS);
  if (!done) hoarding(m, W, D);
  // Two lakes, dug first and filled later, and a loop of paths.
  const lakes: [number, number, number, number][] = [
    [-W / 4, D / 8, 18, 12],
    [W / 5, -D / 6, 14, 10],
  ];
  for (const [x, z, a, b] of lakes)
    ellipseRing(m, 0.01, 0.01, 0.1, a, b, 0.1, st.stage === 0 ? EARTH_DARK : WATER, 0, 1, 24, x, z);
  m.box(-W / 2 + 6, W / 2 - 6, 0.07, 0.12, -2, 2, PATH);
  m.box(-2, 2, 0.07, 0.12, -D / 2 + 3, D / 2 - 6, PATH);
  if (st.stage === 0) {
    crane(m, W / 2 - 14, D / 2 - 14, 24, Math.PI * 1.2);
    siteKit(m, W, D);
    return;
  }
  // Pavilions: domes, a stepped pyramid, a glass hall, a ring of arches.
  const built = st.stage === 1 ? 0.5 : 1;
  const col = (k: number) => (st.stage === 1 ? CONCRETE : PAVILION[k % PAVILION.length]!);
  m.dome(-W / 3, -D / 4, 11 * built + 3, 0, col(0), 4, 14);
  m.box(W / 4 - 10, W / 4 + 10, 0, 6 * built, D / 4 - 10, D / 4 + 10, col(1));
  m.box(W / 4 - 7, W / 4 + 7, 6 * built, 11 * built, D / 4 - 7, D / 4 + 7, col(1));
  m.box(W / 4 - 4, W / 4 + 4, 11 * built, 15 * built, D / 4 - 4, D / 4 + 4, col(1));
  m.box(
    W / 2 - 34,
    W / 2 - 12,
    0,
    10 * built,
    -D / 2 + 12,
    -D / 2 + 28,
    st.stage === 1 ? CONCRETE : GLASS_LIGHT,
  );
  m.dome(0, D / 2 - 18, 8 * built + 2, 0, col(3), 4, 12);
  // The expo spire at the crossing.
  const sh = st.stage === 1 ? 20 : 48;
  m.frustum(0, 0, 3, 0.8, 0, sh, WHITE, 8);
  if (!done) {
    crane(m, W / 2 - 14, D / 2 - 14, 30, Math.PI * 1.2);
    if (st.stage === 1) siteKit(m, W, D);
    m.height = Math.max(m.height, 34);
    if (st.stage === 1) return;
  }
  // Planting: sparse while the fair is fitted out, full when it opens.
  const n = done ? 60 : 18;
  for (let k = 0; k < n; k++) {
    const x = (r() - 0.5) * (W - 12);
    const z = (r() - 0.5) * (D - 12);
    if (Math.abs(x) < 4 || Math.abs(z) < 4) continue;
    if (lakes.some(([lx, lz, a, b]) => ((x - lx) / (a + 2)) ** 2 + ((z - lz) / (b + 2)) ** 2 < 1)) continue;
    if (r() < 0.4) m.box(x - 2, x + 2, 0.06, 0.3, z - 1.2, z + 1.2, FLOWERS[k % FLOWERS.length]!);
    else expoTree(m, x, z, 1.4 + r());
  }
  if (done) {
    for (let k = 0; k < 6; k++) {
      const x = -W / 2 + 10 + k * 6;
      m.box(x - 0.1, x + 0.1, 0, 8, -D / 2 + 4, -D / 2 + 4.2, STEEL);
      m.box(x + 0.1, x + 2.4, 6.4, 8, -D / 2 + 4, -D / 2 + 4.1, PAVILION[k % PAVILION.length]!);
    }
  }
  m.height = Math.max(m.height, 48);
}

function convention(m: ModelBuilder, W: number, D: number, st: Stage): void {
  const done = st.stage >= st.stages;
  lot(m, W, D, st.stage === 0 ? EARTH : CONCRETE);
  if (!done) hoarding(m, W, D);
  const x0 = -W / 2 + 6;
  const x1 = W / 2 - 6;
  const z0 = -D / 2 + 18;
  const z1 = D / 2 - 5;
  m.box(x0, x1, 0, 0.8, z0, z1, CONCRETE);
  if (st.stage === 0) {
    crane(m, 0, D / 2 - 10, 32, Math.PI * 1.5);
    siteKit(m, W, D);
    return;
  }
  // Steel frame (stage 1), the halls' walls (stage 2), the wave roof and glass front when done.
  const wallTop = 14;
  if (st.stage === 1) {
    for (let x = x0; x <= x1; x += 10)
      for (const z of [z0, z1]) m.box(x - 0.4, x + 0.4, 0, wallTop, z - 0.4, z + 0.4, STEEL);
    for (let x = x0; x < x1; x += 10) m.box(x, x + 10, wallTop - 0.8, wallTop, z0 - 0.3, z1 + 0.3, STEEL);
    crane(m, 0, D / 2 - 10, 36, Math.PI * 1.5);
    crane(m, x1 - 8, z0 + 8, 34, Math.PI * 0.8);
    siteKit(m, W, D);
    return;
  }
  m.box(x0, x1, 0.8, wallTop, z0 + 2, z1, CONCRETE, CONCRETE_DARK);
  m.box(x0, x1, 0.8, wallTop - 1, z0, z0 + 2, done ? GLASS : STEEL_DARK);
  // The wave roof: strips across the hall rising and falling along it.
  const n = 24;
  const wave = (i: number) => wallTop + 3 + Math.sin((i / n) * Math.PI * 3) * 2.5;
  const roofTo = done ? n : Math.floor(n * 0.5);
  for (let i = 0; i < roofTo; i++) {
    const xa = x0 - 2 + ((x1 - x0 + 4) * i) / n;
    const xb = x0 - 2 + ((x1 - x0 + 4) * (i + 1)) / n;
    const ya = wave(i);
    const yb = wave(i + 1);
    m.quad([xa, ya, z0 - 4], [xa, ya, z1 + 1], [xb, yb, z1 + 1], [xb, yb, z0 - 4], ROOF_WAVE);
    m.quad(
      [xb, yb - 0.4, z0 - 4],
      [xb, yb - 0.4, z1 + 1],
      [xa, ya - 0.4, z1 + 1],
      [xa, ya - 0.4, z0 - 4],
      STEEL,
    );
  }
  for (let x = x0; x <= x1; x += 12) m.box(x - 0.3, x + 0.3, 0, wallTop + 2, z0 - 4, z0 - 3.4, STEEL);
  if (done) {
    // Forecourt with flags.
    m.box(x0, x1, 0.06, 0.12, -D / 2 + 3, z0 - 4, C('#d8d2c4'));
    for (let k = 0; k < 8; k++) {
      const x = -24 + k * 7;
      m.box(x - 0.1, x + 0.1, 0, 9, -D / 2 + 8, -D / 2 + 8.2, STEEL);
      m.box(x + 0.1, x + 2.6, 7.2, 9, -D / 2 + 8, -D / 2 + 8.1, PAVILION[k % PAVILION.length]!);
    }
  } else {
    crane(m, x1 - 8, z0 + 8, 36, Math.PI * 0.8);
    siteKit(m, W, D);
  }
  m.height = Math.max(m.height, wallTop + 6);
}

/**
 * The model for a project at `stage` (0.. stages−1 while it's built, `stages` once it's finished).
 * Returns false for a model name that isn't a project.
 */
export function buildProjectModel(
  model: string,
  m: ModelBuilder,
  W: number,
  D: number,
  stage: number,
  stages: number,
  r: () => number,
): boolean {
  const st = { stage, stages };
  switch (model) {
    case 'stadium':
      stadium(m, W, D, st);
      return true;
    case 'launchsite':
      launchsite(m, W, D, st);
      return true;
    case 'helioarray':
      helioarray(m, W, D, st);
      return true;
    case 'gardenexpo':
      gardenexpo(m, W, D, st, r);
      return true;
    case 'convention':
      convention(m, W, D, st);
      return true;
    default:
      return false;
  }
}
