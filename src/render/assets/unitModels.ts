import { UNIT_ROLES, type BakedUnit, type UnitRole } from '../../models/baked';
import { UNIT, UNIT_DEFS, type UnitKind } from '../../data/war';
import { handmade } from './handmade';

/**
 * Generated looks for the units (phase 5, M34), in the game's toy style, built as `BakedUnit`s: the
 * same structure the hand-made units arrive in (unit spec v1, PROMPTS-WAR.md), so the renderer
 * treats both alike. Sized from each kind's `size`, the front along −z, the origin on the ground
 * under the middle (ships at the waterline); body and body_alt are painted in the owner's colours,
 * light glows at night, and the moving parts (turret, barrel, rotor, tail_rotor, propeller, wheel,
 * track_left/right, hatch, ramp, radar_dish) are parts with pivots.
 */

type V3 = [number, number, number];
type Axis = 'x' | 'y' | 'z';

const ROLE = new Map<UnitRole, number>(UNIT_ROLES.map((r, i) => [r, i]));

/** Colours the generated units give their roles (linear-ish sRGB; body and body_alt are repainted). */
export const UNIT_ROLE_COLOURS: Record<UnitRole, string> = {
  body: '#6f8a4e',
  body_alt: '#55703c',
  trim: '#efe6d2',
  metal: '#8c939a',
  rubber: '#2f3236',
  glass: '#3d5a73',
  accent: '#f0c21b',
  light: '#fff1b8',
  wood: '#a2724a',
  grass: '#7fb35a',
};

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

/**
 * A small builder for units: triangles tagged with a role, the part they move with, and whether the
 * far version keeps them. Primitives are closed and wound counter-clockwise from outside.
 */
class UnitBuilder {
  private pos: number[] = [];
  private index: number[] = [];
  private keys = new Map<string, number>();
  private roles: number[] = [];
  private partOf: number[] = [];
  private far: number[] = [];
  readonly parts: BakedUnit['parts'] = [];
  readonly muzzles: BakedUnit['muzzles'] = [];
  readonly exhausts: BakedUnit['exhausts'] = [];
  private part = 0;
  private keepFar = 1;
  role: UnitRole = 'body';

  /** Draw `fn` as a moving part: `name`, turning about `pivot`, moving with `parent` (0: the body). */
  addPart(name: string, pivot: V3, fn: () => void, parent = 0): number {
    this.parts.push({ name, parent, pivot: [...pivot] });
    const id = this.parts.length;
    const was = this.part;
    this.part = id;
    try {
      fn();
    } finally {
      this.part = was;
    }
    return id;
  }

  /** Draw `fn` in the near version only (fittings, lamps, small boxes). */
  near(fn: () => void): void {
    const was = this.keepFar;
    this.keepFar = 0;
    try {
      fn();
    } finally {
      this.keepFar = was;
    }
  }

  as(role: UnitRole, fn: () => void): void {
    const was = this.role;
    this.role = role;
    try {
      fn();
    } finally {
      this.role = was;
    }
  }

  muzzle(at: V3): void {
    this.muzzles.push({ part: this.part, at: [...at] });
  }

  exhaust(at: V3): void {
    this.exhausts.push({ part: this.part, at: [...at] });
  }

  private vert(p: V3): number {
    const k = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
    let i = this.keys.get(k);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.pos.push(p[0], p[1], p[2]);
      this.keys.set(k, i);
    }
    return i;
  }

  tri(a: V3, b: V3, c: V3): void {
    const ia = this.vert(a);
    const ib = this.vert(b);
    const ic = this.vert(c);
    if (ia === ib || ib === ic || ia === ic) return;
    this.index.push(ia, ib, ic);
    this.roles.push(ROLE.get(this.role)!);
    this.partOf.push(this.part);
    this.far.push(this.keepFar);
  }

  /** A quad a-b-c-d, counter-clockwise from the side it faces. */
  quad(a: V3, b: V3, c: V3, d: V3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** A flat quad (a pane on a face) wound so it faces along `out`. */
  pane(a: V3, b: V3, c: V3, d: V3, out: V3): void {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    if (n[0]! * out[0] + n[1]! * out[1] + n[2]! * out[2] >= 0) this.quad(a, b, c, d);
    else this.quad(a, d, c, b);
  }

  /** Closed shapes drawn inside out (tests: there should be none). */
  readonly flipped: string[] = [];

  /** Note a closed shape whose triangles from `start` enclose a negative volume. */
  private closed(start: number, what: string): void {
    if (this.volumeFrom(start) < -1e-9) this.flipped.push(`${what} #${start / 3}`);
  }

  /**
   * A hexahedron from its eight corners in box order: (x0 y0 z0), (x1 y0 z0), (x1 y1 z0), (x0 y1 z0),
   * then the same at z1. Corners may be moved (tapered hulls, sloped fronts, swept wings).
   */
  hexa(c: V3[], bottom = true): void {
    const [c0, c1, c2, c3, c4, c5, c6, c7] = c as [V3, V3, V3, V3, V3, V3, V3, V3];
    const start = this.index.length;
    this.quad(c3, c7, c6, c2); // top
    this.quad(c0, c3, c2, c1); // front (−z)
    this.quad(c5, c6, c7, c4); // back (+z)
    this.quad(c4, c7, c3, c0); // left (−x)
    this.quad(c1, c2, c6, c5); // right (+x)
    if (bottom) this.quad(c0, c1, c5, c4);
    if (bottom) this.closed(start, 'hexa');
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, bottom = true): void {
    this.hexa(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      bottom,
    );
  }

  /**
   * A body of revolution along `axis` through `c`: `profile` is [t, r] pairs from one end to the
   * other (t along the axis from c); a radius of 0 closes an end to a point, and open ends are
   * capped. `sx`, `sy` stretch the cross-section (the axis's first and second perpendiculars).
   */
  lathe(axis: Axis, c: V3, profile: [number, number][], sides: number, sx = 1, sy = 1, turn = 0): void {
    const start = this.index.length;
    // Perpendicular directions u, v with u × v = the axis, so the winding comes out outward.
    const a: V3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    const u: V3 = axis === 'x' ? [0, 1, 0] : axis === 'y' ? [0, 0, 1] : [1, 0, 0];
    const v: V3 = axis === 'x' ? [0, 0, 1] : axis === 'y' ? [1, 0, 0] : [0, 1, 0];
    const at = (t: number, r: number, k: number): V3 => {
      const ang = (k / sides) * Math.PI * 2 + turn;
      const cu = Math.cos(ang) * r * sx;
      const cv = Math.sin(ang) * r * sy;
      return [
        c[0] + a[0] * t + u[0] * cu + v[0] * cv,
        c[1] + a[1] * t + u[1] * cu + v[1] * cv,
        c[2] + a[2] * t + u[2] * cu + v[2] * cv,
      ];
    };
    for (let i = 0; i < profile.length - 1; i++) {
      const [t0, r0] = profile[i]!;
      const [t1, r1] = profile[i + 1]!;
      for (let k = 0; k < sides; k++) {
        // Going round from u to v is counter-clockwise seen from +axis; along the axis t0 → t1.
        const p00 = at(t0, r0, k);
        const p01 = at(t0, r0, k + 1);
        const p10 = at(t1, r1, k);
        const p11 = at(t1, r1, k + 1);
        if (r0 < 1e-6) this.tri(p00, p11, p10);
        else if (r1 < 1e-6) this.tri(p00, p01, p10);
        else this.quad(p00, p01, p11, p10);
      }
    }
    const [tf, rf] = profile[0]!;
    const [tl, rl] = profile[profile.length - 1]!;
    const sign = tl >= tf ? 1 : -1;
    if (rf > 1e-6) {
      const centre: V3 = [c[0] + a[0] * tf, c[1] + a[1] * tf, c[2] + a[2] * tf];
      for (let k = 0; k < sides; k++)
        if (sign > 0) this.tri(centre, at(tf, rf, k + 1), at(tf, rf, k));
        else this.tri(centre, at(tf, rf, k), at(tf, rf, k + 1));
    }
    if (rl > 1e-6) {
      const centre: V3 = [c[0] + a[0] * tl, c[1] + a[1] * tl, c[2] + a[2] * tl];
      for (let k = 0; k < sides; k++)
        if (sign > 0) this.tri(centre, at(tl, rl, k), at(tl, rl, k + 1));
        else this.tri(centre, at(tl, rl, k + 1), at(tl, rl, k));
    }
    this.closed(start, 'lathe');
  }

  /** A cylinder along `axis` centred on c, length `len`. */
  cyl(axis: Axis, c: V3, r: number, len: number, sides = 8, turn = 0): void {
    this.lathe(
      axis,
      c,
      [
        [-len / 2, r],
        [len / 2, r],
      ],
      sides,
      1,
      1,
      turn,
    );
  }

  /** A dome on the plane y = c[1], radius r, height h (squashed with sx, sz). */
  dome(c: V3, r: number, h: number, sides = 10, rings = 3, sx = 1, sz = 1): void {
    const prof: [number, number][] = [];
    for (let i = 0; i <= rings; i++) {
      const t = (i / rings) * (Math.PI / 2);
      prof.push([Math.sin(t) * h, Math.cos(t) * r]);
    }
    prof[prof.length - 1]![1] = 0;
    // Along y: u is z and v is x, so stretch accordingly.
    this.lathe('y', c, prof, sides, sz, sx);
  }

  /** A beam of square section from a to b. */
  beam(a: V3, b: V3, t: number): void {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d) || 1;
    const n: V3 = [d[0] / len, d[1] / len, d[2] / len];
    const up: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const cr = (p: V3, q: V3): V3 => [
      p[1] * q[2] - p[2] * q[1],
      p[2] * q[0] - p[0] * q[2],
      p[0] * q[1] - p[1] * q[0],
    ];
    const nz = (p: V3): V3 => {
      const l = Math.hypot(...p) || 1;
      return [p[0] / l, p[1] / l, p[2] / l];
    };
    const u = nz(cr(up, n));
    const v = cr(n, u);
    const h = t / 2;
    const P = (o: V3, su: number, sv: number): V3 => [
      o[0] + (u[0] * su + v[0] * sv) * h,
      o[1] + (u[1] * su + v[1] * sv) * h,
      o[2] + (u[2] * su + v[2] * sv) * h,
    ];
    // Local frame (u, v, n) is right-handed: the corners in box order with x → u, y → v, z → n.
    this.hexa([
      P(a, -1, -1),
      P(a, 1, -1),
      P(a, 1, 1),
      P(a, -1, 1),
      P(b, -1, -1),
      P(b, 1, -1),
      P(b, 1, 1),
      P(b, -1, 1),
    ]);
  }

  /** Signed volume of what has been drawn: positive when every closed shape is wound outward. */
  volume(): number {
    return this.volumeFrom(0);
  }

  private volumeFrom(start: number): number {
    let v = 0;
    const p = this.pos;
    for (let i = start; i < this.index.length; i += 3) {
      const a = this.index[i]! * 3;
      const b = this.index[i + 1]! * 3;
      const c = this.index[i + 2]! * 3;
      v +=
        (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
          p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
          p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) /
        6;
    }
    return v;
  }

  build(id: string, kind: string): BakedUnit {
    const pos = new Float32Array(this.pos);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      x0 = Math.min(x0, pos[i]!);
      x1 = Math.max(x1, pos[i]!);
      y0 = Math.min(y0, pos[i + 1]!);
      y1 = Math.max(y1, pos[i + 1]!);
      z0 = Math.min(z0, pos[i + 2]!);
      z1 = Math.max(z1, pos[i + 2]!);
    }
    const colors: Record<number, [number, number, number]> = {};
    for (const r of new Set(this.roles)) colors[r] = hexLinear(UNIT_ROLE_COLOURS[UNIT_ROLES[r]!]);
    const tris = this.roles.length;
    const far = this.far.reduce((s, f) => s + f, 0);
    return {
      id,
      kind,
      size: [z1 - z0, x1 - x0, y1],
      depth: Math.max(0, -y0),
      positions: pos,
      index: new Uint32Array(this.index),
      triRole: new Uint8Array(this.roles),
      triPart: new Uint8Array(this.partOf),
      triFar: new Uint8Array(this.far),
      colors,
      parts: this.parts,
      muzzles: this.muzzles,
      exhausts: this.exhausts,
      counts: { file: tris, near: tris, far },
    };
  }
}

// ------------------------------------------------------------------ land

function infantry(b: UnitBuilder): void {
  // Four chunky toy soldiers on one round base, like a board-game piece.
  b.as('metal', () =>
    b.lathe(
      'y',
      [0, 0, 0],
      [
        [0, 1.95],
        [0.3, 1.95],
      ],
      12,
    ),
  );
  for (const [x, z] of [
    [-0.85, -0.85],
    [0.85, -0.85],
    [-0.85, 0.85],
    [0.85, 0.85],
  ] as const) {
    const y = 0.3;
    // Legs, a rounded body (the uniform), a head and a helmet.
    b.near(() => {
      b.box(x - 0.36, x - 0.06, y, y + 0.55, z - 0.17, z + 0.17);
      b.box(x + 0.06, x + 0.36, y, y + 0.55, z - 0.17, z + 0.17);
    });
    b.lathe(
      'y',
      [x, y + 0.5, z],
      [
        [0, 0.42],
        [0.55, 0.5],
        [0.95, 0.36],
      ],
      6,
    );
    b.as('trim', () =>
      b.lathe(
        'y',
        [x, y + 1.42, z],
        [
          [0, 0.27],
          [0.4, 0.27],
          [0.5, 0],
        ],
        6,
      ),
    );
    b.as('body_alt', () => b.dome([x, y + 1.62, z], 0.36, 0.3, 6, 2));
    // A stubby chunky rifle held across the chest.
    b.near(() => b.as('metal', () => b.box(x - 0.48, x + 0.48, y + 1, y + 1.3, z - 0.62, z - 0.34)));
  }
}

/** Road wheels along a tracked hull's side, each its own part (they roll). */
function roadWheels(b: UnitBuilder, x: number, y: number, zs: number[], r: number): void {
  for (const z of zs)
    b.addPart('wheel', [x, y, z], () => b.as('metal', () => b.cyl('x', [x, y, z], r, 0.28, 8)));
}

/** A track: a long rubber block with sloped ends, its own part. */
function track(
  b: UnitBuilder,
  name: string,
  x0: number,
  x1: number,
  h: number,
  half: number,
  slope: number,
): void {
  b.addPart(name, [(x0 + x1) / 2, h / 2, 0], () =>
    b.as('rubber', () =>
      b.hexa([
        [x0, 0, -half + slope],
        [x1, 0, -half + slope],
        [x1, h, -half],
        [x0, h, -half],
        [x0, 0, half - slope],
        [x1, 0, half - slope],
        [x1, h, half],
        [x0, h, half],
      ]),
    ),
  );
}

function tank(b: UnitBuilder): void {
  const L = 7;
  track(b, 'track_left', -1.62, -1.05, 1.15, L / 2, 0.6);
  track(b, 'track_right', 1.05, 1.62, 1.15, L / 2, 0.6);
  roadWheels(b, -1.68, 0.55, [-2.2, -0.75, 0.75, 2.2], 0.48);
  roadWheels(b, 1.68, 0.55, [-2.2, -0.75, 0.75, 2.2], 0.48);
  // A rounded hull with a sloped front, and mudguards over the tracks.
  b.hexa([
    [-1.1, 0.45, -3.2],
    [1.1, 0.45, -3.2],
    [1.1, 1.55, -2.5],
    [-1.1, 1.55, -2.5],
    [-1.1, 0.45, 3.3],
    [1.1, 0.45, 3.3],
    [1.1, 1.6, 3.1],
    [-1.1, 1.6, 3.1],
  ]);
  for (const s of [-1, 1]) b.box(s > 0 ? 1.0 : -1.85, s > 0 ? 1.85 : -1.0, 1.15, 1.35, -3.4, 3.4);
  b.near(() => {
    b.as('light', () => {
      b.box(-0.85, -0.45, 1.15, 1.45, -2.85, -2.62);
      b.box(0.45, 0.85, 1.15, 1.45, -2.85, -2.62);
    });
    b.as('metal', () => b.cyl('z', [0.7, 1.5, 3.25], 0.2, 0.3, 6));
    b.exhaust([0.7, 1.5, 3.45]);
  });
  // A round dome turret with a short, thick barrel and a hatch on top.
  const tp: V3 = [0, 1.55, 0.2];
  const turret = b.addPart('turret', tp, () => {
    b.lathe(
      'y',
      [0, 1.55, 0.2],
      [
        [0, 1.35],
        [0.35, 1.35],
      ],
      12,
    );
    b.as('body_alt', () => b.dome([0, 1.9, 0.2], 1.35, 0.85, 12, 3));
  });
  b.addPart(
    'barrel',
    [0, 2.1, -0.9],
    () => {
      b.as('metal', () => {
        b.cyl('z', [0, 2.1, -2.0], 0.24, 2.4, 8);
        b.cyl('z', [0, 2.1, -3.25], 0.33, 0.5, 8);
      });
      b.muzzle([0, 2.1, -3.55]);
    },
    turret,
  );
  b.addPart(
    'hatch',
    [0.45, 2.72, 0.75],
    () => b.near(() => b.as('body', () => b.cyl('y', [0.45, 2.72, 0.75], 0.42, 0.14, 8))),
    turret,
  );
}

function heavytank(b: UnitBuilder): void {
  const L = 9;
  track(b, 'track_left', -2.2, -1.35, 1.3, L / 2, 0.7);
  track(b, 'track_right', 1.35, 2.2, 1.3, L / 2, 0.7);
  // A wide blocky hull with armoured skirts over the tracks.
  b.hexa([
    [-1.4, 0.5, -4.1],
    [1.4, 0.5, -4.1],
    [1.4, 1.75, -3.4],
    [-1.4, 1.75, -3.4],
    [-1.4, 0.5, 4.3],
    [1.4, 0.5, 4.3],
    [1.4, 1.8, 4.2],
    [-1.4, 1.8, 4.2],
  ]);
  b.as('body_alt', () => {
    for (const s of [-1, 1]) {
      const xa = s > 0 ? 1.3 : -2.25;
      const xb = s > 0 ? 2.25 : -1.3;
      b.hexa([
        [xa, 0.55, -4.2],
        [xb, 0.55, -4.2],
        [xb, 1.6, -4.45],
        [xa, 1.6, -4.45],
        [xa, 0.55, 4.3],
        [xb, 0.55, 4.3],
        [xb, 1.6, 4.45],
        [xa, 1.6, 4.45],
      ]);
    }
  });
  b.near(() => {
    b.as('wood', () => {
      b.box(-1.3, -0.2, 1.8, 2.35, 3.2, 4.1);
      b.box(0.2, 1.3, 1.8, 2.35, 3.2, 4.1);
    });
    b.as('light', () => {
      b.box(-1.15, -0.75, 1.3, 1.55, -3.82, -3.62);
      b.box(0.75, 1.15, 1.3, 1.55, -3.82, -3.62);
    });
  });
  b.as('metal', () => b.box(-1.2, -0.7, 1.8, 2.5, 2.4, 2.9));
  b.exhaust([-0.95, 2.6, 2.65]);
  // A large boxy turret with a long, thick barrel.
  const turret = b.addPart('turret', [0, 1.75, 0.4], () => {
    b.hexa([
      [-1.55, 1.75, -1.3],
      [1.55, 1.75, -1.3],
      [1.25, 3.0, -0.9],
      [-1.25, 3.0, -0.9],
      [-1.6, 1.75, 2.2],
      [1.6, 1.75, 2.2],
      [1.4, 3.0, 2.0],
      [-1.4, 3.0, 2.0],
    ]);
    b.as('body_alt', () => b.box(-0.9, 0.9, 3.0, 3.2, -0.4, 1.4));
  });
  b.addPart(
    'barrel',
    [0, 2.35, -1.2],
    () => {
      b.as('metal', () => {
        b.cyl('z', [0, 2.35, -2.95], 0.26, 3.5, 8);
        b.cyl('z', [0, 2.35, -4.55], 0.36, 0.5, 8);
      });
      b.muzzle([0, 2.35, -4.85]);
    },
    turret,
  );
  b.addPart(
    'hatch',
    [0.55, 3.25, 0.9],
    () => b.near(() => b.cyl('y', [0.55, 3.25, 0.9], 0.42, 0.12, 8)),
    turret,
  );
}

/** A truck's wheels on two or three axles, each wheel its own part. */
function truckWheels(b: UnitBuilder, x: number, r: number, zs: number[]): void {
  for (const z of zs)
    for (const s of [-1, 1])
      b.addPart('wheel', [s * x, r, z], () =>
        b.as('rubber', () => {
          b.cyl('x', [s * x, r, z], r, 0.55, 10);
          b.near(() => b.as('metal', () => b.cyl('x', [s * (x + 0.2), r, z], r * 0.45, 0.2, 6)));
        }),
      );
}

/** A truck's cab at the front: rounded box with big windows and lamps. */
function cab(b: UnitBuilder, z0: number, z1: number, w: number, y0: number, h: number): void {
  b.hexa([
    [-w, y0, z0 + 0.2],
    [w, y0, z0 + 0.2],
    [w * 0.92, y0 + h, z0 + 0.7],
    [-w * 0.92, y0 + h, z0 + 0.7],
    [-w, y0, z1],
    [w, y0, z1],
    [w * 0.92, y0 + h, z1],
    [-w * 0.92, y0 + h, z1],
  ]);
  b.as('glass', () => {
    // Windscreen (sloped, standing proud of the front) and side windows.
    const t = 0.06;
    b.pane(
      [-w * 0.8, y0 + h * 0.5, z0 + 0.45 - t],
      [w * 0.8, y0 + h * 0.5, z0 + 0.45 - t],
      [w * 0.76, y0 + h * 0.9, z0 + 0.66 - t],
      [-w * 0.76, y0 + h * 0.9, z0 + 0.66 - t],
      [0, 0.4, -1],
    );
    for (const s of [-1, 1]) {
      const x = s * (w * 0.96 + t);
      b.pane(
        [x, y0 + h * 0.5, z0 + 0.9],
        [x, y0 + h * 0.5, z1 - 0.3],
        [x, y0 + h * 0.88, z1 - 0.3],
        [x, y0 + h * 0.88, z0 + 0.9],
        [s, 0, 0],
      );
    }
  });
  b.near(() =>
    b.as('light', () => {
      b.box(-w + 0.15, -w + 0.55, y0 + 0.25, y0 + 0.55, z0 + 0.05, z0 + 0.25);
      b.box(w - 0.55, w - 0.15, y0 + 0.25, y0 + 0.55, z0 + 0.05, z0 + 0.25);
    }),
  );
}

function artillery(b: UnitBuilder): void {
  // A six-wheeled truck body: chassis, a cab at the front, the gun's deck behind.
  truckWheels(b, 1.2, 0.62, [-2.6, 0.9, 2.5]);
  b.as('metal', () => b.box(-1.1, 1.1, 0.6, 1.1, -3.6, 3.7));
  cab(b, -4, -1.6, 1.42, 1.1, 1.75);
  b.box(-1.42, 1.42, 1.1, 1.65, -1.6, 3.9);
  // Stabiliser feet folded at its sides.
  b.near(() =>
    b.as('accent', () => {
      for (const s of [-1, 1]) b.box(s > 0 ? 1.42 : -1.6, s > 0 ? 1.6 : -1.42, 0.9, 1.55, 2.7, 3.7);
    }),
  );
  // The big gun on a turning mount at the back, its barrel raised at about 30 degrees.
  const tp: V3 = [0, 1.65, 1.6];
  const turret = b.addPart('turret', tp, () => {
    b.as('body_alt', () => {
      b.lathe(
        'y',
        tp,
        [
          [0, 1.25],
          [0.45, 1.25],
        ],
        10,
      );
      b.hexa([
        [-1.0, 2.1, 0.4],
        [1.0, 2.1, 0.4],
        [0.85, 2.95, 0.8],
        [-0.85, 2.95, 0.8],
        [-1.0, 2.1, 2.7],
        [1.0, 2.1, 2.7],
        [0.85, 2.95, 2.5],
        [-0.85, 2.95, 2.5],
      ]);
    });
  });
  const pivot: V3 = [0, 2.2, 0.6];
  const lift = (30 * Math.PI) / 180;
  const along = (d: number): V3 => [0, pivot[1] + Math.sin(lift) * d, pivot[2] - Math.cos(lift) * d];
  b.addPart(
    'barrel',
    pivot,
    () => {
      b.as('metal', () => {
        b.beam(along(-0.4), along(2.3), 0.42);
        b.beam(along(2.1), along(2.5), 0.6);
      });
      b.muzzle(along(2.65));
    },
    turret,
  );
}

function transport(b: UnitBuilder): void {
  truckWheels(b, 1.15, 0.6, [-2.5, 1.4, 2.9]);
  b.as('metal', () => b.box(-1.05, 1.05, 0.55, 1.05, -3.8, 3.9));
  cab(b, -4, -1.7, 1.45, 1.05, 1.75);
  // The cargo bed under a rounded canvas cover, and a tailgate.
  b.box(-1.5, 1.5, 1.05, 1.45, -1.6, 4);
  b.as('body_alt', () => {
    b.box(-1.45, 1.45, 1.45, 2.55, -1.5, 3.85);
    b.lathe(
      'z',
      [0, 2.55, 0],
      [
        [-1.5, 1.45],
        [3.85, 1.45],
      ],
      8,
      1,
      0.55,
      0,
    );
  });
  b.near(() => b.box(-1.5, 1.5, 1.2, 2.2, 3.95, 4.05));
}

function repair(b: UnitBuilder): void {
  truckWheels(b, 1.15, 0.58, [-2.2, 2.2]);
  b.as('metal', () => b.box(-1.05, 1.05, 0.5, 1.0, -3.4, 3.5));
  cab(b, -3.5, -1.3, 1.45, 1.0, 1.85);
  // An orange beacon on the cab roof.
  b.as('light', () => b.box(-0.45, 0.45, 2.85, 3.25, -2.55, -2.05));
  // The flatbed with big toolboxes and a chunky folding crane arm.
  b.as('metal', () => b.box(-1.5, 1.5, 1.0, 1.35, -1.2, 3.5));
  b.as('body_alt', () => {
    b.box(-1.45, -0.6, 1.35, 2.2, -1.1, 1.6);
    b.box(0.6, 1.45, 1.35, 2.2, -1.1, 1.6);
  });
  const cp: V3 = [0, 1.35, 2.6];
  b.addPart('crane', cp, () =>
    b.as('accent', () => {
      b.lathe(
        'y',
        cp,
        [
          [0, 0.75],
          [0.6, 0.75],
        ],
        8,
      );
      b.beam([0, 2.0, 2.6], [0, 3.4, 1.0], 0.55);
      b.beam([0, 3.4, 1.0], [0, 2.4, -1.0], 0.45);
      b.near(() => b.as('metal', () => b.box(-0.2, 0.2, 1.6, 2.4, -1.2, -0.8)));
    }),
  );
}

// ------------------------------------------------------------------ air

function fighter(b: UnitBuilder): void {
  const y = 1.75;
  // A rounded fuselage, nose cone and bubble canopy.
  b.lathe(
    'z',
    [0, y, 0],
    [
      [-6.5, 0],
      [-5.4, 0.55],
      [-3.6, 0.95],
      [3.5, 0.95],
      [5.6, 0.6],
      [6.2, 0.45],
    ],
    10,
    1.05,
    1,
  );
  b.as('body_alt', () =>
    b.lathe(
      'z',
      [0, y, 0],
      [
        [-6.55, 0],
        [-5.9, 0.4],
        [-5.35, 0.58],
        [-5.3, 0],
      ],
      10,
    ),
  );
  b.as('glass', () => b.dome([0, y + 0.6, -2.6], 0.6, 0.65, 8, 2, 1, 2.6));
  // Swept wings and twin tail fins.
  const wing = (s: number) => {
    const r0 = s * 0.8;
    const r1 = s * 6;
    const pts: V3[] = [
      [r0, y - 0.2, -1.6],
      [r1, y - 0.1, 2.0],
      [r1, y + 0.05, 2.0],
      [r0, y + 0.15, -1.6],
      [r0, y - 0.2, 2.6],
      [r1, y - 0.1, 3.0],
      [r1, y + 0.05, 3.0],
      [r0, y + 0.15, 2.6],
    ];
    if (s < 0) b.hexa([pts[1]!, pts[0]!, pts[3]!, pts[2]!, pts[5]!, pts[4]!, pts[7]!, pts[6]!]);
    else b.hexa(pts);
  };
  wing(-1);
  wing(1);
  b.as('body_alt', () => {
    for (const s of [-1, 1]) {
      const x = s * 0.75;
      b.hexa([
        [x - 0.15, y + 0.6, 3.6],
        [x + 0.15, y + 0.6, 3.6],
        [x + 0.12 + s * 0.5, y + 2.2, 5.0],
        [x - 0.12 + s * 0.5, y + 2.2, 5.0],
        [x - 0.15, y + 0.6, 5.9],
        [x + 0.15, y + 0.6, 5.9],
        [x + 0.12 + s * 0.5, y + 2.2, 6.0],
        [x - 0.12 + s * 0.5, y + 2.2, 6.0],
      ]);
    }
    // Tailplanes.
    for (const s of [-1, 1]) b.box(s > 0 ? 0.8 : -2.9, s > 0 ? 2.9 : -0.8, y - 0.15, y + 0.05, 4.6, 5.9);
  });
  // Two chunky engine intakes.
  b.as('metal', () => {
    for (const s of [-1, 1]) b.box(s > 0 ? 0.85 : -1.45, s > 0 ? 1.45 : -0.85, y - 0.6, y + 0.3, -2.4, 1.2);
    b.lathe(
      'z',
      [0, y, 0],
      [
        [6.15, 0.5],
        [6.6, 0.42],
      ],
      10,
    );
  });
  b.exhaust([0, y, 6.7]);
  for (const s of [-1, 1]) b.muzzle([s * 1.15, y - 0.15, -2.6]);
  // Three landing wheels on short, thick legs.
  b.near(() =>
    b.as('metal', () => {
      b.box(-0.15, 0.15, 0.5, y - 0.6, -4.2, -3.9);
      for (const s of [-1, 1]) b.box(s * 1.6 - 0.15, s * 1.6 + 0.15, 0.5, y - 0.2, 1.0, 1.3);
    }),
  );
  for (const [x, z] of [
    [0, -4.05],
    [-1.6, 1.15],
    [1.6, 1.15],
  ] as const)
    b.addPart('wheel', [x, 0.42, z], () => b.as('rubber', () => b.cyl('x', [x, 0.42, z], 0.42, 0.35, 8)));
}

function bomber(b: UnitBuilder): void {
  const y = 2.6;
  // A fat round fuselage with a glass nose.
  b.lathe(
    'z',
    [0, y, 0],
    [
      [-9.6, 0.9],
      [-8.4, 1.6],
      [-5, 1.9],
      [4, 1.75],
      [8.6, 0.8],
      [10, 0.45],
    ],
    12,
  );
  b.as('glass', () =>
    b.lathe(
      'z',
      [0, y, 0],
      [
        [-10, 0],
        [-9.7, 0.7],
        [-9.55, 0.92],
      ],
      12,
    ),
  );
  // Straight wings, four engines with a propeller each.
  b.hexa([
    [-13, y + 0.2, -2.2],
    [13, y + 0.2, -2.2],
    [13, y + 0.55, -2.2],
    [-13, y + 0.55, -2.2],
    [-13, y + 0.2, 1.2],
    [13, y + 0.2, 1.2],
    [13, y + 0.55, 1.2],
    [-13, y + 0.55, 1.2],
  ]);
  for (const x of [-8.6, -4.4, 4.4, 8.6]) {
    b.as('metal', () =>
      b.lathe(
        'z',
        [x, y + 0.1, 0],
        [
          [-3.2, 0.45],
          [-2.6, 0.75],
          [1.6, 0.6],
          [2.4, 0],
        ],
        8,
      ),
    );
    b.addPart('propeller', [x, y + 0.1, -3.35], () =>
      b.as('metal', () => {
        b.lathe(
          'z',
          [x, y + 0.1, -3.35],
          [
            [-0.5, 0],
            [-0.2, 0.3],
            [0.15, 0.3],
          ],
          6,
        );
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.3;
          b.beam([x, y + 0.1, -3.3], [x + Math.cos(a) * 1.7, y + 0.1 + Math.sin(a) * 1.7, -3.3], 0.42);
        }
      }),
    );
  }
  // A twin tail.
  b.as('body_alt', () => {
    b.box(-4.2, 4.2, y + 0.6, y + 0.9, 7.4, 9.8);
    for (const s of [-1, 1])
      b.hexa([
        [s * 4 - 0.2, y + 0.6, 7.6],
        [s * 4 + 0.2, y + 0.6, 7.6],
        [s * 4 + 0.2, y + 2.4, 8.6],
        [s * 4 - 0.2, y + 2.4, 8.6],
        [s * 4 - 0.2, y + 0.6, 9.9],
        [s * 4 + 0.2, y + 0.6, 9.9],
        [s * 4 + 0.2, y + 2.4, 10],
        [s * 4 - 0.2, y + 2.4, 10],
      ]);
  });
  // The bomb-bay door underneath, and landing wheels.
  b.addPart('hatch', [0, y - 1.75, -1.5], () =>
    b.as('body_alt', () => b.box(-0.9, 0.9, y - 1.95, y - 1.75, -3.2, 0.2)),
  );
  b.near(() =>
    b.as('metal', () => {
      for (const s of [-1, 1]) b.box(s * 4.4 - 0.2, s * 4.4 + 0.2, 0.7, y - 0.3, -0.6, -0.2);
      b.box(-0.15, 0.15, 0.4, y - 1.8, 8.2, 8.5);
    }),
  );
  for (const [x, z, r] of [
    [-4.4, -0.4, 0.7],
    [4.4, -0.4, 0.7],
    [0, 8.35, 0.4],
  ] as const)
    b.addPart('wheel', [x, r, z], () => b.as('rubber', () => b.cyl('x', [x, r, z], r, 0.5, 8)));
}

function helicopter(b: UnitBuilder): void {
  // A rounded cabin with big windows, on skids.
  b.lathe(
    'z',
    [0, 1.9, 0],
    [
      [-3.4, 0],
      [-3.0, 0.85],
      [-1.8, 1.25],
      [1.0, 1.2],
      [2.0, 0.8],
    ],
    10,
    1,
    1.05,
  );
  b.as('glass', () => {
    b.lathe(
      'z',
      [0, 2.15, 0],
      [
        [-3.45, 0],
        [-3.15, 0.75],
        [-2.4, 0.95],
        [-2.3, 0],
      ],
      10,
      1.02,
      0.85,
    );
    for (const s of [-1, 1]) b.box(s > 0 ? 1.18 : -1.24, s > 0 ? 1.24 : -1.18, 1.95, 2.6, -1.6, 0.2);
  });
  // A tail boom with a fin and a small tail rotor.
  b.lathe(
    'z',
    [0, 2.1, 0],
    [
      [1.8, 0.65],
      [7.2, 0.28],
    ],
    8,
  );
  b.as('body_alt', () =>
    b.hexa([
      [-0.12, 2.2, 6.4],
      [0.12, 2.2, 6.4],
      [0.12, 3.6, 7.1],
      [-0.12, 3.6, 7.1],
      [-0.12, 2.2, 7.4],
      [0.12, 2.2, 7.4],
      [0.12, 3.6, 7.6],
      [-0.12, 3.6, 7.6],
    ]),
  );
  b.addPart('tail_rotor', [0.35, 2.7, 7.0], () =>
    b.as('metal', () => {
      b.cyl('x', [0.35, 2.7, 7.0], 0.25, 0.25, 6);
      b.beam([0.35, 1.6, 7.0], [0.35, 3.8, 7.0], 0.32);
    }),
  );
  // Stubby side pods with rocket racks.
  b.as('body_alt', () => {
    for (const s of [-1, 1]) {
      b.box(s > 0 ? 1.1 : -2.0, s > 0 ? 2.0 : -1.1, 1.5, 1.75, -0.8, 0.4);
      b.lathe(
        'z',
        [s * 2.2, 1.45, -0.2],
        [
          [-1.3, 0.2],
          [-1.1, 0.42],
          [1.0, 0.42],
        ],
        8,
      );
      b.muzzle([s * 2.2, 1.45, -1.55]);
    }
  });
  b.as('metal', () => {
    for (const s of [-1, 1]) {
      b.box(s * 1.2 - 0.17, s * 1.2 + 0.17, 0, 0.32, -2.6, 2.0);
      b.box(s * 1.2 - 0.15, s * 1.2 + 0.15, 0.3, 0.95, -1.4, -1.1);
      b.box(s * 1.2 - 0.15, s * 1.2 + 0.15, 0.3, 0.95, 0.8, 1.1);
    }
    b.lathe(
      'y',
      [0, 3.1, -0.4],
      [
        [0, 0.5],
        [0.6, 0.38],
      ],
      8,
    );
  });
  // The four-blade main rotor on its hub.
  const hub: V3 = [0, 3.95, -0.4];
  b.addPart('rotor', hub, () =>
    b.as('metal', () => {
      b.cyl('y', hub, 0.42, 0.4, 8);
      for (let k = 0; k < 4; k++) {
        // At rest one blade points forward, so the length counts the rotor (as the prompt does).
        const a = (k / 4) * Math.PI * 2 - Math.PI / 2;
        const tip: V3 = [hub[0] + Math.cos(a) * 6, hub[1] + 0.05, hub[2] + Math.sin(a) * 6];
        // Across the blade, so (across, up, along) is right-handed.
        const ux = Math.sin(a) * 0.24;
        const uz = -Math.cos(a) * 0.24;
        b.hexa([
          [hub[0] - ux, hub[1] - 0.08, hub[2] - uz],
          [hub[0] + ux, hub[1] - 0.08, hub[2] + uz],
          [hub[0] + ux, hub[1] + 0.08, hub[2] + uz],
          [hub[0] - ux, hub[1] + 0.08, hub[2] - uz],
          [tip[0] - ux, tip[1] - 0.08, tip[2] - uz],
          [tip[0] + ux, tip[1] - 0.08, tip[2] + uz],
          [tip[0] + ux, tip[1] + 0.08, tip[2] + uz],
          [tip[0] - ux, tip[1] + 0.08, tip[2] - uz],
        ]);
      }
    }),
  );
  b.as('light', () => b.near(() => b.box(-0.2, 0.2, 1.0, 1.25, -3.2, -2.95)));
}

function drone(b: UnitBuilder): void {
  // A rounded central body, a camera ball underneath, four arms, four propellers, four feet.
  b.lathe(
    'y',
    [0, 0.38, 0],
    [
      [0, 0.42],
      [0.18, 0.58],
      [0.38, 0.5],
      [0.5, 0],
    ],
    8,
  );
  b.as('glass', () =>
    b.lathe(
      'y',
      [0, 0.38, 0],
      [
        [-0.28, 0],
        [-0.2, 0.2],
        [0, 0.24],
      ],
      6,
    ),
  );
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const tip: V3 = [sx * 1.05, 0.62, sz * 1.05];
    b.as('body_alt', () => {
      b.beam([sx * 0.3, 0.6, sz * 0.3], tip, 0.3);
      b.lathe(
        'y',
        [tip[0], 0.55, tip[2]],
        [
          [0, 0.22],
          [0.3, 0.22],
        ],
        6,
      );
    });
    b.near(() =>
      b.as('metal', () => b.box(sx * 0.55 - 0.1, sx * 0.55 + 0.1, 0, 0.42, sz * 0.55 - 0.1, sz * 0.55 + 0.1)),
    );
    const hub: V3 = [tip[0], 0.92, tip[2]];
    b.addPart('propeller', hub, () =>
      b.as('metal', () => {
        b.box(hub[0] - 0.12, hub[0] + 0.12, 0.86, 0.98, hub[2] - 0.45, hub[2] + 0.45);
        b.box(hub[0] - 0.45, hub[0] + 0.45, 0.87, 0.97, hub[2] - 0.12, hub[2] + 0.12);
      }),
    );
  }
  b.as('light', () => b.near(() => b.box(-0.12, 0.12, 0.56, 0.72, -0.58, -0.5)));
}

// ------------------------------------------------------------------ sea

/** A ship's hull: pointed bow at −z, from `keel` below the waterline to `deck` above. */
function hull(b: UnitBuilder, L: number, B: number, keel: number, deck: number, bowLen: number): void {
  const hb = B / 2;
  const z0 = -L / 2;
  const z1 = L / 2;
  const zb = z0 + bowLen;
  // Below the waterline (metal), then the topsides (body), each a pointed-bow prism.
  const prism = (y0: number, y1: number, w0: number, w1: number) => {
    // The main box from the bow shoulders back.
    b.hexa([
      [-w0, y0, zb],
      [w0, y0, zb],
      [w1, y1, zb],
      [-w1, y1, zb],
      [-w0, y0, z1 - 0.2],
      [w0, y0, z1 - 0.2],
      [w1, y1, z1],
      [-w1, y1, z1],
    ]);
    // The bow wedge.
    b.hexa([
      [-0.05, y0, z0 + (y0 < 0 ? 0.6 : 0)],
      [0.05, y0, z0 + (y0 < 0 ? 0.6 : 0)],
      [0.05, y1, z0],
      [-0.05, y1, z0],
      [-w0, y0, zb],
      [w0, y0, zb],
      [w1, y1, zb],
      [-w1, y1, zb],
    ]);
  };
  b.as('metal', () => prism(keel, 0, hb * 0.55, hb * 0.92));
  prism(0, deck, hb * 0.92, hb);
}

function patrolboat(b: UnitBuilder): void {
  hull(b, 18, 5, -1.5, 1.6, 5.5);
  // A cabin with wraparound windows, a radar block on its roof.
  b.as('body_alt', () =>
    b.hexa([
      [-1.8, 1.6, -2.4],
      [1.8, 1.6, -2.4],
      [1.6, 4.0, -1.4],
      [-1.6, 4.0, -1.4],
      [-1.8, 1.6, 3.6],
      [1.8, 1.6, 3.6],
      [1.6, 4.0, 3.4],
      [-1.6, 4.0, 3.4],
    ]),
  );
  b.as('glass', () => {
    b.pane([-1.55, 2.9, -1.91], [1.55, 2.9, -1.91], [1.5, 3.7, -1.58], [-1.5, 3.7, -1.58], [0, 0.5, -1]);
    for (const s of [-1, 1])
      b.pane(
        [s * 1.74, 2.9, -1.6],
        [s * 1.74, 2.9, 2.8],
        [s * 1.68, 3.7, 2.8],
        [s * 1.68, 3.7, -1.2],
        [s, 0, 0],
      );
  });
  b.as('metal', () => b.box(-0.5, 0.5, 4.0, 4.9, 0.4, 1.4));
  b.addPart('radar_dish', [0, 5.1, 0.9], () => b.as('trim', () => b.box(-1.3, 1.3, 4.9, 5.6, 0.7, 1.1)));
  b.near(() => b.as('light', () => b.box(-0.2, 0.2, 5.6, 6.0, 0.7, 1.1)));
  // A small gun turret at the bow.
  const turret = b.addPart('turret', [0, 1.6, -4.8], () => {
    b.as('body_alt', () => {
      b.lathe(
        'y',
        [0, 1.6, -4.8],
        [
          [0, 0.95],
          [0.6, 0.95],
        ],
        10,
      );
      b.dome([0, 2.2, -4.8], 0.95, 0.55, 10, 2);
    });
  });
  b.addPart(
    'barrel',
    [0, 2.35, -5.4],
    () => {
      b.as('metal', () => b.cyl('z', [0, 2.35, -6.4], 0.2, 2.0, 6));
      b.muzzle([0, 2.35, -7.5]);
    },
    turret,
  );
  b.as('metal', () => b.box(-0.9, -0.3, 1.6, 2.6, 6.6, 7.6));
  b.exhaust([-0.6, 2.7, 7.1]);
}

function gunboat(b: UnitBuilder): void {
  hull(b, 40, 9, -3, 2.6, 9);
  // Body-coloured upper works: the bridge with big windows, a fat funnel, a mast.
  b.as('body_alt', () => {
    b.box(-3.6, 3.6, 2.6, 6.4, -5.5, 6);
    b.box(-3.0, 3.0, 6.4, 9.0, -5.2, -1.2);
  });
  b.as('glass', () => {
    b.pane([-2.8, 7.2, -5.26], [2.8, 7.2, -5.26], [2.8, 8.5, -5.26], [-2.8, 8.5, -5.26], [0, 0, -1]);
    for (const s of [-1, 1]) {
      const x = s * 3.06;
      b.pane([x, 7.2, -4.8], [x, 8.5, -4.8], [x, 8.5, -1.6], [x, 7.2, -1.6], [s, 0, 0]);
    }
  });
  b.as('accent', () =>
    b.lathe(
      'y',
      [0, 6.4, 2.2],
      [
        [0, 1.6],
        [3.4, 1.4],
        [3.9, 1.4],
      ],
      10,
      1,
      1.3,
    ),
  );
  b.exhaust([0, 10.4, 2.2]);
  b.as('metal', () => {
    b.box(-0.35, 0.35, 9.0, 11.2, -3.6, -2.9);
    b.box(-1.6, 1.6, 10.6, 11.0, -3.4, -3.1);
  });
  b.near(() => b.as('light', () => b.box(-0.25, 0.25, 11.2, 11.8, -3.5, -3.0)));
  // Two gun turrets, fore and aft; the aft one's gun points astern.
  for (const [z, dir] of [
    [-10.5, -1],
    [10.0, 1],
  ] as const) {
    const turret = b.addPart('turret', [0, 2.6, z], () =>
      b.as('body_alt', () =>
        b.hexa([
          [-1.9, 2.6, z - 1.9],
          [1.9, 2.6, z - 1.9],
          [1.5, 4.4, z - 1.4],
          [-1.5, 4.4, z - 1.4],
          [-1.9, 2.6, z + 1.9],
          [1.9, 2.6, z + 1.9],
          [1.5, 4.4, z + 1.4],
          [-1.5, 4.4, z + 1.4],
        ]),
      ),
    );
    b.addPart(
      'barrel',
      [0, 3.4, z + dir * 1.4],
      () => {
        b.as('metal', () => b.cyl('z', [0, 3.4, z + dir * 3.4], 0.32, 4.2, 8));
        b.muzzle([0, 3.4, z + dir * 5.6]);
      },
      turret,
    );
  }
  // A helipad on the stern with a flat H.
  b.as('trim', () =>
    b.near(() => {
      b.box(-2.0, -1.4, 2.6, 2.7, 14.4, 17.8);
      b.box(1.4, 2.0, 2.6, 2.7, 14.4, 17.8);
      b.box(-1.4, 1.4, 2.6, 2.7, 15.8, 16.4);
    }),
  );
}

function submarine(b: UnitBuilder): void {
  // A long rounded hull, mostly below the waterline.
  b.lathe(
    'z',
    [0, -0.6, 0],
    [
      [-15, 0],
      [-14, 1.3],
      [-11, 2],
      [9, 2],
      [13.6, 1.1],
      [14.6, 0.5],
    ],
    12,
  );
  // A tall conning tower with a chunky periscope block.
  b.as('body_alt', () =>
    b.hexa([
      [-0.8, 0.9, -5.4],
      [0.8, 0.9, -5.4],
      [0.75, 2.6, -4.9],
      [-0.75, 2.6, -4.9],
      [-0.8, 0.9, -1.0],
      [0.8, 0.9, -1.0],
      [0.75, 2.6, -2.0],
      [-0.75, 2.6, -2.0],
    ]),
  );
  b.as('metal', () => b.box(-0.25, 0.25, 2.6, 3.0, -4.2, -3.6));
  // Dive planes: on the tower and at the tail.
  b.as('body_alt', () => {
    b.box(-2.0, 2.0, 1.9, 2.1, -4.6, -3.6);
    b.box(-2.0, 2.0, -0.7, -0.5, 11.2, 12.6);
    b.box(-0.15, 0.15, -2.5, 1.2, 11.6, 13.0);
  });
  // A big propeller at the tail.
  b.addPart('propeller', [0, -0.6, 15.0], () =>
    b.as('metal', () => {
      b.cyl('z', [0, -0.6, 15.0], 0.3, 0.6, 6);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        b.beam([0, -0.6, 15.0], [Math.cos(a) * 1.4, -0.6 + Math.sin(a) * 1.4, 15.0], 0.4);
      }
    }),
  );
}

function landingcraft(b: UnitBuilder): void {
  // A flat box hull with an open well deck.
  b.as('metal', () => b.box(-3.4, 3.4, -1.2, 0, -9.0, 10));
  b.box(-3.5, 3.5, 0, 0.8, -8.4, 10);
  for (const s of [-1, 1]) b.box(s > 0 ? 2.8 : -3.5, s > 0 ? 3.5 : -2.8, 0.8, 2.4, -8.4, 10);
  b.as('metal', () => b.box(-2.8, 2.8, 0.8, 0.9, -8.4, 5.5, false));
  // The big front ramp, hinged at its bottom edge.
  b.addPart('ramp', [0, 0.4, -8.75], () =>
    b.as('body_alt', () => {
      b.box(-3.2, 3.2, 0.4, 2.8, -9.1, -8.4);
      b.near(() => b.as('accent', () => b.box(-3.0, 3.0, 2.3, 2.6, -9.18, -9.1)));
    }),
  );
  // A small wheelhouse at the back.
  b.as('body_alt', () => b.box(-2.0, 2.0, 0.8, 3.6, 6.0, 9.4));
  b.as('glass', () => {
    b.pane([-1.6, 2.6, 5.94], [1.6, 2.6, 5.94], [1.6, 3.3, 5.94], [-1.6, 3.3, 5.94], [0, 0, -1]);
  });
  b.as('metal', () => b.box(-0.3, 0.3, 3.6, 4.0, 7.2, 7.8));
  b.near(() => b.as('light', () => b.box(-0.2, 0.2, 4.0, 4.2, 7.3, 7.7)));
  // Twin propellers under the stern.
  for (const s of [-1, 1]) {
    const hub: V3 = [s * 1.6, -0.8, 10.25];
    b.addPart('propeller', hub, () =>
      b.as('metal', () => {
        b.cyl('z', hub, 0.2, 0.4, 6);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          b.beam(hub, [hub[0] + Math.cos(a) * 0.65, hub[1] + Math.sin(a) * 0.65, hub[2]], 0.3);
        }
      }),
    );
  }
}

/** The giant wind-up robot (M37): a boxy toy on stubby legs, claw hands, a wind-up key on its back. */
function windupbot(b: UnitBuilder): void {
  // Stubby legs with big flat feet, each swinging from its hip.
  for (const [name, s] of [
    ['leg_left', -1],
    ['leg_right', 1],
  ] as const)
    b.addPart(name, [s * 2.3, 12, 0], () => {
      b.as('body_alt', () => b.box(s * 2.3 - 1.4, s * 2.3 + 1.4, 2, 12.4, -1.6, 1.6));
      b.as('metal', () => b.box(s * 2.3 - 1.9, s * 2.3 + 1.9, 0, 2.2, -4.6, 2.8));
      b.near(() => b.as('accent', () => b.cyl('x', [s * 2.3, 7, 0], 1.7, 3.1, 10)));
    });
  // A boxy body with chunky studs, and a head with round porthole eyes.
  b.box(-4.2, 4.2, 12, 24, -3.4, 3.4);
  b.near(() =>
    b.as('accent', () => {
      for (const x of [-2.5, 0, 2.5]) for (const y of [15, 18.5]) b.cyl('z', [x, y, -3.65], 0.65, 0.5, 8);
    }),
  );
  b.as('body_alt', () => b.box(-3, 3, 24, 29.4, -2.8, 2.8));
  b.as('glass', () => {
    b.cyl('z', [-1.4, 26.8, -2.9], 0.95, 0.4, 12);
    b.cyl('z', [1.4, 26.8, -2.9], 0.95, 0.4, 12);
  });
  b.near(() => b.as('light', () => b.box(-1.1, 1.1, 25, 25.5, -2.95, -2.8)));
  b.as('metal', () => b.cyl('y', [0, 29.9, 0], 0.25, 1, 6));
  // Chunky arms with claw hands, each swinging from its shoulder.
  for (const [name, s] of [
    ['arm_left', -1],
    ['arm_right', 1],
  ] as const)
    b.addPart(name, [s * 4.7, 22.5, 0], () => {
      b.as('metal', () => b.cyl('x', [s * 4.7, 22.5, 0], 1.2, 1.2, 10));
      const [a0, a1] = s > 0 ? [4.3, 6.6] : [-6.6, -4.3];
      b.box(a0, a1, 13.5, 22.8, -1.5, 1.5);
      const [c0, c1] = s > 0 ? [4, 7] : [-7, -4];
      b.as('accent', () => {
        b.box(c0, c1, 10.4, 13.6, -2.3, -0.5);
        b.box(c0, c1, 10.4, 13.6, 0.5, 2.3);
      });
      b.muzzle([s * 5.5, 10.4, -1.4]);
    });
  // The wind-up key on its back, turning about its axle.
  b.addPart('windup_key', [0, 19, 3.4], () =>
    b.as('accent', () => {
      b.cyl('z', [0, 19, 4], 0.6, 1.2, 8);
      b.hexa([
        [-3.2, 16.8, 4.6],
        [3.2, 16.8, 4.6],
        [3.2, 21.2, 4.6],
        [-3.2, 21.2, 4.6],
        [-3.2, 16.8, 5.4],
        [3.2, 16.8, 5.4],
        [3.2, 21.2, 5.4],
        [-3.2, 21.2, 5.4],
      ]);
    }),
  );
}

/** The sky fortress (M37): a fat airship with a gondola, drone bays and four propeller pods. */
function skyfortress(b: UnitBuilder): void {
  // The envelope, with accent stripes, centred well above the gondola.
  b.lathe(
    'z',
    [0, 15, 0],
    [
      [-40, 0],
      [-37, 5.5],
      [-28, 10],
      [-8, 11],
      [16, 10.6],
      [30, 7.5],
      [38, 3],
      [40, 0],
    ],
    16,
  );
  b.as('accent', () => {
    for (const z of [-20, 8])
      b.lathe(
        'z',
        [0, 15, 0],
        [
          [z, 0],
          [z, 11.1],
          [z + 2, 11.1],
          [z + 2, 0],
        ],
        16,
      );
  });
  // Tail fins: up, down and to each side.
  b.as('body_alt', () => {
    b.box(-0.45, 0.45, 20, 26, 29, 38.5);
    b.box(-0.45, 0.45, 4.6, 10, 29, 38.5);
    b.box(-11.5, -2, 14.6, 15.4, 30, 38.5);
    b.box(2, 11.5, 14.6, 15.4, 30, 38.5);
  });
  // The gondola underneath, with windows, and the launch deck at its back.
  b.as('body_alt', () => b.box(-3, 3, 0.4, 4.6, -16, 14));
  b.as('metal', () => {
    b.box(-3.6, 3.6, 0, 0.6, 12, 20);
    b.beam([0, 4.6, -10], [0, 5.6, -10], 0.6);
    b.beam([0, 4.6, 8], [0, 5.6, 8], 0.6);
  });
  b.near(() =>
    b.as('glass', () => {
      for (let z = -14; z < 10; z += 3) {
        b.pane([-3.02, 2.4, z], [-3.02, 2.4, z + 2], [-3.02, 3.8, z + 2], [-3.02, 3.8, z], [-1, 0, 0]);
        b.pane([3.02, 2.4, z], [3.02, 2.4, z + 2], [3.02, 3.8, z + 2], [3.02, 3.8, z], [1, 0, 0]);
      }
      b.pane([-2.5, 2.2, -16.02], [2.5, 2.2, -16.02], [2.5, 4, -16.02], [-2.5, 4, -16.02], [0, 0, -1]);
    }),
  );
  b.muzzle([0, 1.2, -16.4]);
  // Drone bays along the sides, each a hatch that opens to launch.
  for (const s of [-1, 1])
    for (const z of [-8, 2]) {
      const x = s * 3.05;
      b.addPart('hatch', [x, 1.2, z], () =>
        b.as('accent', () =>
          b.box(Math.min(x, x + s * 0.3), Math.max(x, x + s * 0.3), 1, 3.4, z - 2.4, z + 2.4),
        ),
      );
    }
  // Four propeller pods on struts, under the envelope's flanks.
  for (const [x, z] of [
    [-10, -12],
    [10, -12],
    [-9.5, 16],
    [9.5, 16],
  ] as const) {
    b.as('metal', () => b.beam([Math.sign(x) * 5.5, 6.5, z], [x, 6.2, z], 0.6));
    b.as('body_alt', () => b.cyl('z', [x, 6.2, z], 1.5, 6, 10));
    b.addPart('propeller', [x, 6.2, z + 3.3], () =>
      b.as('metal', () => {
        b.cyl('z', [x, 6.2, z + 3.3], 0.45, 0.6, 6);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          b.beam([x, 6.2, z + 3.4], [x + Math.cos(a) * 2.5, 6.2 + Math.sin(a) * 2.5, z + 3.4], 0.45);
        }
      }),
    );
  }
}

/** The clockwork whale (M37): a riveted whale-shaped hull, a key on top, a sweeping tail, a jaw that opens. */
function clockworkwhale(b: UnitBuilder): void {
  // The hull: wider than tall, centred a little below the waterline.
  b.lathe(
    'z',
    [0, -1.5, 0],
    [
      [-18, 0],
      [-17, 4],
      [-12, 6.6],
      [0, 7],
      [12, 5.8],
      [20, 3.6],
      [24, 1.6],
      [25, 0],
    ],
    16,
    1,
    0.86,
  );
  // The head and its jaw, hinged at the back of the mouth.
  b.lathe(
    'z',
    [0, 0.2, -18],
    [
      [-11.5, 0],
      [-10.6, 3.2],
      [-7, 5],
      [0, 5.6],
    ],
    14,
    1.15,
    0.8,
  );
  b.addPart('jaw', [0, -3, -18], () =>
    b.as('body_alt', () =>
      b.hexa([
        [-5.5, -7.2, -29.2],
        [5.5, -7.2, -29.2],
        [5.5, -3.8, -29.6],
        [-5.5, -3.8, -29.6],
        [-6.4, -7.4, -18],
        [6.4, -7.4, -18],
        [6.4, -3, -18],
        [-6.4, -3, -18],
      ]),
    ),
  );
  b.muzzle([0, -2.6, -29.8]);
  // Portholes along each side, rivet bands, and a water-spout vent.
  b.near(() => {
    b.as('glass', () => {
      for (const z of [-8, -2, 4, 10]) {
        b.cyl('x', [-6.85, 0, z], 0.8, 0.4, 10);
        b.cyl('x', [6.85, 0, z], 0.8, 0.4, 10);
      }
    });
    b.as('metal', () => {
      for (const z of [-12, 6])
        b.lathe(
          'z',
          [0, -1.5, 0],
          [
            [z, 0],
            [z, 7.05],
            [z + 0.6, 7.05],
            [z + 0.6, 0],
          ],
          16,
          1,
          0.86,
        );
      b.cyl('y', [0, 4.6, -6], 0.7, 1.6, 8);
    });
  });
  // The wind-up key on top, turning about its upright axle.
  b.addPart('windup_key', [0, 5, 2], () =>
    b.as('accent', () => {
      b.cyl('y', [0, 5.6, 2], 0.5, 1.6, 8);
      b.box(-3, 3, 6.2, 8, 1.6, 2.4);
    }),
  );
  // The tail and its flukes, sweeping from the root.
  b.addPart('tail', [0, -1, 24], () => {
    b.cyl('z', [0, -1, 26], 1.4, 4, 8);
    b.as('body_alt', () =>
      b.hexa([
        [-1.4, -1.4, 27],
        [1.4, -1.4, 27],
        [1.4, -0.6, 27],
        [-1.4, -0.6, 27],
        [-7, -1.3, 30],
        [7, -1.3, 30],
        [7, -0.7, 30],
        [-7, -0.7, 30],
      ]),
    );
  });
}

const BUILDERS: Record<UnitKind, (b: UnitBuilder) => void> = {
  infantry,
  tank,
  heavytank,
  artillery,
  transport,
  repair,
  fighter,
  bomber,
  helicopter,
  drone,
  patrolboat,
  gunboat,
  submarine,
  landingcraft,
  windupbot,
  skyfortress,
  clockworkwhale,
};

/** Each generated unit's signed volume and any closed shapes drawn inside out (tests). */
export function generatedWinding(kind: UnitKind): { volume: number; flipped: string[] } {
  const b = new UnitBuilder();
  BUILDERS[kind](b);
  return { volume: b.volume(), flipped: [...b.flipped] };
}

const generated = new Map<string, BakedUnit>();

/** A unit kind's generated look. */
export function generatedUnit(kind: UnitKind): BakedUnit {
  let u = generated.get(kind);
  if (!u) {
    const b = new UnitBuilder();
    BUILDERS[kind](b);
    u = b.build(UNIT.get(kind)?.model ?? `unit-${kind}`, kind);
    generated.set(kind, u);
  }
  return u;
}

let handVersion = -1;
const chosen = new Map<string, BakedUnit>();

/** The look a unit kind wears: its hand-made model when there is one, else the generated one. */
export function unitModel(kind: UnitKind): BakedUnit {
  if (handVersion !== handmade.version) {
    handVersion = handmade.version;
    chosen.clear();
  }
  let u = chosen.get(kind);
  if (!u) {
    u = handmade.unit(kind) ?? generatedUnit(kind);
    chosen.set(kind, u);
  }
  return u;
}

/** Every unit kind (for tests and dev scenes). */
export const UNIT_KINDS = UNIT_DEFS.map((d) => d.id);
