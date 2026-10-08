import { JUNCTION } from '../../data/balance';
import { ROAD_TYPES, isRail, roadHalfWidth, type RoadTypeId } from '../../data/roads';
import type { Vec2 } from '../geom';
import type { Network } from './network';

/**
 * Room for a roundabout (P5). Each road meeting the ring is measured to the next real junction
 * through any bends, so a plain bend or a dead end isn't taken for "the next junction", and sizes
 * step down to a mini roundabout before a site is refused.
 */

/** What stops an arm: a real junction, a bend (two roads meeting), the road's end, a roundabout. */
export type ArmEnd = 'junction' | 'bend' | 'end' | 'ring';

export interface RingArm {
  /** The road leaving the ring (for a site in a road's middle, that road either way). */
  seg: number;
  /** Which way it leaves the centre, for naming it ("the road east"). */
  dir: Vec2;
  /** Metres to the first node along it, which node, and what it is. */
  first: number;
  firstNode: number;
  firstEnd: ArmEnd;
  /** Metres to the next real junction, dead end or roundabout, through bends; and what it is. */
  reach: number;
  end: ArmEnd;
  endNode: number;
  /** The roads walked out to it, in order. */
  chain: number[];
}

/** A site: a junction, or a point `s` metres along a road. */
export type RingSite = { node: number } | { seg: number; s: number; x: number; z: number };

/** Clear road an arm needs beyond the ring's outer edge, to a junction or another ring, and to a bend or a dead end. */
const CLEAR = { junction: 14, ring: 14, bend: 6, end: 6 } as const;

/** Outer edge of a ring of centre-line radius r (its carriageway, then a footway). */
export const ringOuter = (r: number): number => r + JUNCTION.ringWidth / 2 + ROAD_TYPES.street.sidewalk;

/** The usual size for the widest road meeting it (as before P5), and the smallest, a mini roundabout. */
export function ringSizes(widest: RoadTypeId): { normal: number; mini: number } {
  const normal = Math.max(JUNCTION.minRadius, Math.ceil(roadHalfWidth(widest) + 6)) + 2;
  const mini = Math.max(JUNCTION.miniRadius, Math.ceil(ROAD_TYPES[widest].width / 2 + 2));
  return { normal, mini: Math.min(mini, normal) };
}

/** Sizes to try for a site, largest first: the usual size, then smaller, down to a mini. */
export function ringLadder(widest: RoadTypeId): number[] {
  const { normal, mini } = ringSizes(widest);
  const out: number[] = [];
  for (let r = normal; r > mini; r -= JUNCTION.sizeStep) out.push(r);
  out.push(mini);
  return out;
}

/** A node a ring's arm can run on through: two local roads meeting, not a ring or a crossing. */
function classify(net: Network, node: number, centre: number | null): ArmEnd {
  if (node === centre || net.node(node).roundabout) return 'ring';
  const segs = net.segmentsAt(node);
  if (segs.length === 1) return 'end';
  if (
    segs.length === 2 &&
    segs.every((id) => {
      const t = net.segment(id).type;
      return ROAD_TYPES[t].access && !isRail(t);
    })
  )
    return 'bend';
  return 'junction';
}

/** Walk an arm out from `from` along `seg`, through bends, to what stops it. */
function walk(
  net: Network,
  seg: number,
  far: number,
  first: number,
  dir: Vec2,
  centre: number | null,
): RingArm {
  const firstEnd = classify(net, far, centre);
  const arm: RingArm = {
    seg,
    dir,
    first,
    firstNode: far,
    firstEnd,
    reach: first,
    end: firstEnd,
    endNode: far,
    chain: [seg],
  };
  let at = far;
  let via = seg;
  for (let steps = 0; arm.end === 'bend' && steps < 40; steps++) {
    const next = net.segmentsAt(at).find((id) => id !== via)!;
    const s = net.segment(next);
    const other = s.a === at ? s.b : s.a;
    arm.chain.push(next);
    arm.reach += net.curve(next).length;
    via = next;
    at = other;
    arm.end = classify(net, other, centre);
    arm.endNode = other;
  }
  return arm;
}

/** The roads that would meet a ring at `site`, each measured out to what stops it. */
export function ringArms(net: Network, site: RingSite): RingArm[] {
  if ('node' in site)
    return net.segmentsAt(site.node).map((id) => {
      const s = net.segment(id);
      return walk(
        net,
        id,
        s.a === site.node ? s.b : s.a,
        net.curve(id).length,
        net.directionAt(id, site.node),
        site.node,
      );
    });
  const seg = net.segment(site.seg);
  const curve = net.curve(site.seg);
  const t = curve.tangentAt(site.s);
  return [
    walk(net, site.seg, seg.a, site.s, { x: -t.x, z: -t.z }, null),
    walk(net, site.seg, seg.b, curve.length - site.s, t, null),
  ];
}

/** Why an arm is too short for a ring of radius r, or null if it's long enough. */
export interface ArmShortfall {
  arm: RingArm;
  /** Metres of road there are, and need to be, out to what's in the way. */
  have: number;
  need: number;
  /** What's in the way, and where. */
  what: ArmEnd;
  node: number;
  /** Only a bend inside the ring is in the way: the ring could take the road in straight. */
  bendInside: boolean;
}

export function armShortfall(arm: RingArm, r: number): ArmShortfall | null {
  const outer = ringOuter(r);
  const firstNeed = outer + CLEAR[arm.firstEnd];
  const reachNeed = outer + CLEAR[arm.end];
  const reachShort = arm.reach < reachNeed;
  if (reachShort)
    return { arm, have: arm.reach, need: reachNeed, what: arm.end, node: arm.endNode, bendInside: false };
  if (arm.first < firstNeed)
    return {
      arm,
      have: arm.first,
      need: firstNeed,
      what: arm.firstEnd,
      node: arm.firstNode,
      bendInside: arm.firstEnd === 'bend',
    };
  return null;
}

/** Shortfalls of every arm at radius r (none: it fits). */
export function shortfalls(arms: RingArm[], r: number): ArmShortfall[] {
  return arms.map((a) => armShortfall(a, r)).filter((x): x is ArmShortfall => !!x);
}

/**
 * Taking a bend inside the ring in straight (P5): the arm's road from the centre to the point N
 * where it is first `outer` + 6 m from the centre is replaced by one straight road, so the ring's
 * approach is a road of its own (as every arm's first road must be).
 */
export interface Straightening {
  arm: RingArm;
  /** The road of the arm's chain N lies on, and N's arc length along it from its `a` end. */
  k: number;
  s: number;
  /** The arm enters that road at its `a` end (so the half to drop is a→N). */
  nearIsA: boolean;
  /** N is that road's far node: it goes whole, with no split. */
  whole: boolean;
  at: Vec2;
}

/** Where to cut an arm to take its bend in, or null if it can't be (a bridge, tram track, one-way, or it never leaves the ring). */
export function planStraighten(
  net: Network,
  centre: number,
  arm: RingArm,
  outer: number,
): Straightening | null {
  const want = outer + CLEAR.bend;
  const c = net.node(centre);
  let from = centre;
  for (let k = 0; k < arm.chain.length; k++) {
    const id = arm.chain[k]!;
    const seg = net.segment(id);
    if (seg.deck || seg.tram || seg.oneway) return null;
    const curve = net.curve(id);
    const len = curve.length;
    const fromA = seg.a === from;
    for (let d = 1; d <= len; d += 1) {
      const s = fromA ? d : len - d;
      const p = curve.pointAt(s);
      if (Math.hypot(p.x - c.x, p.z - c.z) < want) continue;
      const far = fromA ? seg.b : seg.a;
      if (len - d < 1) return { arm, k, s: fromA ? len : 0, nearIsA: fromA, whole: true, at: net.node(far) };
      return { arm, k, s, nearIsA: fromA, whole: false, at: p };
    }
    from = fromA ? seg.b : seg.a;
  }
  return null;
}

/** The buildings taking the bend in removes (beside the roads it drops, and where it cuts one). */
export function straightenLosses(net: Network, st: Straightening): number[] {
  const out = new Set<number>();
  const all = (id: number) => {
    const seg = net.segment(id);
    for (const bid of [seg.left, seg.right]) {
      const block = bid ? net.st.blocks.get(bid) : undefined;
      if (block) for (const b of block.bld) if (b) out.add(b);
    }
  };
  for (let i = 0; i < st.k; i++) all(st.arm.chain[i]!);
  const kId = st.arm.chain[st.k]!;
  if (st.whole) all(kId);
  else {
    // Kept only if all its lots are on the far half.
    const far = st.nearIsA ? 2 : 1;
    for (const [bld, m] of net.splitHalves(kId, st.s)) if (m !== far) out.add(bld);
  }
  return [...out].sort((a, b) => a - b);
}

/** Take the bend in: drop the arm's road out to N and lay a straight road from the centre to N. */
export function straighten(net: Network, centre: number, st: Straightening): void {
  const chain = st.arm.chain;
  const first = net.segment(chain[0]!);
  const type = first.type;
  const name = first.name;
  const drop = chain.slice(0, st.k);
  const kId = chain[st.k]!;
  let n: number;
  if (st.whole) {
    const seg = net.segment(kId);
    n = st.nearIsA ? seg.b : seg.a;
    drop.push(kId);
  } else {
    const r = net.splitSegment(kId, st.s);
    n = r.node.id;
    drop.push(st.nearIsA ? r.first.id : r.second.id);
  }
  const between = new Set<number>();
  for (const id of drop) {
    const seg = net.segment(id);
    for (const x of [seg.a, seg.b]) if (x !== centre && x !== n) between.add(x);
  }
  for (const id of drop) net.removeSegment(id);
  for (const x of [...between].sort((a, b) => a - b)) net.removeNodeIfOrphan(x);
  const a = net.node(centre);
  const b = net.node(n);
  net.createSegment(centre, n, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, type, {
    zoned: true,
    ...(name !== undefined ? { name } : {}),
  });
}
