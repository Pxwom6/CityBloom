import { COMMUTE, DEMAND, TRAFFIC } from '../../data/balance';
import { CIVIC } from '../../data/civic';
import { ROAD_TYPES } from '../../data/roads';
import { NEIGHBOUR_KIND, REGION } from '../../data/region';
import type { Sim } from '../sim';
import { accessOf, type Building } from '../world/buildings';
import { civicOnline } from '../world/civic';
import type { Origin, Slot } from './commute';
import { Dijkstra, routeBetween, type Leg, type RoadGraph } from './graph';
import { linkedToRegion } from './rail';
import type { FlowAccumulator, TripPurpose, TripReservoir, TripSample } from './traffic';
import { legsThroughTree } from './traffic';
import { segSpeed } from './vehicles';
import { seasonAt } from './weather';

/**
 * Regional commuters, shoppers and visitors (M23), DESIGN.md §3.24. After the city's own residents
 * have taken the jobs and shop visits they can reach, the neighbours' workers fill jobs still open
 * within a commute of the edge, the city's unemployed take jobs in the neighbours, the neighbours'
 * shoppers use what shop capacity is left near the edge, and the day's visitors travel from where
 * they arrive (highway, a regional station, the airport, the seaport) to the sights. Everything
 * drives the same roads as everyone else: it's all in the traffic volumes and the sampled trips.
 */

export type EntryMode = 'road' | 'rail' | 'air' | 'sea';

/** A way into the city: a road node, what share of arrivals use it, and the time spent getting there. */
interface Entry {
  node: number;
  mode: EntryMode;
  share: number;
  /** Seconds already travelled when arriving here. */
  cost: number;
  /** Cars per person travelling on from here (drivers from the highway, taxis from a station). */
  car: number;
}

export interface RegionFlows {
  commutersIn: number;
  commutersOut: number;
  shoppersIn: number;
  /** Regional commuters and shoppers who came by train. */
  byRail: number;
  visitors: Record<EntryMode, number>;
  /** Per neighbour: commuters in, residents working there, shoppers from there. */
  byNeighbour: { id: number; in: number; out: number; shop: number }[];
}

export function emptyRegionFlows(): RegionFlows {
  return {
    commutersIn: 0,
    commutersOut: 0,
    shoppersIn: 0,
    byRail: 0,
    visitors: { road: 0, rail: 0, air: 0, sea: 0 },
    byNeighbour: [],
  };
}

const dijkstra = new Dijkstra();

/** Nearest road node to a point, within `max` metres (graph index), for stations and ports. */
function nodeNear(sim: Sim, g: RoadGraph, x: number, z: number, max: number): number | undefined {
  let best: number | undefined;
  let bd = max * max;
  for (const n of sim.state.net.nodes.values()) {
    const i = g.index.get(n.id);
    if (i === undefined) continue;
    // A node on the road network: the nearest to a station is always one of its railway's own
    // (Phase 2 review: regional riders arrived there and could go nowhere).
    if (!sim.net.segmentsAt(n.id).some((sg) => ROAD_TYPES[sim.net.segment(sg).type].access)) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Railway stations in service on track linked to the regional railway (M20), with their road node. */
export function regionalStations(sim: Sim, g: RoadGraph): number[] {
  const out: number[] = [];
  for (const c of [...sim.state.civics.values()].sort((a, b) => a.id - b.id)) {
    const def = CIVIC.get(c.def);
    if (!def?.rail || def.track !== 'rail' || !c.access || !civicOnline(c)) continue;
    if (!linkedToRegion(sim, c.access.seg)) continue;
    const node = nodeNear(sim, g, c.x, c.z, 400);
    if (node !== undefined) out.push(node);
  }
  return out;
}

/** Where visitors arrive, by mode: the airport's and seaport's road nodes (M23). */
export function portNodes(sim: Sim, g: RoadGraph, kind: 'airport' | 'seaport'): number[] {
  const out: number[] = [];
  for (const c of [...sim.state.civics.values()].sort((a, b) => a.id - b.id)) {
    const def = CIVIC.get(c.def);
    if (!(kind === 'airport' ? def?.airport : def?.seaport) || !c.access || !civicOnline(c)) continue;
    const seg = sim.state.net.segments.get(c.access.seg);
    if (!seg) continue;
    const len = sim.net.curve(seg.id).length;
    const node = g.index.get(c.access.s <= len / 2 ? seg.a : seg.b);
    if (node !== undefined) out.push(node);
  }
  return out;
}

/** Legs in from the edge of the map along the highway, then through the tree to `u` and on to `to`. */
function inboundLegs(
  sim: Sim,
  g: RoadGraph,
  u: number,
  to: { seg: number; s: number } | null,
  road: boolean,
): Leg[] {
  const legs = legsThroughTree(sim, g, dijkstra, null, u, to);
  if (!road) return legs;
  const hw = sim.state.highway;
  const len = sim.net.curve(hw.segment).length;
  const hwSeg = sim.state.net.segments.get(hw.segment)!;
  const outside = hwSeg.a === hw.connect ? len : 0;
  return [{ seg: hw.segment, s0: outside, s1: len - outside }, ...legs];
}

interface Pools {
  workers: number;
  jobs: number;
  shoppers: number;
  per: { id: number; workers: number; jobs: number; shoppers: number }[];
}

/**
 * What the neighbours send and offer today. Their workers and shoppers come as the city becomes a
 * place worth the drive: a few for a village's jobs and shops, all of them once it has thousands.
 */
function pools(sim: Sim): Pools {
  const season = seasonAt(sim.state.weather, sim.state.tick);
  const t = sim.state.totals;
  const forJobs = Math.min(1, REGION.attractBase + t.jobs / REGION.attractJobs);
  const forShops = Math.min(1, REGION.attractBase + t.cJobs / REGION.attractShops);
  const per = sim.state.region.neighbours.map((n) => {
    const p = NEIGHBOUR_KIND[n.kind].per;
    const k = n.population / 1000;
    const seasonal = n.kind === 'resort' ? REGION.resortSeason[season] : 1;
    return {
      id: n.id,
      workers: p.commutersIn * k * forJobs,
      jobs: p.jobsOut * k,
      shoppers: p.shoppers * k * seasonal * forShops,
    };
  });
  return {
    workers: per.reduce((a, b) => a + b.workers, 0),
    jobs: per.reduce((a, b) => a + b.jobs, 0),
    shoppers: per.reduce((a, b) => a + b.shoppers, 0),
    per,
  };
}

export interface RegionRoundInput {
  g: RoadGraph;
  costs: Float64Array;
  flows: FlowAccumulator;
  trips: TripReservoir;
  jobsAt: Map<number, Slot[]>;
  shopsAt: Map<number, Slot[]>;
  customers: Map<number, number>;
  origins: Map<number, Origin>;
  /** Cars per commuter (car share / occupancy). */
  car: number;
}

/** The regional part of a matching round (after the city's own residents are matched). */
export function regionRound(sim: Sim, r: RegionRoundInput): RegionFlows {
  const out = emptyRegionFlows();
  const { g, costs, flows, trips, car } = r;
  const hwNode = g.index.get(sim.state.highway.connect);
  if (hwNode === undefined || !sim.state.region.neighbours.length) return out;
  const approach = REGION.approachMinutes * 60;
  const stations = regionalStations(sim, g);
  const rail = stations.length ? REGION.railShare : 0;
  // Stations first (Phase 2 review): each entry fills the open jobs nearest it until its share of
  // the workers is placed, and the highway's larger share, matched first, took every open job
  // before a train's riders got a look in.
  const entries: Entry[] = stations.map((node) => ({
    node,
    mode: 'rail' as const,
    share: rail / stations.length,
    cost: approach * 0.8 + 120,
    car: car * 0.3,
  }));
  entries.push({ node: hwNode, mode: 'road', share: 1 - rail, cost: approach, car });
  const p = pools(sim);
  const live = (b: Building) => sim.state.buildings.get(b.id) === b;
  let hwCars = 0;

  // --- Neighbours' workers into jobs still open, nearest the way in first. ---
  let inTotal = 0;
  let shopTotal = 0;
  for (const e of entries) {
    let workers = Math.round(p.workers * e.share);
    let shoppers = Math.round(p.shoppers * e.share);
    if (workers <= 0 && shoppers <= 0) continue;
    let cars = 0;
    dijkstra.run(
      g,
      [{ node: e.node, cost: e.cost }],
      COMMUTE.maxCommute,
      (u, cost) => {
        for (const j of r.jobsAt.get(u) ?? []) {
          if (j.open <= 0 || workers <= 0 || !live(j.b)) continue;
          if (cost + j.att.offset > COMMUTE.maxCommute) continue;
          const take = Math.min(j.open, workers);
          j.open -= take;
          j.b.pop += take;
          j.b.fromRegion = (j.b.fromRegion ?? 0) + take;
          workers -= take;
          inTotal += take;
          if (e.mode === 'rail') out.byRail += take;
          const n = take * TRAFFIC.tripsPerWorker * e.car;
          cars += n;
          flows.addLoad(u, n);
          flows.addSegment(accessOf(sim, j.b)?.seg ?? -1, n);
          const b = j.b;
          trips.offer(n, () => sample(sim, g, u, b, 'incommute', e.mode === 'road'));
        }
        if (shoppers > 0 && cost - e.cost <= COMMUTE.maxShopTrip)
          for (const sh of r.shopsAt.get(u) ?? []) {
            if (sh.open <= 0 || shoppers <= 0 || !live(sh.b)) continue;
            const take = Math.min(sh.open, shoppers);
            sh.open -= take;
            shoppers -= take;
            shopTotal += take;
            if (e.mode === 'rail') out.byRail += take;
            r.customers.set(sh.b.id, (r.customers.get(sh.b.id) ?? 0) + take);
            const n = take * TRAFFIC.shopTripsPerResident * e.car;
            cars += n;
            flows.addLoad(u, n);
            flows.addSegment(accessOf(sim, sh.b)?.seg ?? -1, n);
            const b = sh.b;
            trips.offer(n, () => sample(sim, g, u, b, 'regionshop', e.mode === 'road'));
          }
        return workers > 0 || (shoppers > 0 && cost - e.cost <= COMMUTE.maxShopTrip);
      },
      costs,
      true,
    );
    flows.accumulate(dijkstra);
    if (e.mode === 'road') hwCars += cars;
  }
  out.commutersIn = inTotal;
  out.shoppersIn = shopTotal;

  // --- The city's unemployed into the neighbours' jobs, those nearest the highway first. ---
  let jobs = Math.round(p.jobs);
  let outTotal = 0;
  if (jobs > 0) {
    let cars = 0;
    const loads = new Map<number, number>();
    // Time from each home to the highway: a reverse search where one-way roads (M19) make it
    // differ from the way back; otherwise the forward search is the same and needs no reverse graph.
    const search = (g.hasOneWay ? dijkstra.runReverse : dijkstra.run).bind(dijkstra);
    search(
      g,
      [{ node: hwNode, cost: 0 }],
      COMMUTE.maxCommute - approach,
      (u, cost) => {
        const o = r.origins.get(u);
        if (o)
          for (const e of o.list) {
            if (jobs <= 0) break;
            if (!live(e.b)) continue;
            // Those still here (a fire or disaster may have emptied some homes since the round
            // began), and only some of those without work: the rest keep looking in town.
            const idle = Math.floor(
              (Math.min(e.workers, Math.round(e.b.pop * DEMAND.workforceShare)) - e.b.employed) *
                REGION.outShare,
            );
            if (idle <= 0) continue;
            const take = Math.min(idle, jobs);
            const t = cost + e.att.offset + approach;
            e.b.commute = (e.b.commute * e.b.employed + t * take) / (e.b.employed + take);
            e.b.employed += take;
            e.b.toRegion = take;
            jobs -= take;
            outTotal += take;
            const trainShare = rail;
            if (trainShare) out.byRail += take * trainShare;
            const n = take * TRAFFIC.tripsPerWorker * car * (1 - trainShare);
            cars += n;
            loads.set(u, (loads.get(u) ?? 0) + n);
            flows.addSegment(accessOf(sim, e.b)?.seg ?? -1, n);
            const home = e.b;
            trips.offer(n, () => outboundSample(sim, g, home));
          }
        return jobs > 0;
      },
      costs,
      true,
    );
    for (const [u, n] of loads) flows.addLoad(u, n);
    if (g.hasOneWay) flows.accumulateReverse(dijkstra);
    else flows.accumulate(dijkstra);
    hwCars += cars;
  }
  out.commutersOut = outTotal;

  // --- Visitors, from where they arrive to the sights and hotels. ---
  const by = sim.state.tourism.by;
  const visitorEntries: { mode: EntryMode; nodes: number[]; people: number; car: number }[] = [];
  if (by) {
    visitorEntries.push({ mode: 'road', nodes: [hwNode], people: by.road, car });
    if (stations.length)
      visitorEntries.push({ mode: 'rail', nodes: stations, people: by.rail, car: car * 0.3 });
    visitorEntries.push({ mode: 'air', nodes: portNodes(sim, g, 'airport'), people: by.air, car: car * 0.6 });
    visitorEntries.push({ mode: 'sea', nodes: portNodes(sim, g, 'seaport'), people: by.sea, car: car * 0.6 });
  }
  const sights = sightsByNode(sim, g);
  for (const v of visitorEntries) {
    if (v.people <= 0 || !v.nodes.length) continue;
    // They come whether or not there's a sight to drive to; with none, they stay near where they arrive.
    out.visitors[v.mode] += v.people;
    if (!sights.size) continue;
    for (const node of v.nodes) {
      const people = v.people / v.nodes.length;
      let cars = 0;
      const left = new Set(sights.keys());
      dijkstra.run(
        g,
        [{ node, cost: 0 }],
        Infinity,
        (u) => {
          const s = sights.get(u);
          if (s) {
            left.delete(u);
            for (const x of s) {
              const n = people * x.share * 2 * v.car;
              cars += n;
              flows.addLoad(u, n);
              flows.addSegment(x.seg, n);
              const to = x;
              trips.offer(n, () => visitSample(sim, g, u, to, v.mode === 'road'));
            }
          }
          return left.size > 0;
        },
        costs,
        true,
      );
      flows.accumulate(dijkstra);
      if (v.mode === 'road') hwCars += cars;
    }
  }
  flows.addSegment(sim.state.highway.segment, hwCars);

  // Shares by neighbour, for the panel and the inspector.
  out.byNeighbour = p.per.map((n) => ({
    id: n.id,
    in: p.workers > 0 ? Math.round((inTotal * n.workers) / p.workers) : 0,
    out: p.jobs > 0 ? Math.round((outTotal * n.jobs) / p.jobs) : 0,
    shop: p.shoppers > 0 ? Math.round((shopTotal * n.shoppers) / p.shoppers) : 0,
  }));
  out.byRail = Math.round(out.byRail);
  return out;
}

interface Sight {
  id: number;
  seg: number;
  acc: { seg: number; s: number };
  share: number;
}

/** Landmarks and hotels by road node, each with its share of the day's visitors. */
function sightsByNode(sim: Sim, g: RoadGraph): Map<number, Sight[]> {
  const list: Sight[] = [];
  let total = 0;
  for (const c of [...sim.state.civics.values()].sort((a, b) => a.id - b.id)) {
    const t = CIVIC.get(c.def)?.tourism;
    if (!t || !c.access || !civicOnline(c)) continue;
    const w = (t.draw ?? 0) + (t.rooms ?? 0) * 0.5;
    if (w <= 0) continue;
    total += w;
    list.push({ id: c.id, seg: c.access.seg, acc: c.access, share: w });
  }
  const out = new Map<number, Sight[]>();
  for (const s of list) {
    const seg = sim.state.net.segments.get(s.seg);
    if (!seg) continue;
    const len = sim.net.curve(seg.id).length;
    const node = g.index.get(s.acc.s <= len / 2 ? seg.a : seg.b);
    if (node === undefined) continue;
    s.share /= total;
    const l = out.get(node) ?? [];
    l.push(s);
    out.set(node, l);
  }
  return out;
}

function sample(
  sim: Sim,
  g: RoadGraph,
  u: number,
  b: Building,
  purpose: TripPurpose,
  road: boolean,
): TripSample | null {
  const legs = inboundLegs(sim, g, u, accessOf(sim, b), road);
  return legs.length ? { from: 0, to: b.id, purpose, legs, weight: 1 } : null;
}

function visitSample(sim: Sim, g: RoadGraph, u: number, s: Sight, road: boolean): TripSample | null {
  const legs = inboundLegs(sim, g, u, s.acc, road);
  return legs.length ? { from: 0, to: s.id, purpose: 'visit', legs, weight: 1 } : null;
}

/** A resident driving out to work in a neighbouring town: home to the edge of the map. */
function outboundSample(sim: Sim, g: RoadGraph, home: Building): TripSample | null {
  const acc = accessOf(sim, home);
  const hw = sim.state.highway;
  const len = sim.net.curve(hw.segment).length;
  const hwSeg = sim.state.net.segments.get(hw.segment)!;
  const outside = { seg: hw.segment, s: hwSeg.a === hw.connect ? len : 0 };
  const legs = acc ? routeBetween(g, sim.net, acc, outside, (sg) => segSpeed(sim, sg)) : null;
  return legs?.length ? { from: home.id, to: 0, purpose: 'outcommute', legs, weight: 1 } : null;
}
