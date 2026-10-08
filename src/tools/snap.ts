import { ROAD_RULES, ROAD_TYPES } from '../data/roads';
import { SNAP } from '../data/roads';
import { angleDiff, type Vec2 } from '../sim/geom';
import type { Network } from '../sim/world/network';

export interface SnapResult extends Vec2 {
  kind: 'node' | 'segment' | 'angle' | 'grid' | 'free';
  node?: number;
  seg?: number;
}

const DEG = Math.PI / 180;

/**
 * Input snapping for road drawing: existing nodes, then existing roads, then (with `near`) a road
 * an end has nearly reached, then angles relative to the start (world axes and the roads at the
 * start node), then the 8 m grid. `scale` widens the radii when zoomed out (the near miss's only
 * to `SNAP.nearMax`). The sim still validates the final geometry, and joins only ends that land
 * exactly on a road.
 */
export function snapPoint(
  net: Network,
  p: Vec2,
  opts: {
    from?: SnapResult | null;
    grid?: boolean;
    scale?: number;
    angles?: boolean;
    /** Join near misses (P1): roads the player can zone along. */
    near?: boolean;
    /** Where the road comes from to this end (its start, or its bend); none for a first point. */
    arriving?: Vec2 | null;
  },
): SnapResult {
  const k = Math.max(1, opts.scale ?? 1);
  const node = net.nearestNode(p, SNAP.node * k);
  if (node && (!opts.from || node.id !== opts.from.node))
    return { x: node.x, z: node.z, kind: 'node', node: node.id };
  const hit = net.nearestSegment(p, SNAP.segment * k, (id) => ROAD_TYPES[net.segment(id).type].buildable);
  if (
    hit &&
    (!opts.from || hit.seg !== opts.from.seg || Math.hypot(hit.x - opts.from.x, hit.z - opts.from.z) > 12)
  ) {
    return { x: hit.x, z: hit.z, kind: 'segment', seg: hit.seg };
  }
  if (opts.near) {
    const j = nearJoin(net, p, opts.from ?? null, opts.arriving ?? null, k);
    if (j) return j;
  }
  const from = opts.from;
  if (from && opts.angles !== false) {
    const dx = p.x - from.x;
    const dz = p.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len > 4) {
      const ang = Math.atan2(dz, dx);
      const candidates: number[] = [];
      for (let q = 0; q < 8; q++) candidates.push((q * Math.PI) / 4);
      const refDirs: number[] = [];
      if (from.node !== undefined)
        for (const sid of net.segmentsAt(from.node)) {
          const d = net.directionAt(sid, from.node);
          refDirs.push(Math.atan2(d.z, d.x));
        }
      if (from.seg !== undefined && net.st.segments.has(from.seg)) {
        const c = net.curve(from.seg);
        const t = c.tangentAt(c.project(from).s);
        refDirs.push(Math.atan2(t.z, t.x));
      }
      for (const r of refDirs) for (let q = 0; q < 8; q++) candidates.push(r + (q * Math.PI) / 4);
      let best = Infinity;
      let bestAng = ang;
      for (const c of candidates) {
        const d = angleDiff(ang, c);
        if (d < best) {
          best = d;
          bestAng = c;
        }
      }
      if (best <= SNAP.angleDeg * DEG) {
        let l = len;
        if (opts.grid) l = Math.max(SNAP.grid, Math.round(l / SNAP.grid) * SNAP.grid);
        return { x: from.x + Math.cos(bestAng) * l, z: from.z + Math.sin(bestAng) * l, kind: 'angle' };
      }
    }
  }
  if (opts.grid)
    return {
      x: Math.round(p.x / SNAP.grid) * SNAP.grid,
      z: Math.round(p.z / SNAP.grid) * SNAP.grid,
      kind: 'grid',
    };
  return { x: p.x, z: p.z, kind: 'free' };
}

/**
 * A near miss (P1): an end within `SNAP.near` (more zoomed out, up to `SNAP.nearMax`) of a road it
 * could join is put exactly on it (on its
 * end node if it's that close to one, so dead ends and corners join there). Only when it's
 * plainly meant: the nearest road, with no other road that doesn't meet it as close; arriving at
 * no less than the angle roads may meet at (so a road running alongside is never grabbed); and a
 * road's first point joins only a loose end.
 */
function nearJoin(
  net: Network,
  p: Vec2,
  from: SnapResult | null,
  arriving: Vec2 | null,
  k: number,
): SnapResult | null {
  const r = Math.min(SNAP.near * k, SNAP.nearMax);
  const hits: { seg: number; d: number; s: number; x: number; z: number }[] = [];
  for (const id of net.segHash.queryPoint(p.x, p.z, r + 1)) {
    const seg = net.segment(id);
    const rt = ROAD_TYPES[seg.type];
    if (!rt.buildable || !rt.access || id === from?.seg) continue;
    if (from?.node !== undefined && (seg.a === from.node || seg.b === from.node)) continue;
    const pr = net.curve(id).project(p);
    if (pr.d <= r) hits.push({ seg: id, d: pr.d, s: pr.s, x: pr.x, z: pr.z });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.d - b.d || a.seg - b.seg);
  const best = net.segment(hits[0]!.seg);
  for (const h of hits.slice(1)) {
    const o = net.segment(h.seg);
    if (o.a !== best.a && o.a !== best.b && o.b !== best.a && o.b !== best.b) return null;
  }
  const len = net.curve(best.id).length;
  const node = hits[0]!.s < 3 ? best.a : hits[0]!.s > len - 3 ? best.b : null;
  const target = node !== null ? net.node(node) : hits[0]!;
  if (arriving) {
    const theta = Math.atan2(arriving.z - target.z, arriving.x - target.x);
    const min = ROAD_RULES.minAngleDeg * DEG;
    if (node !== null) {
      for (const sid of net.segmentsAt(node)) {
        const d = net.directionAt(sid, node);
        if (angleDiff(theta, Math.atan2(d.z, d.x)) < min) return null;
      }
    } else {
      const t = net.curve(best.id).tangentAt(hits[0]!.s);
      const a = angleDiff(theta, Math.atan2(t.z, t.x));
      if (Math.min(a, Math.PI - a) < min) return null;
    }
  } else if (node === null || net.segmentsAt(node).length !== 1) return null;
  return node !== null
    ? { x: target.x, z: target.z, kind: 'node', node }
    : { x: target.x, z: target.z, kind: 'segment', seg: best.id };
}

/** Fit a drawn polyline with a chain of quadratic pieces: returns [a, c, b, c, b, ...]. */
export function fitFreeform(path: Vec2[], spacing = 48): Vec2[] {
  if (path.length < 2) return path.slice();
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  const total = cum[cum.length - 1]!;
  if (total < 1) return [path[0]!, path[path.length - 1]!];
  const at = (s: number): Vec2 => {
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < s) i++;
    const f = (s - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
    return {
      x: path[i - 1]!.x + (path[i]!.x - path[i - 1]!.x) * f,
      z: path[i - 1]!.z + (path[i]!.z - path[i - 1]!.z) * f,
    };
  };
  const pieces = Math.max(1, Math.round(total / spacing));
  const out: Vec2[] = [path[0]!];
  for (let k = 0; k < pieces; k++) {
    const s0 = (total * k) / pieces;
    const s1 = (total * (k + 1)) / pieces;
    const a = k === 0 ? path[0]! : at(s0);
    const b = k === pieces - 1 ? path[path.length - 1]! : at(s1);
    const m = at((s0 + s1) / 2);
    // Quadratic through m at t = ½: c = 2m − (a + b) / 2.
    out.push({ x: 2 * m.x - (a.x + b.x) / 2, z: 2 * m.z - (a.z + b.z) / 2 }, b);
  }
  return out;
}
