import { CIVIC, SERVICES, SERVICE_KINDS, type ServiceKind } from '../../data/civic';
import { EDUCATION } from '../../data/balance';
import { ROAD_TYPES } from '../../data/roads';
import { ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import { civicDef, civicCapacity, civicOnline, findAccess, type Civic } from '../world/civic';
import { attachmentOf } from './commute';
import { Dijkstra, type RoadGraph } from './graph';

const dijkstra = new Dijkstra();

/** Coverage value for a travel time t within range T (full within `fullShare` of T). */
export function coverageAt(t: number, range: number, eff: number): number {
  const full = range * SERVICES.fullShare;
  if (t <= full) return eff;
  if (t >= range) return 0;
  return eff * (1 - (t - full) / (range - full));
}

/** Coverage samples are taken every this many metres along each road. */
export const COVERAGE_STEP = 24;

/**
 * Service coverage sampled along the roads: per kind, per segment id, values at evenly spaced
 * points from end a (index 0) to end b. Sampling along segments (not just at junctions) lets
 * coverage fade smoothly along long roads.
 */
export interface Coverage {
  graph: RoadGraph;
  kinds: Record<ServiceKind, Map<number, Float32Array>>;
}

/** Node index a civic building starts from, and the seconds to reach it. */
export function civicStart(
  sim: Sim,
  g: RoadGraph,
  c: { access: { seg: number; s: number } | null },
): { node: number; cost: number }[] {
  if (!c.access) return [];
  const seg = sim.state.net.segments.get(c.access.seg);
  if (!seg) return [];
  const len = sim.net.curve(seg.id).length;
  const v = ROAD_TYPES[seg.type].speed / 3.6;
  const a = g.index.get(seg.a);
  const b = g.index.get(seg.b);
  const out: { node: number; cost: number }[] = [];
  if (a !== undefined) out.push({ node: a, cost: c.access.s / v });
  if (b !== undefined) out.push({ node: b, cost: (len - c.access.s) / v });
  return out;
}

function samplesFor(len: number): number {
  return Math.max(2, Math.ceil(len / COVERAGE_STEP) + 1);
}

/**
 * Coverage from one service building, max-combined into `into`: a bounded Dijkstra in travel
 * time gives the seconds to each junction; each road touching a reached junction is sampled at
 * min(time via end a, time via end b, time straight from the building if it fronts that road).
 */
export function stationCoverage(
  sim: Sim,
  g: RoadGraph,
  c: Pick<Civic, 'access' | 'def'>,
  into: Map<number, Float32Array>,
): void {
  const def = CIVIC.get(c.def)!;
  const svc = def.service;
  if (!svc || !c.access) return;
  const eff = Math.min(1.25, sim.fundingEff(def.dept));
  const range = svc.range * (0.85 + 0.15 * eff);
  const value = Math.min(1, eff);
  const times = new Map<number, number>();
  dijkstra.run(g, civicStart(sim, g, c), range, (node, t) => {
    times.set(node, t);
    return true;
  });
  const segs = new Set<number>([c.access.seg]);
  for (const node of times.keys()) for (const id of sim.net.segmentsAt(g.ids[node]!)) segs.add(id);
  for (const id of [...segs].sort((a, b) => a - b)) {
    const seg = sim.state.net.segments.get(id);
    if (!seg || !ROAD_TYPES[seg.type].access) continue;
    const len = sim.net.curve(id).length;
    const v = ROAD_TYPES[seg.type].speed / 3.6;
    const ta = times.get(g.index.get(seg.a) ?? -1) ?? Infinity;
    const tb = times.get(g.index.get(seg.b) ?? -1) ?? Infinity;
    const own = id === c.access.seg ? c.access.s : -1;
    const n = samplesFor(len);
    let arr = into.get(id);
    for (let i = 0; i < n; i++) {
      const s = (len * i) / (n - 1);
      let t = Math.min(ta + s / v, tb + (len - s) / v);
      if (own >= 0) t = Math.min(t, Math.abs(s - own) / v);
      if (t >= range) continue;
      const cv = coverageAt(t, range, value);
      if (!arr) {
        arr = new Float32Array(n);
        into.set(id, arr);
      }
      if (cv > arr[i]!) arr[i] = cv;
    }
  }
}

/** Value at distance s along a segment of length len from its evenly spaced samples. */
export function sampleAt(arr: Float32Array, s: number, len: number): number {
  const f = Math.max(0, Math.min(1, s / Math.max(1e-6, len))) * (arr.length - 1);
  const i = Math.min(arr.length - 2, Math.floor(f));
  const k = f - i;
  return arr[i]! * (1 - k) + arr[i + 1]! * k;
}

/** Coverage at distance s along a segment, interpolated between samples. */
export function coverageOnSegment(
  cov: Coverage,
  kind: ServiceKind,
  seg: number,
  s: number,
  len: number,
): number {
  const arr = cov.kinds[kind].get(seg);
  return arr ? sampleAt(arr, s, len) : 0;
}

/**
 * Service coverage along every road (DESIGN §3.7). A pure function of the roads, service
 * buildings and funding, so the sim caches it and drops the cache whenever one of those changes.
 */
export function computeCoverage(sim: Sim): Coverage {
  const g = sim.graph();
  const kinds = {} as Record<ServiceKind, Map<number, Float32Array>>;
  for (const k of SERVICE_KINDS) kinds[k] = new Map();
  const civics = [...sim.state.civics.values()].sort((a, b) => a.id - b.id);
  for (const c of civics) {
    const svc = civicDef(c).service;
    if (svc && civicOnline(c)) stationCoverage(sim, g, c, kinds[svc.kind]);
  }
  return { graph: g, kinds };
}

/**
 * Hourly, first half: schools and clinics fill their nearest seats and beds first, and occupied homes
 * learn their school places and care. `applyCoverageFields` does the rest on the next tick.
 */
export function applyServiceLoads(sim: Sim, cov: Coverage): void {
  const g = cov.graph;
  sim.schoolUse.clear();
  const civics = [...sim.state.civics.values()].sort((a, b) => a.id - b.id);
  const byNode = new Map<number, Building[]>();
  const homes: Building[] = [];
  for (const b of sim.state.buildings.values()) {
    if (b.zone !== ZONE_R || b.state !== BState.Active || b.pop <= 0) continue;
    const att = attachmentOf(sim, g, b);
    if (!att) continue;
    homes.push(b);
    const list = byNode.get(att.node) ?? [];
    list.push(b);
    byNode.set(att.node, list);
  }
  // Seats per school level and hospital beds, each filled nearest-first from its building.
  const want = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
  const got = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
  const sick = new Map<number, number>();
  const beds = new Map<number, number>();
  for (const b of homes) {
    for (let l = 0; l < 3; l++) want[l]!.set(b.id, b.pop * EDUCATION.pupils[l]!);
    if (b.sick > 0) sick.set(b.id, b.sick);
  }
  for (const c of civics) {
    const def = civicDef(c);
    const svc = def.service;
    if (!svc?.capacity || (svc.kind !== 'education' && svc.kind !== 'health') || !civicOnline(c)) continue;
    const total = civicCapacity(c) * Math.min(1.25, sim.fundingEff(def.dept));
    const [need, have] =
      svc.kind === 'health' ? [sick, beds] : [want[(svc.level ?? 1) - 1]!, got[(svc.level ?? 1) - 1]!];
    const used = fill(sim, g, c, svc.range, total, byNode, need, have);
    sim.schoolUse.set(c.id, Math.round(used));
  }
  // Homes' school places (education coverage scaled by the seats they got) and hospital beds.
  for (const b of homes) {
    const acc = sim.buildingAccess(b);
    const len = acc ? sim.net.curve(acc.seg).length : 0;
    const edu = acc ? round(coverageOnSegment(cov, 'education', acc.seg, acc.s, len)) : 0;
    const share = (l: number) => {
      const w = want[l]!.get(b.id) ?? 0;
      return w > 0 ? round(Math.min(1, (got[l]!.get(b.id) ?? 0) / w)) : 0;
    };
    b.seat1 = share(0);
    b.seat2 = share(1);
    b.seat3 = share(2);
    let w = 0;
    let h = 0;
    for (let l = 0; l < 3; l++) {
      w += want[l]!.get(b.id) ?? 0;
      h += got[l]!.get(b.id) ?? 0;
    }
    b.covEdu = !acc ? 0 : w > 0 ? round((h / w) * Math.max(0.5, edu)) : edu;
    b.treated = b.sick > 0 ? round(Math.min(1, (beds.get(b.id) ?? 0) / b.sick)) : 0;
  }
}

/**
 * Every building's coverage by fire, police, health and parks (and education for businesses),
 * read off its road. The second half of the hourly coverage pass, on the tick after the first.
 */
export function applyCoverageFields(sim: Sim, cov: Coverage): void {
  for (const b of sim.state.buildings.values()) {
    const acc = b.state !== BState.Rubble ? sim.buildingAccess(b) : null;
    const len = acc ? sim.net.curve(acc.seg).length : 0;
    const at = (k: ServiceKind) => (acc ? round(coverageOnSegment(cov, k, acc.seg, acc.s, len)) : 0);
    b.covFire = at('fire');
    b.covPolice = at('police');
    b.covHealth = at('health');
    b.covPark = at('park');
    // Occupied homes on the road graph got their education and beds in the first half.
    if (b.zone === ZONE_R && b.state === BState.Active && b.pop > 0 && attachmentOf(sim, cov.graph, b))
      continue;
    if (b.zone === ZONE_R) {
      // Empty or cut-off homes: no places were filled for them.
      b.seat1 = b.seat2 = b.seat3 = 0;
      b.covEdu = acc ? at('education') : 0;
      b.treated = 0;
    } else b.covEdu = at('education');
  }
}

/** Fill `need` from one building's capacity, nearest homes first; returns the capacity used. */
function fill(
  sim: Sim,
  g: RoadGraph,
  c: Civic,
  range: number,
  capacity: number,
  byNode: Map<number, Building[]>,
  need: Map<number, number>,
  have: Map<number, number>,
): number {
  let left = capacity;
  dijkstra.run(g, civicStart(sim, g, c), range, (node) => {
    for (const b of byNode.get(node) ?? []) {
      const want = (need.get(b.id) ?? 0) - (have.get(b.id) ?? 0);
      if (want <= 0) continue;
      const take = Math.min(want, left);
      have.set(b.id, (have.get(b.id) ?? 0) + take);
      left -= take;
      if (left <= 0) return false;
    }
    return true;
  });
  return capacity - left;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Coverage at a world point, read off the nearest road. */
export function coverageNear(
  sim: Sim,
  cov: Coverage | null,
  x: number,
  z: number,
  kind: ServiceKind,
): number {
  if (!cov) return 0;
  const hit = sim.net.nearestSegment({ x, z }, 70);
  if (!hit) return 0;
  return coverageOnSegment(cov, kind, hit.seg, hit.s, sim.net.curve(hit.seg).length);
}

/** Coverage a hypothetical service building would give, as samples along each road (placement preview). */
export function coveragePreview(
  sim: Sim,
  def: string,
  x: number,
  z: number,
  angle: number,
  side: 1 | -1,
): { seg: number; v: number[] }[] {
  const d = CIVIC.get(def);
  if (!d?.service) return [];
  const access = findAccess(sim, { x, z, angle, side, def });
  if (!access) return [];
  const into = new Map<number, Float32Array>();
  stationCoverage(sim, sim.graph(), { access, def }, into);
  return [...into].map(([seg, arr]) => ({ seg, v: [...arr].map(round) }));
}
