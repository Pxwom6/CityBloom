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
): void {
  if (s1 - s0 < 0.2) return;
  const step = 2.5;
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
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
        style.sidewalk,
        false,
      );
    }
  }
  for (const m of style.markings) {
    const period = m.dash + m.gap;
    let s = s0 + 1;
    while (s < s1 - 1) {
      const e = Math.min(s + m.dash, s1 - 1);
      const a = curve.pointAt(s);
      const b = curve.pointAt(e);
      const ta = curve.tangentAt(s);
      const tb = curve.tangentAt(e);
      const pts = [
        [a.x + ta.z * (m.offset - m.width / 2), a.z - ta.x * (m.offset - m.width / 2)],
        [a.x + ta.z * (m.offset + m.width / 2), a.z - ta.x * (m.offset + m.width / 2)],
        [b.x + tb.z * (m.offset + m.width / 2), b.z - tb.x * (m.offset + m.width / 2)],
        [b.x + tb.z * (m.offset - m.width / 2), b.z - tb.x * (m.offset - m.width / 2)],
      ].map(([x, z]) => [x!, hs(x!, z!) + style.lift + 0.03, z!]);
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
          ].map(([x, z]) => [x!, hs(x!, z!) + style.lift + 0.03, z!]);
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
}

/** Intersection polygon: asphalt fan through the approach edges plus sidewalk corner quads. */
export function buildJunction(out: GeoBuffer, centre: Vec2, approaches: Approach[], h: HeightFn): void {
  const list = [...approaches].sort((a, b) => Math.atan2(a.dir.z, a.dir.x) - Math.atan2(b.dir.z, b.dir.x));
  const lift = Math.max(...list.map((a) => a.style.lift));
  const walkLift = Math.max(...list.map((a) => a.style.sidewalkLift));
  const asphalt = list[0]!.style.asphalt;
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
    out.quad(v(ai, walkLift), v(ao, walkLift), v(bo, walkLift), v(bi, walkLift), a.style.sidewalk);
    // Kerb face along the corner.
    out.quad(v(ai, lift), v(bi, lift), v(bi, walkLift), v(ai, walkLift), a.style.sidewalk, false);
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
