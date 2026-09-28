import { JUNCTION, TRAFFIC } from '../../data/balance';
import { ROAD_TYPES } from '../../data/roads';
import type { Sim } from '../sim';
import { hourOfDay } from '../time';
import type { Dijkstra, Leg, RoadGraph } from './graph';

/**
 * Traffic as aggregated flows (DESIGN §3.8): every assignment round the matcher routes the day's
 * trips over congested travel times and adds them to per-segment volumes; volumes then move part
 * of the way towards the new assignment (method of successive averages). Congestion follows the
 * BPR curve on volume over capacity, scaled by the hour's share of the rush-hour peak.
 */

export type TripPurpose = 'work' | 'shop' | 'freight' | 'export' | 'import' | 'event';

/** A real trip carried by a visible vehicle: which buildings, why, and the roads it takes. */
export interface TripSample {
  from: number;
  to: number;
  purpose: TripPurpose;
  legs: Leg[];
  /** Trips per day this sample stands for (relative weight for spawning). */
  weight: number;
  /** The way back, when it isn't the way there reversed (one-way roads, M19). */
  back?: Leg[];
}

/** Travel-time multiplier for a volume/capacity ratio. */
export function slowdown(vc: number): number {
  return Math.min(TRAFFIC.maxSlowdown, 1 + TRAFFIC.bprAlpha * Math.pow(Math.max(0, vc), TRAFFIC.bprBeta));
}

/** Seconds to drive a segment that takes `t0` at free flow, at volume/capacity `vc`. */
export function congestedSeconds(t0: number, vc: number): number {
  return t0 * slowdown(vc) + (vc > 1 ? TRAFFIC.queueSeconds * (1 - 1 / vc) : 0);
}

/** Traffic at an hour of the day as a share of the rush-hour peak. */
export function hourShare(tick: number): number {
  return TRAFFIC.profile[Math.floor(hourOfDay(tick))] ?? 0.5;
}

/** Cars per hour a segment carries before slowing, lowered a little by poor road upkeep. */
export function segCapacity(sim: Sim, segId: number): number {
  const seg = sim.state.net.segments.get(segId);
  if (!seg) return 1;
  const oneWay = seg.oneway ? TRAFFIC.oneWayCapacity : 1;
  return ROAD_TYPES[seg.type].capacity * oneWay * (0.8 + 0.2 * Math.min(1, sim.fundingEff('roads')));
}

/** Volume over capacity for a segment at `share` of the peak hour. */
export function segVC(sim: Sim, segId: number, share: number): number {
  const vol = sim.state.traffic.get(segId) ?? 0;
  return (vol * TRAFFIC.peakShare * share) / segCapacity(sim, segId);
}

export type JunctionKind = 'none' | 'plain' | 'roundabout';

/** What kind of junction a node is (M19): a roundabout, an ordinary junction, or just a bend. */
export function junctionKind(sim: Sim, nodeId: number): JunctionKind {
  const node = sim.state.net.nodes.get(nodeId);
  if (!node) return 'none';
  if (node.roundabout) return 'roundabout';
  return sim.net.segmentsAt(nodeId).length >= 3 ? 'plain' : 'none';
}

/** Cars per hour a junction passes before it slows (M19). */
export function junctionCapacity(sim: Sim, nodeId: number): number {
  const kind = junctionKind(sim, nodeId);
  if (kind === 'none') return Infinity;
  let approaches = 0;
  for (const sid of sim.net.segmentsAt(nodeId)) approaches += segCapacity(sim, sid);
  return (approaches / 2) * (kind === 'roundabout' ? JUNCTION.roundaboutShare : JUNCTION.plainShare);
}

/** Cars a day through a junction: half the traffic on the roads that meet there. */
export function junctionVolume(sim: Sim, nodeId: number): number {
  let v = 0;
  for (const sid of sim.net.segmentsAt(nodeId)) v += sim.state.traffic.get(sid) ?? 0;
  return v / 2;
}

/** Volume over capacity for a junction at `share` of the peak hour. */
export function junctionVC(sim: Sim, nodeId: number, share: number): number {
  const cap = junctionCapacity(sim, nodeId);
  if (cap === Infinity) return 0;
  return (junctionVolume(sim, nodeId) * TRAFFIC.peakShare * share) / cap;
}

/** Seconds a car loses getting through a junction at `share` of the peak hour (0 for a bend). */
export function junctionDelay(sim: Sim, nodeId: number, share: number): number {
  const kind = junctionKind(sim, nodeId);
  if (kind === 'none') return 0;
  const vc = junctionVC(sim, nodeId, share);
  const base = kind === 'roundabout' ? JUNCTION.roundaboutDelay : JUNCTION.plainDelay;
  return base * slowdown(vc) + (vc > 1 ? JUNCTION.queueSeconds * (1 - 1 / vc) : 0);
}

/**
 * Congested seconds per graph edge at `share` of the peak hour: the road's own time plus, where the
 * edge arrives at a junction, the time lost getting through it (M19).
 */
export function congestedEdgeCosts(sim: Sim, g: RoadGraph, share: number): Float64Array {
  const out = new Float64Array(g.cost.length);
  const cache = new Map<number, number>();
  const delays = new Float64Array(g.size);
  for (let v = 0; v < g.size; v++) delays[v] = junctionDelay(sim, g.ids[v]!, share);
  for (let k = 0; k < out.length; k++) {
    const seg = g.seg[k]!;
    let vc = cache.get(seg);
    if (vc === undefined) {
      vc = segVC(sim, seg, share);
      cache.set(seg, vc);
    }
    out[k] = congestedSeconds(g.cost[k]!, vc) + delays[g.to[k]!]!;
  }
  return out;
}

/**
 * Collects the loads a Dijkstra tree carries: trips ending at nodes are pushed back along the
 * predecessor edges to the source, adding to each segment's next volume.
 */
export class FlowAccumulator {
  readonly next = new Map<number, number>();
  private load: Float64Array;

  constructor(private g: RoadGraph) {
    this.load = new Float64Array(g.size);
  }

  addLoad(node: number, v: number): void {
    this.load[node] = this.load[node]! + v;
  }

  /** Drop a node's pending load (it had nowhere to go). */
  clearLoad(node: number): void {
    this.load[node] = 0;
  }

  addSegment(seg: number, v: number): void {
    if (v > 0) this.next.set(seg, (this.next.get(seg) ?? 0) + v);
  }

  /**
   * Push loads back along the tree of a reverse Dijkstra (M19: the way home on a network with
   * one-way roads): from each node towards the source, along the edges leaving it.
   */
  accumulateReverse(d: Dijkstra): void {
    const g = this.g;
    for (let i = d.settledCount - 1; i >= 0; i--) {
      const u = d.settled[i]!;
      const l = this.load[u]!;
      if (l <= 0) continue;
      this.load[u] = 0;
      const k = d.pred[u]!;
      if (k < 0) continue;
      this.addSegment(g.seg[k]!, l);
      const p = g.to[k]!;
      this.load[p] = this.load[p]! + l;
    }
  }

  /** Push the loads added since the last call back along the tree of the Dijkstra that just ran. */
  accumulate(d: Dijkstra): void {
    const g = this.g;
    for (let i = d.settledCount - 1; i >= 0; i--) {
      const u = d.settled[i]!;
      const l = this.load[u]!;
      if (l <= 0) continue;
      this.load[u] = 0;
      const k = d.pred[u]!;
      if (k < 0) continue;
      this.addSegment(g.seg[k]!, l);
      const p = g.from[k]!;
      this.load[p] = this.load[p]! + l;
    }
  }
}

/** Move volumes part of the way towards a new assignment (all segments, so unused roads empty). */
export function applyVolumes(sim: Sim, next: Map<number, number>): void {
  const vol = sim.state.traffic;
  const a = TRAFFIC.msa;
  const out = new Map<number, number>();
  const ids = [...sim.state.net.segments.keys()].sort((x, y) => x - y);
  for (const id of ids) {
    const v = vol.get(id) ?? 0;
    const nv = v + a * ((next.get(id) ?? 0) - v);
    if (nv >= 0.5) out.set(id, Math.round(nv * 10) / 10);
  }
  sim.state.traffic = out;
}

/**
 * Road legs from a building on (accSeg, s) through the Dijkstra tree to node `dest`, then onto
 * (toSeg, toS). The tree must have been grown from the node the building attaches to.
 */
export function legsThroughTree(
  sim: Sim,
  g: RoadGraph,
  d: Dijkstra,
  from: { seg: number; s: number } | null,
  dest: number,
  to: { seg: number; s: number } | null,
): Leg[] {
  const edges: number[] = [];
  let k = d.pred[dest]!;
  let guard = 0;
  while (k >= 0 && guard++ < g.size) {
    edges.push(k);
    k = d.pred[g.from[k]!]!;
  }
  edges.reverse();
  const start = edges.length ? g.from[edges[0]!]! : dest;
  const legs: Leg[] = [];
  const push = (l: Leg) => {
    const prev = legs[legs.length - 1];
    if (prev && prev.seg === l.seg) prev.s1 = l.s1;
    else legs.push(l);
  };
  const endOf = (segId: number, node: number) => {
    const seg = sim.state.net.segments.get(segId)!;
    return g.ids[node] === seg.a ? 0 : sim.net.curve(segId).length;
  };
  if (from && sim.state.net.segments.has(from.seg))
    push({ seg: from.seg, s0: from.s, s1: endOf(from.seg, start) });
  for (const e of edges) {
    const segId = g.seg[e]!;
    push({ seg: segId, s0: endOf(segId, g.from[e]!), s1: endOf(segId, g.to[e]!) });
  }
  if (to && sim.state.net.segments.has(to.seg)) push({ seg: to.seg, s0: endOf(to.seg, dest), s1: to.s });
  return legs.filter((l) => Math.abs(l.s1 - l.s0) >= 0.5);
}

/** Weighted reservoir of trip samples (A-Res), drawn from the traffic RNG stream. */
export class TripReservoir {
  private items: { key: number; sample: TripSample }[] = [];

  constructor(
    private sim: Sim,
    private size = TRAFFIC.samples,
  ) {}

  /** Offer `weight` trips; `make` builds the sample only if it is kept. */
  offer(weight: number, make: () => TripSample | null): void {
    if (weight <= 0) return;
    const key = Math.pow(this.sim.rng.traffic.next(), 1 / weight);
    if (this.items.length >= this.size && key <= this.items[0]!.key) return;
    const sample = make();
    if (!sample || !sample.legs.length) return;
    this.items.push({ key, sample });
    this.items.sort((a, b) => a.key - b.key);
    if (this.items.length > this.size) this.items.shift();
  }

  get samples(): TripSample[] {
    return this.items.map((i) => i.sample);
  }
}
