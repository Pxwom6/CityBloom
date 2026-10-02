import { Color } from 'three';
import type { Curve, Vec2 } from '../sim/geom';
import type { GeoBuffer } from './geoBuffer';
import type { RoadStyle } from './roadStyle';

export type HeightFn = (x: number, z: number) => number;

/**
 * Ribbon for one segment between arc lengths [s0, s1], draped on the terrain: strips across the
 * width, kerb faces and dashed markings.
 */
export function buildSegmentRibbon(
  out: GeoBuffer,
  curve: Curve,
  style: RoadStyle,
  s0: number,
  s1: number,
  h: HeightFn,
  /** Bridge deck height at arc length s (roads on the ground omit it). */
  deck?: (s: number) => number,
  /** One-way roads (M19): arrows in every lane pointing the way traffic runs (1 is a → b). */
  oneway?: { dir: 1 | -1; lanes: number },
  /** Lengths kept clear of lane markings at each end, for a junction's crossing (M27). */
  clear: [number, number] = [1, 1],
): void {
  if (s1 - s0 < 0.2) return;
  // Steps of 2.5 m round bends, up to 6 m along straight runs (M27: the kerb stones and edging
  // added strips, which the longer straight steps pay for).
  const t0 = curve.tangentAt(s0);
  const t1 = curve.tangentAt(s1);
  const turn = Math.acos(Math.max(-1, Math.min(1, t0.x * t1.x + t0.z * t1.z)));
  const fine = Math.ceil((s1 - s0) / 2.5);
  // Bridge decks rise and fall: always the fine steps there.
  const n = Math.max(
    1,
    deck ? fine : Math.min(fine, Math.max(Math.ceil((s1 - s0) / 6), Math.ceil(turn / 0.05))),
  );
  const px: number[] = [];
  const pz: number[] = [];
  const nx: number[] = [];
  const nz: number[] = [];
  const dk: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const p = curve.pointAt(s);
    const t = curve.tangentAt(s);
    px.push(p.x);
    pz.push(p.z);
    nx.push(t.z);
    nz.push(-t.x);
    dk.push(deck ? deck(s) : -Infinity);
  }
  const at = (i: number, off: number, lift: number): number[] => {
    const x = px[i]! + nx[i]! * off;
    const z = pz[i]! + nz[i]! * off;
    return [x, Math.max(h(x, z), dk[i]!) + lift, z];
  };
  const hs: HeightFn = deck ? (x, z) => Math.max(h(x, z), deck(curve.project({ x, z }).s)) : h;
  for (const st of style.strips) {
    for (let i = 0; i < n; i++)
      out.quad(
        at(i, st.from, st.lift),
        at(i, st.to, st.lift),
        at(i + 1, st.to, st.lift),
        at(i + 1, st.from, st.lift),
        st.color,
      );
  }
  for (const k of style.kerbs) {
    for (let i = 0; i < n; i++) {
      out.quad(
        at(i, k.at, k.low),
        at(i + 1, k.at, k.low),
        at(i + 1, k.at, k.high),
        at(i, k.at, k.high),
        style.kerb,
        false,
      );
    }
  }
  for (const m of style.markings) {
    const period = m.dash + m.gap;
    // A railway's sleepers and rails run right up to the end.
    const [c0, c1] = style.rail ? [1, 1] : clear;
    let s = s0 + c0;
    while (s < s1 - c1) {
      const e = Math.min(s + m.dash, s1 - c1);
      const a = curve.pointAt(s);
      const b = curve.pointAt(e);
      const ta = curve.tangentAt(s);
      const tb = curve.tangentAt(e);
      const pts = [
        [a.x + ta.z * (m.offset - m.width / 2), a.z - ta.x * (m.offset - m.width / 2)],
        [a.x + ta.z * (m.offset + m.width / 2), a.z - ta.x * (m.offset + m.width / 2)],
        [b.x + tb.z * (m.offset + m.width / 2), b.z - tb.x * (m.offset + m.width / 2)],
        [b.x + tb.z * (m.offset - m.width / 2), b.z - tb.x * (m.offset - m.width / 2)],
      ].map(([x, z]) => [x!, hs(x!, z!) + style.lift + 0.03 + (m.lift ?? 0), z!]);
      // Long solid lines: subdivide so they follow the terrain.
      if (e - s > 6) {
        const sub = Math.ceil((e - s) / 3);
        for (let k = 0; k < sub; k++) {
          const sa = s + ((e - s) * k) / sub;
          const sb = s + ((e - s) * (k + 1)) / sub;
          const pa = curve.pointAt(sa);
          const pb = curve.pointAt(sb);
          const qa = curve.tangentAt(sa);
          const qb = curve.tangentAt(sb);
          const q = [
            [pa.x + qa.z * (m.offset - m.width / 2), pa.z - qa.x * (m.offset - m.width / 2)],
            [pa.x + qa.z * (m.offset + m.width / 2), pa.z - qa.x * (m.offset + m.width / 2)],
            [pb.x + qb.z * (m.offset + m.width / 2), pb.z - qb.x * (m.offset + m.width / 2)],
            [pb.x + qb.z * (m.offset - m.width / 2), pb.z - qb.x * (m.offset - m.width / 2)],
          ].map(([x, z]) => [x!, hs(x!, z!) + style.lift + 0.03 + (m.lift ?? 0), z!]);
          out.quad(q[0]!, q[1]!, q[2]!, q[3]!, m.color);
        }
      } else {
        out.quad(pts[0]!, pts[1]!, pts[2]!, pts[3]!, m.color);
      }
      s += period;
    }
  }
  if (oneway) buildArrows(out, curve, style, s0, s1, hs, oneway.dir, oneway.lanes);
}

const ARROW = new Color('#f4f2ea');

/** Painted arrows along a one-way road, one per lane every 36 m (M19). */
function buildArrows(
  out: GeoBuffer,
  curve: Curve,
  style: RoadStyle,
  s0: number,
  s1: number,
  hs: HeightFn,
  dir: 1 | -1,
  lanes: number,
): void {
  const hw = style.asphaltHalf;
  const laneW = (2 * hw) / lanes;
  const y = style.lift + 0.04;
  for (let s = s0 + 14; s < s1 - 10; s += 36) {
    const p = curve.pointAt(s);
    const t0 = curve.tangentAt(s);
    const t = { x: t0.x * dir, z: t0.z * dir };
    const n = { x: -t.z, z: t.x };
    for (let k = 0; k < lanes; k++) {
      const off = -hw + laneW * (k + 0.5);
      const cx = p.x + t0.z * off;
      const cz = p.z - t0.x * off;
      const pt = (u: number, v: number) => {
        const x = cx + t.x * u + n.x * v;
        const z = cz + t.z * u + n.z * v;
        return [x, hs(x, z) + y, z];
      };
      out.quad(pt(-2.2, -0.18), pt(-2.2, 0.18), pt(0.6, 0.18), pt(0.6, -0.18), ARROW);
      const a = pt(0.6, -0.7);
      const b = pt(0.6, 0.7);
      const c = pt(2.2, 0);
      const start = out.n;
      out.tri(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!, ARROW);
      out.faceUp(start);
    }
  }
}

const ISLAND = new Color('#7da65c');
const RING_EDGE = new Color('#f4f2ea');

/**
 * A roundabout (M19): the ring's carriageway round a planted island, a kerb and footway outside it
 * with gaps where the roads come in, and the lens between each road's square end and the ring.
 */
export function buildRoundabout(
  out: GeoBuffer,
  centre: Vec2,
  radius: number,
  width: number,
  approaches: Approach[],
  style: RoadStyle,
  h: HeightFn,
): void {
  const inner = radius - width / 2;
  const outer = radius + width / 2;
  const walk = outer + style.totalHalf - style.asphaltHalf;
  const lift = style.lift + 0.01;
  const walkLift = style.sidewalkLift + 0.01;
  const n = Math.max(24, Math.ceil((Math.PI * 2 * outer) / 3));
  const at = (ang: number, r: number, l: number) => {
    const x = centre.x + Math.cos(ang) * r;
    const z = centre.z + Math.sin(ang) * r;
    return [x, h(x, z) + l, z];
  };
  // Where each road meets the ring (no footway across it).
  const gaps = approaches.map((a) => ({
    ang: Math.atan2(a.dir.z, a.dir.x),
    half: Math.asin(Math.min(0.99, a.style.asphaltHalf / outer)),
  }));
  const inGap = (ang: number) =>
    gaps.some((g) => Math.abs(Math.atan2(Math.sin(ang - g.ang), Math.cos(ang - g.ang))) < g.half);
  const cy = h(centre.x, centre.z) + walkLift + 0.1;
  for (let i = 0; i < n; i++) {
    const a0 = (Math.PI * 2 * i) / n;
    const a1 = (Math.PI * 2 * (i + 1)) / n;
    // Island, raised a little, with its kerb.
    const i0 = at(a0, inner, walkLift + 0.1);
    const i1 = at(a1, inner, walkLift + 0.1);
    const start = out.n;
    out.tri(centre.x, cy, centre.z, i0[0]!, i0[1]!, i0[2]!, i1[0]!, i1[1]!, i1[2]!, ISLAND);
    out.faceUp(start);
    out.quad(at(a0, inner, lift), at(a1, inner, lift), i1, i0, style.sidewalk, false);
    // Carriageway, with a white line along the island.
    out.quad(
      at(a0, inner, lift),
      at(a0, outer, lift),
      at(a1, outer, lift),
      at(a1, inner, lift),
      style.asphalt,
    );
    if (i % 2 === 0)
      out.quad(
        at(a0, inner + 0.4, lift + 0.03),
        at(a0, inner + 0.6, lift + 0.03),
        at(a1, inner + 0.6, lift + 0.03),
        at(a1, inner + 0.4, lift + 0.03),
        RING_EDGE,
      );
    // Footway and kerb outside, except across the roads coming in.
    const mid = (a0 + a1) / 2;
    if (inGap(mid)) continue;
    out.quad(
      at(a0, outer, walkLift),
      at(a0, walk, walkLift),
      at(a1, walk, walkLift),
      at(a1, outer, walkLift),
      style.sidewalk,
    );
    out.quad(
      at(a1, outer, lift),
      at(a0, outer, lift),
      at(a0, outer, walkLift),
      at(a1, outer, walkLift),
      style.sidewalk,
      false,
    );
  }
  // The lens between each road's square end and the curve of the ring.
  for (const a of approaches) {
    const hw = a.style.asphaltHalf;
    const g = Math.atan2(a.dir.z, a.dir.x);
    const half = Math.asin(Math.min(0.99, hw / outer));
    const left = [a.p.x - a.dir.z * hw, a.p.z + a.dir.x * hw];
    const right = [a.p.x + a.dir.z * hw, a.p.z - a.dir.x * hw];
    const m = 6;
    for (let k = 0; k < m; k++) {
      const u0 = g - half + (2 * half * k) / m;
      const u1 = g - half + (2 * half * (k + 1)) / m;
      const e = k < m / 2 ? right : left;
      const p0 = at(u0, outer - 0.2, lift);
      const p1 = at(u1, outer - 0.2, lift);
      const start = out.n;
      out.tri(
        e[0]!,
        h(e[0]!, e[1]!) + lift,
        e[1]!,
        p0[0]!,
        p0[1]!,
        p0[2]!,
        p1[0]!,
        p1[1]!,
        p1[2]!,
        a.style.asphalt,
      );
      out.faceUp(start);
    }
    const start = out.n;
    const pm = at(g, outer - 0.2, lift);
    out.tri(
      right[0]!,
      h(right[0]!, right[1]!) + lift,
      right[1]!,
      pm[0]!,
      pm[1]!,
      pm[2]!,
      left[0]!,
      h(left[0]!, left[1]!) + lift,
      left[1]!,
      a.style.asphalt,
    );
    out.faceUp(start);
  }
}

export interface Approach {
  /** Point on the segment centre line where the ribbon stops. */
  p: Vec2;
  /** Unit direction pointing away from the node. */
  dir: Vec2;
  style: RoadStyle;
  /** The segment it belongs to. */
  seg?: number;
}

/** Intersection polygon: asphalt fan through the approach edges plus sidewalk corner quads. */
export function buildJunction(out: GeoBuffer, centre: Vec2, approaches: Approach[], h: HeightFn): void {
  const list = [...approaches].sort((a, b) => Math.atan2(a.dir.z, a.dir.x) - Math.atan2(b.dir.z, b.dir.x));
  const lift = Math.max(...list.map((a) => a.style.lift));
  const walkLift = Math.max(...list.map((a) => a.style.sidewalkLift));
  // A level crossing (M20) is paved like its road, not ballasted.
  const asphalt = (list.find((a) => !a.style.rail) ?? list[0]!).style.asphalt;
  const edge = (a: Approach, sign: number, w: number): Vec2 => ({
    x: a.p.x + -a.dir.z * sign * w,
    z: a.p.z + a.dir.x * sign * w,
  });
  const ring: Vec2[] = [];
  for (const a of list) {
    ring.push(edge(a, -1, a.style.asphaltHalf), edge(a, 1, a.style.asphaltHalf));
  }
  const cy = h(centre.x, centre.z) + lift;
  const v = (p: Vec2, l: number) => [p.x, h(p.x, p.z) + l, p.z];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const start = out.n;
    out.tri(centre.x, cy, centre.z, a.x, h(a.x, a.z) + lift, a.z, b.x, h(b.x, b.z) + lift, b.z, asphalt);
    out.faceUp(start);
  }
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    const b = list[(i + 1) % list.length]!;
    if (a === b) continue;
    const ai = edge(a, 1, a.style.asphaltHalf);
    const ao = edge(a, 1, a.style.totalHalf);
    const bi = edge(b, -1, b.style.asphaltHalf);
    const bo = edge(b, -1, b.style.totalHalf);
    if (a.style.town) {
      // Kerb stones round the corner and edging along its back, as along the roads (M27).
      const wa = a.style.totalHalf - a.style.asphaltHalf;
      const wb = b.style.totalHalf - b.style.asphaltHalf;
      const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => ({
        x: p.x + (q.x - p.x) * t,
        z: p.z + (q.z - p.z) * t,
      });
      const ak = lerp(ai, ao, 0.3 / wa);
      const bk = lerp(bi, bo, 0.3 / wb);
      const ae = lerp(ao, ai, 0.15 / wa);
      const be = lerp(bo, bi, 0.15 / wb);
      out.quad(v(ai, walkLift), v(ak, walkLift), v(bk, walkLift), v(bi, walkLift), a.style.kerbTop);
      out.quad(v(ak, walkLift), v(ae, walkLift), v(be, walkLift), v(bk, walkLift), a.style.sidewalk);
      out.quad(v(ae, walkLift), v(ao, walkLift), v(bo, walkLift), v(be, walkLift), EDGING);
    } else out.quad(v(ai, walkLift), v(ao, walkLift), v(bo, walkLift), v(bi, walkLift), a.style.sidewalk);
    // Kerb face along the corner.
    out.quad(v(ai, lift), v(bi, lift), v(bi, walkLift), v(ai, walkLift), a.style.kerb, false);
  }
}

const EDGING = new Color('#b4aea2');
const PAINT = new Color('#f4f2ea');

/** A zebra crossing's depth along the road, and how far off the junction it starts (m). */
export const ZEBRA = { from: 1, depth: 3, stop: 4.8 };

/**
 * Paint where town roads meet a junction (M27): on the approaches in `zebra`, a zebra crossing
 * just off the junction and a stop line behind it across the lanes coming in (traffic keeps
 * right); on those in `giveWay`, a dashed give-way line.
 */
export function buildJunctionPaint(
  out: GeoBuffer,
  approaches: Approach[],
  h: HeightFn,
  zebra: Set<number>,
  giveWay: Set<number>,
): void {
  for (const a of approaches) {
    if (!a.style.town || a.seg === undefined) continue;
    const z = zebra.has(a.seg);
    if (!z && !giveWay.has(a.seg)) continue;
    const hw = a.style.asphaltHalf;
    const med = a.style.medianHalf;
    const lift = a.style.lift + 0.03;
    // Offsets o across the road, d along it. Cars keep right, so the lanes coming in are on the
    // positive side (right of a car heading for the junction).
    const nx = a.dir.z;
    const nz = -a.dir.x;
    const pt = (d: number, o: number) => {
      const x = a.p.x + a.dir.x * d + nx * o;
      const zz = a.p.z + a.dir.z * d + nz * o;
      return [x, h(x, zz) + lift, zz];
    };
    const put = (d0: number, d1: number, o0: number, o1: number) =>
      out.quad(pt(d0, o0), pt(d0, o1), pt(d1, o1), pt(d1, o0), PAINT);
    if (z) {
      const d0 = ZEBRA.from;
      const d1 = ZEBRA.from + ZEBRA.depth;
      const n = Math.floor((2 * hw - 1) / 1.1);
      const first = -((n - 1) * 1.1) / 2;
      for (let k = 0; k < n; k++) {
        const o = first + k * 1.1;
        if (Math.abs(o) < med + 0.45) continue;
        put(d0, d1, o - 0.28, o + 0.28);
      }
      put(ZEBRA.stop, ZEBRA.stop + 0.4, med + 0.15, hw - 0.35);
    } else {
      for (let o = med + 0.25; o + 0.6 < hw - 0.2; o += 1.0) put(0.5, 0.8, o, o + 0.6);
    }
  }
}
const PIER = new Color('#b9b4aa');
const GIRDER = new Color('#8d8a84');
const RAIL = new Color('#d9d6cf');

/**
 * Bridge structure under and beside a deck: a girder fascia along both edges, piers down to the
 * ground or riverbed every ~24 m where the deck is well above it, and railings.
 */
export function buildBridgeStructure(
  out: GeoBuffer,
  curve: Curve,
  style: RoadStyle,
  h: HeightFn,
  deck: (s: number) => number,
): void {
  const half = style.totalHalf;
  const step = 3;
  const n = Math.max(1, Math.ceil(curve.length / step));
  const raised = (s: number) => {
    const p = curve.pointAt(s);
    return deck(s) - h(p.x, p.z) > 0.8;
  };
  for (let i = 0; i < n; i++) {
    const sa = (curve.length * i) / n;
    const sb = (curve.length * (i + 1)) / n;
    if (!raised(sa) && !raised(sb)) continue;
    const pa = curve.pointAt(sa);
    const pb = curve.pointAt(sb);
    const ta = curve.tangentAt(sa);
    const tb = curve.tangentAt(sb);
    const ya = deck(sa);
    const yb = deck(sb);
    for (const side of [-1, 1]) {
      const ax = pa.x + ta.z * half * side;
      const az = pa.z - ta.x * half * side;
      const bx = pb.x + tb.z * half * side;
      const bz = pb.z - tb.x * half * side;
      // Fascia (deck edge, 1.2 m deep), facing outward.
      const q = [
        [ax, ya - 1.2, az],
        [bx, yb - 1.2, bz],
        [bx, ya === yb ? yb + 0.25 : yb + 0.25, bz],
        [ax, ya + 0.25, az],
      ];
      if (side > 0) out.quad(q[0]!, q[1]!, q[2]!, q[3]!, GIRDER, false);
      else out.quad(q[1]!, q[0]!, q[3]!, q[2]!, GIRDER, false);
      // Railing: a slim band 1 m above the deck edge.
      const r = [
        [ax, ya + 0.85, az],
        [bx, yb + 0.85, bz],
        [bx, yb + 1.05, bz],
        [ax, ya + 1.05, az],
      ];
      out.quad(r[0]!, r[1]!, r[2]!, r[3]!, RAIL, false);
      out.quad(r[1]!, r[0]!, r[3]!, r[2]!, RAIL, false);
    }
    // Underside.
    out.quad(
      [pb.x + tb.z * half, yb - 1.2, pb.z - tb.x * half],
      [pa.x + ta.z * half, ya - 1.2, pa.z - ta.x * half],
      [pa.x - ta.z * half, ya - 1.2, pa.z + ta.x * half],
      [pb.x - tb.z * half, yb - 1.2, pb.z + tb.x * half],
      GIRDER,
      false,
    );
  }
  // Piers.
  for (let s = 12; s < curve.length - 12; s += 24) {
    if (!raised(s)) continue;
    const p = curve.pointAt(s);
    const t = curve.tangentAt(s);
    const top = deck(s) - 1.2;
    const bottom = Math.min(h(p.x, p.z), 0) - 4;
    const w = half * 0.7;
    const d = 1.1;
    const corner = (u: number, v: number, y: number) => [p.x + t.x * u + t.z * v, y, p.z + t.z * u - t.x * v];
    for (const [u0, v0, u1, v1] of [
      [-d, -w, -d, w],
      [-d, w, d, w],
      [d, w, d, -w],
      [d, -w, -d, -w],
    ] as const) {
      out.quad(
        corner(u0, v0, bottom),
        corner(u1, v1, bottom),
        corner(u1, v1, top),
        corner(u0, v0, top),
        PIER,
        false,
      );
    }
  }
}

const TRAM_BAND = new Color('#6b6f74');
const TRAM_RAIL = new Color('#b7bac0');
const WIRE = new Color('#2f3439');
const MAST = new Color('#5d636a');
const GAUGE = 0.72;

/** A thin strip `w` wide from a to b (points with heights), lying flat. */
function flatStrip(out: GeoBuffer, a: number[], b: number[], w: number, col: Color): void {
  const dx = b[0]! - a[0]!;
  const dz = b[2]! - a[2]!;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * (w / 2);
  const nz = (dx / len) * (w / 2);
  out.quad(
    [a[0]! - nx, a[1]!, a[2]! - nz],
    [a[0]! + nx, a[1]!, a[2]! + nz],
    [b[0]! + nx, b[1]!, b[2]! + nz],
    [b[0]! - nx, b[1]!, b[2]! - nz],
    col,
  );
}

/** An upright box (posts, masts), both windings so it shows from every side. */
export function postBox(
  out: GeoBuffer,
  x: number,
  z: number,
  y0: number,
  y1: number,
  r: number,
  col: Color,
): void {
  const c = [
    [x - r, z - r],
    [x + r, z - r],
    [x + r, z + r],
    [x - r, z + r],
  ] as const;
  for (let i = 0; i < 4; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    const q = [
      [a[0], y0, a[1]],
      [b[0], y0, b[1]],
      [b[0], y1, b[1]],
      [a[0], y1, a[1]],
    ];
    out.quad(q[0]!, q[1]!, q[2]!, q[3]!, col, false);
    out.quad(q[3]!, q[2]!, q[1]!, q[0]!, col, false);
  }
  out.quad(
    [c[0][0], y1, c[0][1]],
    [c[1][0], y1, c[1][1]],
    [c[2][0], y1, c[2][1]],
    [c[3][0], y1, c[3][1]],
    col,
  );
}

/** A beam between two points in the air (barrier arms, span wires), seen from both sides. */
function beam(out: GeoBuffer, a: number[], b: number[], thick: number, col: Color): void {
  const q = [
    [a[0]!, a[1]! - thick / 2, a[2]!],
    [b[0]!, b[1]! - thick / 2, b[2]!],
    [b[0]!, b[1]! + thick / 2, b[2]!],
    [a[0]!, a[1]! + thick / 2, a[2]!],
  ];
  out.quad(q[0]!, q[1]!, q[2]!, q[3]!, col, false);
  out.quad(q[3]!, q[2]!, q[1]!, q[0]!, col, false);
  flatStrip(out, [a[0]!, a[1]! + thick / 2, a[2]!], [b[0]!, b[1]! + thick / 2, b[2]!], thick, col);
}

/**
 * Tram track along a road (M20): a darker band with two rails for each direction's track at
 * `offset` from the centre line, the overhead wire above each and masts with span wires every 36 m.
 */
export function buildTramTrack(
  out: GeoBuffer,
  curve: Curve,
  style: RoadStyle,
  s0: number,
  s1: number,
  hs: HeightFn,
  offset: number,
): void {
  if (s1 - s0 < 0.5) return;
  const y = style.lift + 0.035;
  const n = Math.max(1, Math.ceil((s1 - s0) / 3));
  const at = (s: number, off: number, lift: number): number[] => {
    const p = curve.pointAt(s);
    const t = curve.tangentAt(s);
    const x = p.x + t.z * off;
    const z = p.z - t.x * off;
    return [x, hs(x, z) + lift, z];
  };
  for (const c of [-offset, offset]) {
    for (let i = 0; i < n; i++) {
      const sa = s0 + ((s1 - s0) * i) / n;
      const sb = s0 + ((s1 - s0) * (i + 1)) / n;
      out.quad(at(sa, c - 1.25, y), at(sa, c + 1.25, y), at(sb, c + 1.25, y), at(sb, c - 1.25, y), TRAM_BAND);
      for (const r of [-GAUGE, GAUGE])
        out.quad(
          at(sa, c + r - 0.07, y + 0.01),
          at(sa, c + r + 0.07, y + 0.01),
          at(sb, c + r + 0.07, y + 0.01),
          at(sb, c + r - 0.07, y + 0.01),
          TRAM_RAIL,
        );
      const wa = at(sa, c, 0);
      const wb = at(sb, c, 0);
      wa[1] = Math.max(wa[1]!, wb[1]!) + 5.8;
      wb[1] = wa[1]!;
      beam(out, wa, wb, 0.05, WIRE);
    }
  }
  // Masts at the kerbs with a span wire across.
  const edge = style.asphaltHalf + 0.5;
  for (let s = s0 + 8; s < s1 - 4; s += 36) {
    const l = at(s, -edge, 0);
    const r = at(s, edge, 0);
    const top = Math.max(l[1]!, r[1]!) + 6.3;
    postBox(out, l[0]!, l[2]!, l[1]!, top, 0.12, MAST);
    postBox(out, r[0]!, r[2]!, r[1]!, top, 0.12, MAST);
    beam(out, [l[0]!, top - 0.4, l[2]!], [r[0]!, top - 0.4, r[2]!], 0.05, WIRE);
  }
}

/**
 * Tram track through a junction (M20): each pair of tracked approaches is joined along a curve
 * through the middle, the track on each side meeting its continuation on the other.
 */
export function buildTramJunction(
  out: GeoBuffer,
  centre: Vec2,
  pairs: [{ a: Approach; offset: number }, { a: Approach; offset: number }][],
  h: HeightFn,
): void {
  const y = Math.max(...pairs.flatMap(([p, q]) => [p.a.style.lift, q.a.style.lift])) + 0.035;
  const side = (a: Approach, sign: number, w: number): Vec2 => ({
    x: a.p.x + -a.dir.z * sign * w,
    z: a.p.z + a.dir.x * sign * w,
  });
  for (const [p, q] of pairs) {
    for (const sign of [-1, 1]) {
      for (const [r, w, col, lift] of [
        [0, 2.5, TRAM_BAND, 0],
        [-GAUGE, 0.14, TRAM_RAIL, 0.01],
        [GAUGE, 0.14, TRAM_RAIL, 0.01],
      ] as const) {
        const a = side(p.a, sign, p.offset + r * sign);
        const b = side(q.a, -sign, q.offset + r * sign);
        // Quadratic through the node's centre line: control point where the approaches' lines meet.
        const cx = (a.x + b.x) / 2 + (centre.x - (p.a.p.x + q.a.p.x) / 2);
        const cz = (a.z + b.z) / 2 + (centre.z - (p.a.p.z + q.a.p.z) / 2);
        const steps = 6;
        let prev: number[] | null = null;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const x = (1 - t) * (1 - t) * a.x + 2 * t * (1 - t) * cx + t * t * b.x;
          const z = (1 - t) * (1 - t) * a.z + 2 * t * (1 - t) * cz + t * t * b.z;
          const pt = [x, h(x, z) + y + lift, z];
          if (prev) flatStrip(out, prev, pt, w, col);
          prev = pt;
        }
      }
    }
  }
}

const XBUCK = new Color('#f4f2ea');
const XRED = new Color('#c8342c');
const PANEL = new Color('#5f5a55');

/**
 * A level crossing's barrier arm (Phase 2 review): its pivot on the verge, the direction across the
 * road it lowers towards, and its length. Arms are drawn apart from the road (render/crossings.ts)
 * so they can come down as a train nears.
 */
export interface BarrierArm {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  len: number;
}

/**
 * A level crossing (M20): the rails and a rubber panel across the road between the railway's two
 * approaches, and at each road approach a crossbuck on a post with a red-and-white barrier arm
 * beside it (into `arms` when given, to be drawn moving; otherwise raised, in the mesh).
 */
export function buildLevelCrossing(
  out: GeoBuffer,
  rail: [Approach, Approach],
  roads: Approach[],
  trackOffset: number,
  h: HeightFn,
  arms?: BarrierArm[],
): void {
  const [p, q] = rail;
  const y = Math.max(...roads.map((r) => r.style.lift), p.style.lift) + 0.04;
  const side = (a: Approach, sign: number, w: number): Vec2 => ({
    x: a.p.x + -a.dir.z * sign * w,
    z: a.p.z + a.dir.x * sign * w,
  });
  const v = (pt: Vec2, lift: number) => [pt.x, h(pt.x, pt.z) + lift, pt.z];
  for (const c of [-trackOffset, trackOffset]) {
    out.quad(
      v(side(p, 1, c - 1.3), y),
      v(side(p, 1, c + 1.3), y),
      v(side(q, -1, c + 1.3), y),
      v(side(q, -1, c - 1.3), y),
      PANEL,
    );
    for (const r of [-GAUGE, GAUGE])
      flatStrip(out, v(side(p, 1, c + r), y + 0.03), v(side(q, -1, c + r), y + 0.03), 0.14, TRAM_RAIL);
  }
  for (const a of roads) {
    // On the road's right-hand verge, a little back from the track.
    const back = 1.5;
    const base = { x: a.p.x + a.dir.x * back, z: a.p.z + a.dir.z * back };
    const n = { x: -a.dir.z, z: a.dir.x };
    const off = a.style.asphaltHalf + 0.7;
    const px = base.x - n.x * off;
    const pz = base.z - n.z * off;
    const gy = h(px, pz) + a.style.sidewalkLift;
    postBox(out, px, pz, gy, gy + 3.1, 0.07, MAST);
    // Crossbuck: two crossed boards facing the road.
    const u = { x: n.x * 0.62, z: n.z * 0.62 };
    const f = { x: px + a.dir.x * 0.1, z: pz + a.dir.z * 0.1 };
    for (const s of [-1, 1])
      beam(
        out,
        [f.x - u.x, gy + 2.7 - 0.45 * s, f.z - u.z],
        [f.x + u.x, gy + 2.7 + 0.45 * s, f.z + u.z],
        0.2,
        XBUCK,
      );
    // Red lights box and a raised barrier arm (striped).
    postBox(out, px + a.dir.x * 0.25, pz + a.dir.z * 0.25, gy + 1.8, gy + 2.1, 0.18, XRED);
    const len = Math.min(a.style.asphaltHalf * 1.6, 7);
    if (arms) {
      arms.push({ x: px, y: gy + 1.2, z: pz, nx: n.x, nz: n.z, len });
      continue;
    }
    const segs = 6;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs;
      const t1 = (k + 1) / segs;
      // Raised almost upright, leaning over the verge.
      const at = (t: number) => [px + n.x * 0.25 * t, gy + 1.2 + len * t, pz + n.z * 0.25 * t];
      beam(out, at(t0), at(t1), 0.14, k % 2 ? XBUCK : XRED);
    }
  }
}
