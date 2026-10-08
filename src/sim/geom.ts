/**
 * 2D geometry shared by the sim and the main thread (pure functions, x/z plane).
 * Road segments are quadratic Béziers A → B with control point C; straight = C at the midpoint.
 */
export interface Vec2 {
  x: number;
  z: number;
}

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});
export const mid = (a: Vec2, b: Vec2): Vec2 => lerp2(a, b, 0.5);

export function bezierPoint(a: Vec2, c: Vec2, b: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z };
}

/** Derivative (not normalised). */
export function bezierDeriv(a: Vec2, c: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x),
    z: 2 * (1 - t) * (c.z - a.z) + 2 * t * (b.z - c.z),
  };
}

/** Split a quadratic at t (de Casteljau): returns the control points of both halves. */
export function splitBezier(
  a: Vec2,
  c: Vec2,
  b: Vec2,
  t: number,
): { left: [Vec2, Vec2, Vec2]; right: [Vec2, Vec2, Vec2] } {
  const p01 = lerp2(a, c, t);
  const p12 = lerp2(c, b, t);
  const p = lerp2(p01, p12, t);
  return { left: [a, p01, p], right: [p, p12, b] };
}

/** Angle of a direction vector in radians (atan2(z, x)). */
export const angleOf = (d: Vec2): number => Math.atan2(d.z, d.x);

/** Smallest absolute difference between two angles, in [0, π]. */
export function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/**
 * A curve sampled into a polyline with an arc-length table, for lookups by distance along it.
 */
export class Curve {
  readonly a: Vec2;
  readonly c: Vec2;
  readonly b: Vec2;
  readonly ts: Float64Array;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly cum: Float64Array;
  readonly length: number;

  constructor(a: Vec2, c: Vec2, b: Vec2, step = 2) {
    this.a = a;
    this.c = c;
    this.b = b;
    const approx = dist(a, c) + dist(c, b);
    const n = Math.max(2, Math.ceil(approx / step)) + 1;
    this.ts = new Float64Array(n);
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.cum = new Float64Array(n);
    let len = 0;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = bezierPoint(a, c, b, t);
      this.ts[i] = t;
      this.xs[i] = p.x;
      this.zs[i] = p.z;
      if (i > 0) len += Math.hypot(p.x - this.xs[i - 1]!, p.z - this.zs[i - 1]!);
      this.cum[i] = len;
    }
    this.length = len;
  }

  /** Bézier parameter t for arc length s. */
  tAt(s: number): number {
    const cum = this.cum;
    if (s <= 0) return 0;
    if (s >= this.length) return 1;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cum[m]! < s) lo = m;
      else hi = m;
    }
    const f = (s - cum[lo]!) / (cum[hi]! - cum[lo]! || 1);
    return this.ts[lo]! + (this.ts[hi]! - this.ts[lo]!) * f;
  }

  /** Arc length at parameter t. */
  sAt(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return this.length;
    const f = t * (this.ts.length - 1);
    const i = Math.floor(f);
    return this.cum[i]! + (this.cum[i + 1]! - this.cum[i]!) * (f - i);
  }

  pointAt(s: number): Vec2 {
    return bezierPoint(this.a, this.c, this.b, this.tAt(s));
  }

  /** Unit tangent at arc length s. */
  tangentAt(s: number): Vec2 {
    const d = bezierDeriv(this.a, this.c, this.b, this.tAt(s));
    const l = Math.hypot(d.x, d.z) || 1;
    return { x: d.x / l, z: d.z / l };
  }

  /** Nearest point on the curve: arc length, parameter and distance. */
  project(p: Vec2): { s: number; t: number; d: number; x: number; z: number } {
    let best = Infinity;
    let bi = 0;
    let bf = 0;
    const xs = this.xs;
    const zs = this.zs;
    for (let i = 0; i < xs.length - 1; i++) {
      const ax = xs[i]!;
      const az = zs[i]!;
      const dx = xs[i + 1]! - ax;
      const dz = zs[i + 1]! - az;
      const l2 = dx * dx + dz * dz || 1;
      let f = ((p.x - ax) * dx + (p.z - az) * dz) / l2;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const qx = ax + dx * f - p.x;
      const qz = az + dz * f - p.z;
      const d2 = qx * qx + qz * qz;
      if (d2 < best) {
        best = d2;
        bi = i;
        bf = f;
      }
    }
    const s = this.cum[bi]! + (this.cum[bi + 1]! - this.cum[bi]!) * bf;
    const t = this.ts[bi]! + (this.ts[bi + 1]! - this.ts[bi]!) * bf;
    return {
      s,
      t,
      d: Math.sqrt(best),
      x: xs[bi]! + (xs[bi + 1]! - xs[bi]!) * bf,
      z: zs[bi]! + (zs[bi + 1]! - zs[bi]!) * bf,
    };
  }

  /** Maximum turning (radians per metre) along the curve, i.e. 1 / minimum radius. */
  maxCurvature(): number {
    const a = this.a;
    const c = this.c;
    const b = this.b;
    // Quadratic Bézier curvature = |B'×B''| / |B'|³ with constant B''.
    const ddx = 2 * (b.x - 2 * c.x + a.x);
    const ddz = 2 * (b.z - 2 * c.z + a.z);
    let k = 0;
    for (let i = 0; i <= 16; i++) {
      const d = bezierDeriv(a, c, b, i / 16);
      const sp = Math.hypot(d.x, d.z);
      if (sp < 1e-6) continue;
      k = Math.max(k, Math.abs(d.x * ddz - d.z * ddx) / (sp * sp * sp));
    }
    return k;
  }

  bbox(pad = 0): { minX: number; minZ: number; maxX: number; maxZ: number } {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      minX = Math.min(minX, this.xs[i]!);
      maxX = Math.max(maxX, this.xs[i]!);
      minZ = Math.min(minZ, this.zs[i]!);
      maxZ = Math.max(maxZ, this.zs[i]!);
    }
    return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
  }
}

/** Intersection of segments p1p2 and p3p4: parameters (u along first, v along second) or null. */
export function segIntersect(
  p1x: number,
  p1z: number,
  p2x: number,
  p2z: number,
  p3x: number,
  p3z: number,
  p4x: number,
  p4z: number,
): { u: number; v: number } | null {
  const d1x = p2x - p1x;
  const d1z = p2z - p1z;
  const d2x = p4x - p3x;
  const d2z = p4z - p3z;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((p3x - p1x) * d2z - (p3z - p1z) * d2x) / den;
  const v = ((p3x - p1x) * d1z - (p3z - p1z) * d1x) / den;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

/** All crossings between two sampled curves: arc lengths along each. */
export function curveCrossings(a: Curve, b: Curve): { sa: number; sb: number; x: number; z: number }[] {
  const out: { sa: number; sb: number; x: number; z: number }[] = [];
  const ba = a.bbox(1);
  const bb = b.bbox(1);
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxZ < bb.minZ || bb.maxZ < ba.minZ) return out;
  for (let i = 0; i < a.xs.length - 1; i++) {
    const ax0 = a.xs[i]!;
    const az0 = a.zs[i]!;
    const ax1 = a.xs[i + 1]!;
    const az1 = a.zs[i + 1]!;
    if (Math.max(ax0, ax1) < bb.minX || Math.min(ax0, ax1) > bb.maxX) continue;
    if (Math.max(az0, az1) < bb.minZ || Math.min(az0, az1) > bb.maxZ) continue;
    for (let j = 0; j < b.xs.length - 1; j++) {
      const r = segIntersect(ax0, az0, ax1, az1, b.xs[j]!, b.zs[j]!, b.xs[j + 1]!, b.zs[j + 1]!);
      if (!r) continue;
      const sa = a.cum[i]! + (a.cum[i + 1]! - a.cum[i]!) * r.u;
      const sb = b.cum[j]! + (b.cum[j + 1]! - b.cum[j]!) * r.v;
      // Skip duplicates where the crossing lands exactly on a shared sample.
      if (out.some((o) => Math.abs(o.sa - sa) < 0.5 && Math.abs(o.sb - sb) < 0.5)) continue;
      out.push({ sa, sb, x: ax0 + (ax1 - ax0) * r.u, z: az0 + (az1 - az0) * r.u });
    }
  }
  return out;
}

/** Oriented-rectangle overlap (separating axis). Rect = centre, half extents, angle of its x axis. */
export interface ORect {
  x: number;
  z: number;
  hw: number; // half extent along the local x axis (angle)
  hd: number; // half extent along the local z axis
  angle: number;
}

export function rectsOverlap(a: ORect, b: ORect): boolean {
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const az = Math.sin(ang);
    const ra = projRadius(a, ax, az);
    const rb = projRadius(b, ax, az);
    if (Math.abs(dx * ax + dz * az) > ra + rb) return false;
  }
  return true;
}

function projRadius(r: ORect, ax: number, az: number): number {
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  return r.hw * Math.abs(c * ax + s * az) + r.hd * Math.abs(-s * ax + c * az);
}

/** Distance from a point to a rectangle's boundary region (0 if inside). */
export function pointRectDistance(p: Vec2, r: ORect): number {
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  const dx = p.x - r.x;
  const dz = p.z - r.z;
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const ex = Math.max(0, Math.abs(lx) - r.hw);
  const ez = Math.max(0, Math.abs(lz) - r.hd);
  return Math.hypot(ex, ez);
}

export function pointInRect(p: Vec2, r: ORect): boolean {
  return pointRectDistance(p, r) === 0;
}

/** Compass direction of a heading in the ground plane (−z is north). */
export function compass(dx: number, dz: number): string {
  const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const k = Math.round(Math.atan2(dz, dx) / (Math.PI / 4));
  return names[(k + 8) % 8]!;
}
