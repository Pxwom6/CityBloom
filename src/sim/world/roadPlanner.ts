import {
  GRADE_SEP,
  GRADING,
  ROAD_RULES,
  ROAD_TYPES,
  gradeSeparated,
  roadClass,
  roadHalfWidth,
  type RoadTypeId,
} from '../../data/roads';
import { MAP_SIZE, SHORE_HEIGHT } from '../../data/world';
import { JUNCTION } from '../../data/balance';
import { Curve, angleDiff, angleOf, curveCrossings, dist, mid, splitBezier, v2, type Vec2 } from '../geom';
import type { Terrain } from '../terrain/terrain';
import type { Network } from './network';
import { BRIDGE, deckAt, deckProfile, rampLength } from './bridge';
import { gradeProfile, profileAt, type GradeLimit, type GradeProfile } from './grading';
import { planEarthworks, type EarthPiece, type EarthPlan } from './earthworks';

/**
 * Road planning: turns a drawn path into validated pieces with automatic intersections.
 * `planRoad` is pure (used for previews); `applyRoadPlan` performs it. DESIGN.md §2, SPEC §5 Roads.
 */
export type Endpoint =
  | { kind: 'node'; id: number; x: number; z: number }
  | { kind: 'split'; seg: number; s: number; x: number; z: number }
  | { kind: 'new'; x: number; z: number };

export interface PlanPiece {
  a: Vec2;
  c: Vec2;
  b: Vec2;
  ea: Endpoint;
  eb: Endpoint;
  length: number;
  /**
   * Roads this piece passes over or under without meeting them (M19): arc length along the piece,
   * the height limit there, and how far either side other roads may come close.
   */
  crossings?: Crossing[];
}

export interface Crossing extends GradeLimit {
  seg: number;
  /** Passing over the other road (on a deck), or under its viaduct. */
  over: boolean;
  /** Metres either side of `s` where the other road's corridor overlaps this one. */
  skip: number;
}

export interface RoadPlan {
  ok: boolean;
  reason?: string;
  /** Where the problem is, for highlighting. */
  at?: Vec2;
  type: RoadTypeId;
  cost: number;
  /** Metres of the plan that cross water on bridges. */
  bridgeLength: number;
  length: number;
  pieces: PlanPiece[];
  /** Existing segments that will be split, with the arc lengths (descending per segment). */
  splits: { seg: number; s: number; x: number; z: number }[];
  /** Graded profile of each piece on dry land (null where it crosses water on a bridge). M13. */
  profiles: (GradeProfile | null)[];
  /** The cut and fill that lays it into the ground; its cost is included in `cost`. */
  earth: EarthPlan | null;
  /** New pieces are one-way, in the direction they were drawn (M19). */
  oneway?: boolean;
}

const DEG = Math.PI / 180;

function fail(plan: RoadPlan, reason: string, at?: Vec2): RoadPlan {
  plan.ok = false;
  plan.reason = reason;
  if (at) plan.at = at;
  return plan;
}

/** Parse [a, c, b, c, b, ...] (or [a, b] for a straight road) into Bézier pieces. */
export function parsePath(points: Vec2[]): [Vec2, Vec2, Vec2][] | null {
  if (points.length < 2) return null;
  for (const p of points) if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  if (points.length === 2) return [[points[0]!, mid(points[0]!, points[1]!), points[1]!]];
  if (points.length % 2 === 0) return null;
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i + 2 < points.length; i += 2) out.push([points[i]!, points[i + 1]!, points[i + 2]!]);
  return out;
}

function resolveAnchor(net: Network, p: Vec2): Endpoint {
  const node = net.nearestNode(p, ROAD_RULES.nodeTolerance);
  if (node) return { kind: 'node', id: node.id, x: node.x, z: node.z };
  const hit = net.nearestSegment(p, ROAD_RULES.segmentTolerance);
  if (hit) {
    const seg = net.segment(hit.seg);
    const len = net.curve(hit.seg).length;
    if (hit.s < 3) return { kind: 'node', id: seg.a, x: net.node(seg.a).x, z: net.node(seg.a).z };
    if (hit.s > len - 3) return { kind: 'node', id: seg.b, x: net.node(seg.b).x, z: net.node(seg.b).z };
    const pt = net.curve(hit.seg).pointAt(hit.s);
    return { kind: 'split', seg: hit.seg, s: hit.s, x: pt.x, z: pt.z };
  }
  return { kind: 'new', x: p.x, z: p.z };
}

const epPos = (e: Endpoint): Vec2 => ({ x: e.x, z: e.z });

function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (a.kind === 'node' && b.kind === 'node') return a.id === b.id;
  return dist(epPos(a), epPos(b)) < 0.05;
}

/** Split a Bézier at several arc lengths of its curve. */
function subdivide(a: Vec2, c: Vec2, b: Vec2, curve: Curve, cuts: number[]): [Vec2, Vec2, Vec2][] {
  const out: [Vec2, Vec2, Vec2][] = [];
  let cur: [Vec2, Vec2, Vec2] = [a, c, b];
  let prevT = 0;
  for (const s of cuts) {
    const tGlobal = curve.tAt(s);
    const tLocal = (tGlobal - prevT) / (1 - prevT);
    const h = splitBezier(cur[0], cur[1], cur[2], tLocal);
    out.push(h.left);
    cur = h.right;
    prevT = tGlobal;
  }
  out.push(cur);
  return out;
}

export function planRoad(
  net: Network,
  terrain: Terrain,
  type: RoadTypeId,
  points: Vec2[],
  treasury: number,
  sandbox: boolean,
  /** Given the validated pieces, the ground the earthworks must leave alone (under buildings). */
  keep?: (pieces: PlanPiece[]) => (x: number, z: number) => boolean,
): RoadPlan {
  const plan: RoadPlan = {
    ok: true,
    type,
    cost: 0,
    length: 0,
    bridgeLength: 0,
    pieces: [],
    splits: [],
    profiles: [],
    earth: null,
  };
  const rt = ROAD_TYPES[type];
  if (!rt || !rt.buildable) return fail(plan, 'This road type cannot be built');
  const raw = parsePath(points);
  if (!raw) return fail(plan, 'Invalid road path');

  // 1. Curvature and auto-splitting of long pieces.
  const pieces: [Vec2, Vec2, Vec2][] = [];
  for (const [a, c, b] of raw) {
    const curve = new Curve(a, c, b);
    if (curve.length < 0.5) continue;
    if (curve.maxCurvature() > 1 / ROAD_RULES.minRadius + 1e-9) return fail(plan, 'Curve is too tight', c);
    const parts = Math.ceil(curve.length / ROAD_RULES.maxSegmentLength);
    const cuts: number[] = [];
    for (let k = 1; k < parts; k++) cuts.push((curve.length * k) / parts);
    pieces.push(...subdivide(a, c, b, curve, cuts));
  }
  if (!pieces.length) return fail(plan, 'Road is too short');
  const rawLength = pieces.reduce((sum, p) => sum + new Curve(p[0], p[1], p[2]).length, 0);
  if (rawLength < ROAD_RULES.minLength) return fail(plan, 'Road is too short', pieces[0]![2]);

  // 2. Resolve anchors (shared between consecutive pieces) to nodes, splits or new points.
  const anchors: Endpoint[] = [resolveAnchor(net, pieces[0]![0])];
  for (const p of pieces) anchors.push(resolveAnchor(net, p[2]));
  const resolved: { a: Vec2; c: Vec2; b: Vec2; ea: Endpoint; eb: Endpoint }[] = pieces.map((p, i) => {
    const ea = anchors[i]!;
    const eb = anchors[i + 1]!;
    const a = epPos(ea);
    const b = epPos(eb);
    // Keep the control point's offset relative to the chord so snapped endpoints keep the shape.
    const straight = dist(p[1], mid(p[0], p[2])) < 0.01;
    const c = straight
      ? mid(a, b)
      : v2(p[1].x + (a.x - p[0].x + b.x - p[2].x) / 2, p[1].z + (a.z - p[0].z + b.z - p[2].z) / 2);
    return { a, c, b, ea, eb };
  });
  for (const r of resolved) {
    if (sameEndpoint(r.ea, r.eb)) return fail(plan, 'Road is too short', r.a);
  }

  // 3. Crossings with existing roads split both; crossings with itself are rejected.
  const curves = resolved.map((r) => new Curve(r.a, r.c, r.b));
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 2; j < curves.length; j++) {
      const x = curveCrossings(curves[i]!, curves[j]!);
      if (x.length) return fail(plan, 'Road crosses itself', x[0]);
    }
  }
  const finalPieces: PlanPiece[] = [];
  const splitMap = new Map<string, { seg: number; s: number; x: number; z: number }>();
  const addSplit = (e: Endpoint) => {
    if (e.kind !== 'split') return;
    splitMap.set(`${e.seg}:${e.s.toFixed(3)}`, { seg: e.seg, s: e.s, x: e.x, z: e.z });
  };
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!;
    const curve = curves[i]!;
    addSplit(r.ea);
    addSplit(r.eb);
    const box = curve.bbox(2);
    const cuts: { s: number; ep: Endpoint }[] = [];
    const over: Crossing[] = [];
    for (const sid of net.segHash.query(box)) {
      const other = net.curve(sid);
      for (const x of curveCrossings(curve, other)) {
        if (x.sa < 2 || x.sa > curve.length - 2) continue;
        const seg = net.segment(sid);
        // Grade separation (M19): the city highway and the regional highway pass over or under what
        // they cross, and anything passes under a viaduct high enough.
        const sep = separation(net, terrain, type, sid, x, curve);
        if (sep) {
          if (typeof sep === 'string') return fail(plan, sep, x);
          over.push(sep);
          continue;
        }
        if (ROAD_TYPES[seg.type].buildable === false)
          return fail(plan, "Can't cross the regional highway", x);
        let ep: Endpoint;
        if (x.sb < 3) ep = { kind: 'node', id: seg.a, x: net.node(seg.a).x, z: net.node(seg.a).z };
        else if (x.sb > other.length - 3)
          ep = { kind: 'node', id: seg.b, x: net.node(seg.b).x, z: net.node(seg.b).z };
        else {
          const pt = other.pointAt(x.sb);
          ep = { kind: 'split', seg: sid, s: x.sb, x: pt.x, z: pt.z };
        }
        // Crossing angle.
        const ta = curve.tangentAt(x.sa);
        const tb = other.tangentAt(x.sb);
        const ang = angleDiff(angleOf(ta), angleOf(tb));
        if (Math.min(ang, Math.PI - ang) < ROAD_RULES.minAngleDeg * DEG)
          return fail(plan, 'Roads cross at too shallow an angle', x);
        if (!cuts.some((c) => Math.abs(c.s - x.sa) < 1)) cuts.push({ s: x.sa, ep });
      }
    }
    // Road ends and junctions lying on the new road join it (closing a grid along the dead ends of
    // several streets makes T-junctions); they only touch it, so the crossing test above misses them.
    for (const n of net.nodesIn(box)) {
      if ((r.ea.kind === 'node' && r.ea.id === n.id) || (r.eb.kind === 'node' && r.eb.id === n.id)) continue;
      const pr = curve.project(n);
      if (pr.d > ROAD_RULES.nodeOnPath || pr.s < 2 || pr.s > curve.length - 2) continue;
      // A highway passes over local junctions in its way (M19).
      if (
        gradeSeparated(type) &&
        net.segmentsAt(n.id).some((sid) => roadClass(net.segment(sid).type) === 'local')
      )
        continue;
      if (!cuts.some((c) => Math.abs(c.s - pr.s) < 1))
        cuts.push({ s: pr.s, ep: { kind: 'node', id: n.id, x: n.x, z: n.z } });
    }
    cuts.sort((p, q) => p.s - q.s);
    for (const c of cuts) addSplit(c.ep);
    const subs = subdivide(
      r.a,
      r.c,
      r.b,
      curve,
      cuts.map((c) => c.s),
    );
    const eps = [r.ea, ...cuts.map((c) => c.ep), r.eb];
    const bounds = [0, ...cuts.map((c) => c.s), curve.length];
    for (let k = 0; k < subs.length; k++) {
      const [a, c, b] = subs[k]!;
      const ea = eps[k]!;
      const eb = eps[k + 1]!;
      // Snap the sub-piece ends exactly onto their endpoints.
      const pa = epPos(ea);
      const pb = epPos(eb);
      const cc = v2(c.x + (pa.x - a.x + pb.x - b.x) / 2, c.z + (pa.z - a.z + pb.z - b.z) / 2);
      const len = new Curve(pa, cc, pb).length;
      const piece: PlanPiece = { a: pa, c: cc, b: pb, ea, eb, length: len };
      // Crossings on this stretch, measured from its start (a Bézier split keeps its shape).
      const mine = over
        .filter((o) => o.s > bounds[k]! && o.s < bounds[k + 1]!)
        .map((o) => ({ ...o, s: o.s - bounds[k]! }));
      if (mine.length) piece.crossings = mine;
      finalPieces.push(piece);
    }
  }
  plan.pieces = finalPieces;
  plan.splits = [...splitMap.values()].sort((p, q) => p.seg - q.seg || q.s - p.s);
  for (const sp of plan.splits)
    if (!ROAD_TYPES[net.segment(sp.seg).type].buildable)
      return fail(plan, 'Roads join the regional highway only where it ends', v2(sp.x, sp.z));
  // The city highway meets other roads only through ramps, and the regional highway at the
  // interchange where it ends (M19).
  for (const p of finalPieces)
    for (const e of [p.ea, p.eb]) {
      const types =
        e.kind === 'node'
          ? net.segmentsAt(e.id).map((sid) => net.segment(sid).type)
          : e.kind === 'split'
            ? [net.segment(e.seg).type]
            : [];
      types.push(type);
      if (types.includes('highway') || !types.includes('motorway')) continue;
      if (types.some((t) => roadClass(t) === 'local'))
        return fail(
          plan,
          type === 'motorway'
            ? 'The city highway meets other roads only by ramps: pass over this road, or end short of it'
            : 'Join the city highway with a ramp',
          epPos(e),
        );
    }
  // A viaduct can only be joined where it's back on the ground (M13; no grade separation yet).
  for (const sp of plan.splits) {
    const deck = net.segment(sp.seg).deck;
    if (deck && profileAt({ step: GRADING.step, h: deck }, sp.s) > terrain.heightAt(sp.x, sp.z) + 1)
      return fail(
        plan,
        "Roads can't meet on a viaduct: join it where it's back on the ground",
        v2(sp.x, sp.z),
      );
  }

  // 4. Validation.
  const hwNew = roadHalfWidth(type);
  const endKey = (e: Endpoint) => (e.kind === 'node' ? `n${e.id}` : `p${e.x.toFixed(2)},${e.z.toFixed(2)}`);
  /** Graded heights at the ends of pieces checked so far, for the pieces that follow them. */
  const endHeights = new Map<string, number>();
  for (const p of finalPieces) {
    if (p.length < ROAD_RULES.minLength)
      return fail(plan, 'Too close to another road or junction', mid(p.a, p.b));
    // Roundabouts (M19): a road may join the ring's junction, from far enough out, but not cut
    // across the ring.
    const pc = new Curve(p.a, p.c, p.b);
    const reach = JUNCTION.maxRadius + JUNCTION.ringWidth + hwNew + 8;
    for (const n of net.nodesIn(pc.bbox(reach))) {
      if (!n.roundabout) continue;
      const outer = n.roundabout + JUNCTION.ringWidth / 2 + ROAD_TYPES.street.sidewalk;
      const joins = (p.ea.kind === 'node' && p.ea.id === n.id) || (p.eb.kind === 'node' && p.eb.id === n.id);
      if (joins) {
        if (p.length < outer + 14) return fail(plan, 'Too short to meet the roundabout', mid(p.a, p.b));
      } else if (pc.project(n).d < outer + hwNew)
        return fail(plan, 'A roundabout is in the way', v2(n.x, n.z));
    }
    if (p.ea.kind === 'node' && p.eb.kind === 'node') {
      // Already directly connected by a similar road?
      for (const sid of net.segmentsAt(p.ea.id)) {
        const s = net.segment(sid);
        if ((s.a === p.ea.id && s.b === p.eb.id) || (s.b === p.ea.id && s.a === p.eb.id)) {
          if (dist(v2(s.cx, s.cz), p.c) < 6) return fail(plan, 'A road already exists here', mid(p.a, p.b));
        }
      }
    }
    const curve = new Curve(p.a, p.c, p.b, 4);
    for (let i = 0; i < curve.xs.length; i++) {
      const x = curve.xs[i]!;
      const z = curve.zs[i]!;
      if (x < 4 || z < 4 || x > MAP_SIZE - 4 || z > MAP_SIZE - 4)
        return fail(plan, 'Outside the city limits', v2(x, z));
    }
    const deck = deckProfile(curve, (x, z) => terrain.heightAt(x, z));
    if (deck) {
      // Across water: a bridge with ramps; the land either side is checked the old way (M6).
      const at = firstWet(curve, terrain);
      if (type === 'dirt') return fail(plan, "Dirt roads can't cross water: use a street or wider", at);
      if (deck.longestSpan > BRIDGE.maxSpan)
        return fail(plan, `Too far for a bridge (${BRIDGE.maxSpan} m at most)`, at);
      if (Math.min(deck.landA, deck.landB) < rampLength() - BRIDGE.step)
        return fail(
          plan,
          `A bridge needs about ${Math.round(rampLength())} m of land on each side of the water for its ramps`,
          at,
        );
      for (const o of p.crossings ?? []) {
        const h = deckAt(deck, o.s);
        if (o.min !== undefined ? h < o.min : h > o.max!)
          return fail(plan, "Can't pass over or under another road on a bridge here", pc.pointAt(o.s));
      }
      plan.bridgeLength += deck.overWater;
      const heights: number[] = [];
      for (let i = 0; i < curve.xs.length; i++) heights.push(deckAt(deck, curve.cum[i]!));
      const win = Math.max(1, Math.round(ROAD_RULES.gradeWindow / 4));
      for (let i = 0; i + win < heights.length; i++) {
        const run = curve.cum[i + win]! - curve.cum[i]!;
        if (run > 0 && Math.abs(heights[i + win]! - heights[i]!) / run > rt.maxGrade)
          return fail(
            plan,
            'Too steep beside the bridge: bring it in over flatter banks',
            v2(curve.xs[i]!, curve.zs[i]!),
          );
      }
      plan.profiles.push(null);
      continue;
    }
    // On dry land: a graded profile, cut and filled (M13). Ends that join an existing road, or an
    // earlier piece of this one, are pinned to its height; a new dead end is free.
    const pin = (e: Endpoint): number | null => {
      if (e.kind === 'new') return endHeights.get(endKey(e)) ?? null;
      return terrain.heightAt(e.x, e.z);
    };
    const prof = gradeProfile(
      curve,
      (x, z) => terrain.heightAt(x, z),
      type,
      pin(p.ea),
      pin(p.eb),
      p.crossings ?? [],
    );
    const pointAt = (i: number) => curve.pointAt(prof.s[i]!);
    if (prof.fail) {
      plan.profiles.push(prof);
      return fail(plan, prof.fail.reason, pointAt(prof.fail.at));
    }
    if (prof.raisedLength > 0) {
      const first = prof.raised.indexOf(1);
      if (type === 'dirt')
        return fail(
          plan,
          `Dirt roads can't go on a viaduct: a ${Math.round(prof.maxFill)} m embankment is too tall`,
          pointAt(first),
        );
      const endAt = prof.raised[0] ? 0 : prof.raised[prof.raised.length - 1] ? prof.raised.length - 1 : -1;
      if (endAt >= 0)
        return fail(
          plan,
          `Too steep to end here: it would stand on a ${Math.round(prof.h[endAt]! - prof.ground[endAt]!)} m embankment (${GRADING.maxFill} m at most; the ground falls ${Math.round(prof.groundGrade * 100)}\u00a0% and ${articled(ROAD_TYPES[type].name)} can climb ${Math.round(rt.maxGrade * 100)}\u00a0%). Carry it on across the valley, or wind down the slope`,
          pointAt(endAt),
        );
      if (prof.raisedLength > BRIDGE.maxSpan)
        return fail(plan, `Too long for a viaduct (${BRIDGE.maxSpan} m at most)`, pointAt(first));
      plan.bridgeLength += prof.raisedLength;
    }
    endHeights.set(endKey(p.eb), prof.h[prof.h.length - 1]!);
    if (!endHeights.has(endKey(p.ea))) endHeights.set(endKey(p.ea), prof.h[0]!);
    plan.profiles.push(prof);
  }

  // Angles at every endpoint, counting existing roads, split halves and new pieces.
  const endpointDirs = new Map<
    string,
    { dirs: number[]; newDirs: number[]; hw: number[]; types: RoadTypeId[]; pos: Vec2 }
  >();
  const keyOf = (e: Endpoint) => (e.kind === 'node' ? `n${e.id}` : `p${e.x.toFixed(2)},${e.z.toFixed(2)}`);
  const entry = (e: Endpoint) => {
    const k = keyOf(e);
    let v = endpointDirs.get(k);
    if (!v) {
      v = { dirs: [], newDirs: [], hw: [], types: [], pos: epPos(e) };
      if (e.kind === 'node') {
        for (const sid of net.segmentsAt(e.id)) {
          v.dirs.push(angleOf(net.directionAt(sid, e.id)));
          v.hw.push(net.halfWidth(sid));
          v.types.push(net.segment(sid).type);
        }
      } else if (e.kind === 'split') {
        const t = net.curve(e.seg).tangentAt(e.s);
        v.dirs.push(angleOf(t), angleOf(v2(-t.x, -t.z)));
        v.hw.push(net.halfWidth(e.seg), net.halfWidth(e.seg));
        v.types.push(net.segment(e.seg).type, net.segment(e.seg).type);
      }
      endpointDirs.set(k, v);
    }
    return v;
  };
  for (const p of finalPieces) {
    const da = v2(p.c.x - p.a.x, p.c.z - p.a.z);
    const db = v2(p.c.x - p.b.x, p.c.z - p.b.z);
    entry(p.ea).newDirs.push(angleOf(dist(p.c, p.a) > 0.01 ? da : v2(p.b.x - p.a.x, p.b.z - p.a.z)));
    entry(p.eb).newDirs.push(angleOf(dist(p.c, p.b) > 0.01 ? db : v2(p.a.x - p.b.x, p.a.z - p.b.z)));
  }
  const skipAt = new Map<string, number>();
  // Ramps slip onto and off the city highway at a shallow angle (M19); other roads meet squarer.
  const merging = (t: RoadTypeId, u: RoadTypeId) =>
    (t === 'ramp' && roadClass(u) !== 'local') || (u === 'ramp' && roadClass(t) !== 'local');
  for (const [k, v] of endpointDirs) {
    const all = [...v.dirs, ...v.newDirs];
    const types = [...v.types, ...v.newDirs.map(() => type)];
    let minAng = Math.PI;
    let limit = ROAD_RULES.minAngleDeg * DEG;
    for (let i = 0; i < v.newDirs.length; i++) {
      for (let j = 0; j < all.length; j++) {
        if (j === v.dirs.length + i) continue;
        const d = angleDiff(v.newDirs[i]!, all[j]!);
        const need = (merging(type, types[j]!) ? ROAD_RULES.mergeAngleDeg : ROAD_RULES.minAngleDeg) * DEG;
        if (all.length > 1 && d < need) return fail(plan, 'Roads meet at too sharp an angle', v.pos);
        if (d < minAng) {
          minAng = d;
          limit = need;
        }
      }
    }
    const maxHw = Math.max(hwNew, ...v.hw);
    const effective = Math.min(Math.PI / 2, Math.max(minAng, limit));
    const cap = type === 'ramp' || v.types.includes('ramp') ? 200 : 80;
    skipAt.set(
      k,
      all.length > 1 ? Math.min(cap, (hwNew + maxHw + ROAD_RULES.clearance) / Math.sin(effective) + 2) : 0,
    );
  }

  // Clearance from unconnected roads (existing and other new pieces).
  const pieceCurves = finalPieces.map((p) => new Curve(p.a, p.c, p.b, 2));
  for (let i = 0; i < finalPieces.length; i++) {
    const p = finalPieces[i]!;
    const curve = pieceCurves[i]!;
    const skipA = skipAt.get(keyOf(p.ea)) ?? 0;
    const skipB = skipAt.get(keyOf(p.eb)) ?? 0;
    const splitSegs = new Set(plan.splits.map((s) => s.seg));
    // A ramp slipping off the city highway runs close beside it for a while (M19).
    const mergesAt = (e: Endpoint): Set<number> => {
      const segs = e.kind === 'node' ? net.segmentsAt(e.id) : e.kind === 'split' ? [e.seg] : [];
      return new Set(segs.filter((sid) => merging(type, net.segment(sid).type)));
    };
    const mergeA = mergesAt(p.ea);
    const mergeB = mergesAt(p.eb);
    for (let k = 0; k < curve.xs.length; k++) {
      const s = curve.cum[k]!;
      if (s < skipA || s > curve.length - skipB) continue;
      const pt = v2(curve.xs[k]!, curve.zs[k]!);
      for (const sid of net.segHash.queryPoint(pt.x, pt.z, hwNew + 16 + ROAD_RULES.clearance)) {
        const need = hwNew + net.halfWidth(sid) + ROAD_RULES.clearance;
        const d = net.curve(sid).project(pt).d;
        if (d < need) {
          // Samples near a crossing with this segment are expected to be close.
          if (splitSegs.has(sid) && d < 0.5) continue;
          // So are those passing over or under it (M19), and a ramp beside the road it merges with.
          if (p.crossings?.some((o) => o.seg === sid && Math.abs(s - o.s) < o.skip)) continue;
          if ((mergeA.has(sid) && s < 200) || (mergeB.has(sid) && s > curve.length - 200)) continue;
          return fail(plan, 'Too close to another road', pt);
        }
      }
      for (let j = 0; j < finalPieces.length; j++) {
        if (j === i) continue;
        const q = finalPieces[j]!;
        if (
          sameEndpoint(q.ea, p.ea) ||
          sameEndpoint(q.eb, p.ea) ||
          sameEndpoint(q.ea, p.eb) ||
          sameEndpoint(q.eb, p.eb)
        )
          continue;
        if (pieceCurves[j]!.project(pt).d < hwNew * 2 + ROAD_RULES.clearance)
          return fail(plan, 'Road overlaps itself', pt);
      }
    }
  }

  plan.length = finalPieces.reduce((s, p) => s + p.length, 0);
  const earthPieces: EarthPiece[] = [];
  finalPieces.forEach((p, i) => {
    const prof = plan.profiles[i];
    if (prof)
      earthPieces.push({
        curve: new Curve(p.a, p.c, p.b, 4),
        type,
        prof,
        joined: [p.ea.kind !== 'new', p.eb.kind !== 'new'],
      });
  });
  plan.earth = planEarthworks(terrain, net, earthPieces, keep?.(finalPieces));
  plan.cost =
    Math.round(
      plan.length * rt.costPerMetre + plan.bridgeLength * rt.costPerMetre * (BRIDGE.costFactor - 1),
    ) + plan.earth.cost;
  if (!sandbox && plan.cost > treasury) return fail(plan, 'Not enough money', finalPieces[0]!.b);
  return plan;
}

export interface SplitRecord {
  original: {
    id: number;
    a: number;
    b: number;
    cx: number;
    cz: number;
    type: RoadTypeId;
    left: number;
    right: number;
    layouts: { left?: [number, number]; right?: [number, number] };
    deck?: number[];
  };
  node: number;
  first: number;
  second: number;
}

export interface RoadApplyResult {
  segments: number[];
  nodes: number[];
  splits: SplitRecord[];
}

/**
 * Perform a valid plan. The caller handles money, trees and undo bookkeeping; `earthworks` runs
 * once the roads exist and before zone cells are rechecked, and returns the ground it changed.
 */
export function applyRoadPlan(
  net: Network,
  plan: RoadPlan,
  earthworks?: () => { minX: number; minZ: number; maxX: number; maxZ: number } | null,
): RoadApplyResult {
  const result: RoadApplyResult = { segments: [], nodes: [], splits: [] };
  const splitNode = new Map<string, number>();
  // Group splits by segment and split from the far end so earlier arc lengths stay valid.
  const bySeg = new Map<number, { s: number; x: number; z: number }[]>();
  for (const s of plan.splits) {
    const list = bySeg.get(s.seg) ?? [];
    list.push(s);
    bySeg.set(s.seg, list);
  }
  for (const [segId, list] of [...bySeg.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => b.s - a.s);
    let cur = segId;
    for (const sp of list) {
      const seg = net.segment(cur);
      const blockLayout = (bid: number): [number, number] | undefined => {
        const b = bid ? net.st.blocks.get(bid) : undefined;
        return b ? [b.s0, b.cols] : undefined;
      };
      const original = {
        id: seg.id,
        a: seg.a,
        b: seg.b,
        cx: seg.cx,
        cz: seg.cz,
        type: seg.type,
        left: seg.left,
        right: seg.right,
        layouts: { left: blockLayout(seg.left), right: blockLayout(seg.right) },
        ...(seg.deck ? { deck: seg.deck.slice() } : {}),
        ...(seg.oneway ? { oneway: seg.oneway } : {}),
      };
      const r = net.splitSegment(cur, sp.s);
      result.splits.push({ original, node: r.node.id, first: r.first.id, second: r.second.id });
      result.nodes.push(r.node.id);
      splitNode.set(`${segId}:${sp.s.toFixed(3)}`, r.node.id);
      cur = r.first.id;
    }
  }
  const newNodes: { x: number; z: number; id: number }[] = [];
  const nodeFor = (e: Endpoint): number => {
    if (e.kind === 'node') return e.id;
    if (e.kind === 'split') return splitNode.get(`${e.seg}:${e.s.toFixed(3)}`)!;
    const found = newNodes.find((n) => Math.abs(n.x - e.x) < 0.05 && Math.abs(n.z - e.z) < 0.05);
    if (found) return found.id;
    const n = net.createNode(e.x, e.z);
    newNodes.push({ x: e.x, z: e.z, id: n.id });
    result.nodes.push(n.id);
    return n.id;
  };
  plan.pieces.forEach((p, i) => {
    const a = nodeFor(p.ea);
    const b = nodeFor(p.eb);
    const na = net.node(a);
    const nb = net.node(b);
    // Keep the control point consistent with the exact node positions.
    const c = v2(p.c.x + (na.x - p.a.x + nb.x - p.b.x) / 2, p.c.z + (na.z - p.a.z + nb.z - p.b.z) / 2);
    const seg = net.createSegment(a, b, c, plan.type);
    // One-way roads run the way they were drawn (M19).
    if (plan.oneway || ROAD_TYPES[plan.type].oneWay) seg.oneway = 1;
    // A viaduct over dry ground keeps its graded heights (M13).
    const prof = plan.profiles[i];
    if (prof && prof.raisedLength > 0) seg.deck = Array.from(prof.h, (h) => Math.round(h * 100) / 100);
    result.segments.push(seg.id);
  });
  const earthBox = earthworks?.() ?? null;
  // Zone validity around everything that changed.
  const affected = [...result.segments, ...result.splits.flatMap((s) => [s.first, s.second])].filter((id) =>
    net.st.segments.has(id),
  );
  if (affected.length) {
    let box = net.segmentInfluenceBox(affected[0]!);
    for (const id of affected.slice(1)) {
      const b = net.segmentInfluenceBox(id);
      box = {
        minX: Math.min(box.minX, b.minX),
        minZ: Math.min(box.minZ, b.minZ),
        maxX: Math.max(box.maxX, b.maxX),
        maxZ: Math.max(box.maxZ, b.maxZ),
      };
    }
    if (earthBox)
      box = {
        minX: Math.min(box.minX, earthBox.minX),
        minZ: Math.min(box.minZ, earthBox.minZ),
        maxX: Math.max(box.maxX, earthBox.maxX),
        maxZ: Math.max(box.maxZ, earthBox.maxZ),
      };
    net.revalidate(box);
  }
  return result;
}

function firstWet(curve: Curve, terrain: Terrain): Vec2 {
  for (let i = 0; i < curve.xs.length; i++)
    if (terrain.heightAt(curve.xs[i]!, curve.zs[i]!) < SHORE_HEIGHT) return v2(curve.xs[i]!, curve.zs[i]!);
  return v2(curve.xs[0]!, curve.zs[0]!);
}

function articled(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name.toLowerCase()}` : `a ${name.toLowerCase()}`;
}

/**
 * How a new road of `type` crossing segment `sid` at `x` avoids meeting it (M19): over it on a deck
 * when either is a highway, under it when it's a viaduct high enough, or null for an ordinary
 * junction. A string is a reason it can't cross there at all.
 */
function separation(
  net: Network,
  terrain: Terrain,
  type: RoadTypeId,
  sid: number,
  x: { sa: number; sb: number; x: number; z: number },
  curve: Curve,
): Crossing | string | null {
  const seg = net.segment(sid);
  const other = net.curve(sid);
  const ground = terrain.heightAt(x.x, x.z);
  // The other road's surface there: its viaduct deck, its bridge over water, or the ground.
  const bridge = seg.deck ? null : deckProfile(other, (px, pz) => terrain.heightAt(px, pz));
  const surface = seg.deck
    ? profileAt({ step: GRADING.step, h: seg.deck }, x.sb)
    : bridge
      ? Math.max(ground, deckAt(bridge, x.sb))
      : ground;
  const under = surface - Math.max(ground, SHORE_HEIGHT) >= GRADE_SEP.clearance;
  if (!under && !gradeSeparated(type) && !gradeSeparated(seg.type)) return null;
  const ta = curve.tangentAt(x.sa);
  const tb = other.tangentAt(x.sb);
  const ang = angleDiff(angleOf(ta), angleOf(tb));
  const sin = Math.sin(Math.min(ang, Math.PI - ang));
  if (sin < Math.sin(ROAD_RULES.minAngleDeg * DEG)) return 'Roads cross at too shallow an angle';
  const hwOther = net.halfWidth(sid);
  const half = (hwOther + GRADING.shoulder + GRADE_SEP.margin) / sin;
  const skip = (roadHalfWidth(type) + hwOther + ROAD_RULES.clearance) / sin + 2;
  if (under) return { seg: sid, over: false, s: x.sa, half, max: surface - GRADE_SEP.clearance, skip };
  return { seg: sid, over: true, s: x.sa, half, min: surface + GRADE_SEP.clearance, skip };
}
