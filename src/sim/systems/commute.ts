import { POLICY_EFFECTS } from '../../data/policies';
import { COMMUTE, DEMAND, DISTRICT, RAIL, TRAFFIC } from '../../data/balance';
import { districtAt } from './districts';
import { CIVIC } from '../../data/civic';
import { ROAD_TYPES } from '../../data/roads';
import { ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState, accessOf, type Building } from '../world/buildings';
import { Dijkstra, routeBetween, type RoadGraph } from './graph';
import { segSpeed } from './vehicles';
import {
  FlowAccumulator,
  TripReservoir,
  applyVolumes,
  congestedEdgeCosts,
  legsThroughTree,
  type TripSample,
} from './traffic';
import { busShare, busTime, busTraffic, stopsNearNodes } from './transit';
import { matchDayNow } from './projects';
import { railTerminals } from './rail';
import { regionRound } from './regionFlows';

/** Where a building joins the graph: nearest end node and the travel seconds to it. */
export interface Attachment {
  node: number; // graph index
  offset: number; // seconds
}

export function attachmentOf(sim: Sim, g: RoadGraph, b: Building): Attachment | null {
  const acc = accessOf(sim, b);
  if (!acc) return null;
  const seg = sim.state.net.segments.get(acc.seg);
  if (!seg) return null;
  const len = sim.net.curve(seg.id).length;
  const speed = ROAD_TYPES[seg.type].speed / 3.6;
  const toA = acc.s;
  const toB = len - acc.s;
  const nodeId = toA <= toB ? seg.a : seg.b;
  const idx = g.index.get(nodeId);
  if (idx === undefined) return null;
  return { node: idx, offset: Math.min(toA, toB) / speed + COMMUTE.accessSeconds };
}

const dijkstra = new Dijkstra();

export interface Slot {
  b: Building;
  att: Attachment;
  open: number;
}

export interface Origin {
  list: { b: Building; att: Attachment; workers: number; shoppers: number }[];
  workers: number;
  shoppers: number;
}

/**
 * Nearest-first matching of workers to jobs and shoppers to shops over the road graph, and the
 * resulting traffic: from each origin (a junction homes attach to, in turn), a Dijkstra over
 * rush-hour travel times fills open slots in order of time, and the trips are pushed back along the
 * search tree onto the roads. Freight then runs from industry to shops and to or from the highway.
 * Origins take turns going first each round.
 *
 * A round can run a slice of origins at a time (`step`), so a big city spreads it over a few ticks;
 * `finish` completes it and applies the traffic. The results are the same however it is sliced.
 */
export class MatchRound {
  private readonly g: RoadGraph;
  private readonly costs: Float64Array;
  private readonly flows: FlowAccumulator;
  private readonly trips: TripReservoir;
  private readonly jobsAt = new Map<number, Slot[]>();
  private readonly shopsAt = new Map<number, Slot[]>();
  private readonly origins = new Map<number, Origin>();
  private readonly order: number[];
  private readonly startAt: number;
  private readonly customers = new Map<number, number>();
  private readonly lines: ReturnType<Sim['lines']>;
  private readonly near: ReturnType<typeof stopsNearNodes>;
  private readonly riders: Float64Array;
  /** Riders boarding or leaving at each stop of each line this round (M20). */
  private readonly stopUse: Float64Array[];
  private readonly loadOf: number[];
  /** Free buses in force somewhere (M21: across the city or in some districts). */
  private readonly freeAnywhere: boolean;
  private readonly car = TRAFFIC.carShare / TRAFFIC.occupancy;
  private openJobs = 0;
  private openShops = 0;
  /** Origins matched so far. */
  private k = 0;

  constructor(private readonly sim: Sim) {
    const s = sim.state;
    const g = (this.g = sim.graph());
    this.costs = congestedEdgeCosts(sim, g, 1);
    this.flows = new FlowAccumulator(g);
    this.trips = new TripReservoir(sim);
    for (const b of s.buildings.values()) {
      if (b.state !== BState.Active) continue;
      const att = attachmentOf(sim, g, b);
      if (b.zone === ZONE_R) {
        b.employed = 0;
        b.commute = 0;
        b.shop = 0;
        b.toRegion = 0;
        const workers = Math.round(b.pop * DEMAND.workforceShare);
        b.seekers = workers;
        if (!att || b.pop <= 0) continue;
        const shoppers = b.pop;
        let o = this.origins.get(att.node);
        if (!o) this.origins.set(att.node, (o = { list: [], workers: 0, shoppers: 0 }));
        o.list.push({ b, att, workers, shoppers });
        o.workers += workers;
        o.shoppers += shoppers;
      } else if (b.zone === ZONE_C || b.zone === ZONE_I) {
        b.pop = 0;
        b.fromRegion = 0;
        if (b.zone === ZONE_C) b.shop = 0;
        if (!att || b.closed) continue;
        const list = this.jobsAt.get(att.node) ?? [];
        list.push({ b, att, open: b.cap });
        this.openJobs += b.cap;
        this.jobsAt.set(att.node, list);
        if (b.zone === ZONE_C) {
          const sl = this.shopsAt.get(att.node) ?? [];
          sl.push({ b, att, open: b.cap * COMMUTE.customersPerJob });
          this.openShops += b.cap * COMMUTE.customersPerJob;
          this.shopsAt.set(att.node, sl);
        }
      }
    }
    this.order = [...this.origins.keys()].sort((a, b) => a - b);
    // Buses: stops near each junction, riders per line this round.
    this.lines = sim.lines();
    this.near = this.lines.length ? stopsNearNodes(sim, this.lines) : new Map();
    this.riders = new Float64Array(this.lines.length);
    this.stopUse = this.lines.map((l) => new Float64Array(l.stops.length));
    this.loadOf = this.lines.map((l) => s.transit.load.get(l.depot) ?? 1);
    // Free buses: no fare makes the bus feel quicker in the choice between bus and car.
    this.freeAnywhere = sim.policyAnywhere('freeTransit');
    this.startAt = this.order.length ? s.cursors.matchRound % this.order.length : 0;
    if (this.order.length) s.cursors.matchRound++;
  }

  get size(): number {
    return this.order.length;
  }

  get done(): boolean {
    return this.k >= this.order.length;
  }

  /** Match up to `n` more origins. */
  step(n: number): void {
    for (; n > 0 && this.k < this.order.length; n--, this.k++)
      this.matchOrigin(this.order[(this.startAt + this.k) % this.order.length]!);
  }

  private matchOrigin(node: number): void {
    const { sim, g, lines, near, flows, trips, car, customers } = this;
    // Buildings gone since the round began (a fire or disaster between slices) drop out.
    const live = (b: Building) => b.state === BState.Active && sim.state.buildings.get(b.id) === b;
    const all = this.origins.get(node)!;
    const o = all.list.every((e) => live(e.b))
      ? all
      : {
          list: all.list.filter((e) => live(e.b)),
          workers: all.list.reduce((n, e) => n + (live(e.b) ? e.workers : 0), 0),
          shoppers: all.list.reduce((n, e) => n + (live(e.b) ? e.shoppers : 0), 0),
        };
    if (!o.list.length) return;
    // Free buses where people live (the city, or their district: M21) make the bus feel quicker.
    const at = sim.state.net.nodes.get(g.ids[node]!)!;
    const freeRide =
      this.freeAnywhere && sim.policyAt('freeTransit', at.x, at.z) ? POLICY_EFFECTS.freeTransitSeconds : 0;
    let workersLeft = o.workers;
    let shoppersLeft = o.shoppers;
    let employed = 0;
    let commuteSum = 0;
    let shopped = 0;
    const baseOffset = o.list.reduce((sum, e) => sum + e.att.offset, 0) / o.list.length;
    // With one-way roads (M19) the way home can differ from the way there: half of each trip's
    // load goes out along this tree and half comes back along a reverse search, below.
    const back = g.hasOneWay ? new Map<number, number>() : null;
    const load = (u: number, n: number) => {
      if (!back) return flows.addLoad(u, n);
      flows.addLoad(u, n / 2);
      back.set(u, (back.get(u) ?? 0) + n / 2);
    };
    let pick = 0;
    const home = () => o.list[pick++ % o.list.length]!.b;
    dijkstra.run(
      g,
      [{ node, cost: baseOffset }],
      COMMUTE.maxCommute,
      (u, cost) => {
        const jobs = this.jobsAt.get(u);
        if (jobs && workersLeft > 0) {
          for (const j of jobs) {
            if (j.open <= 0 || workersLeft <= 0 || !live(j.b)) continue;
            const t = cost + j.att.offset;
            if (t > COMMUTE.maxCommute) continue;
            const take = Math.min(j.open, workersLeft);
            j.open -= take;
            this.openJobs -= take;
            j.b.pop += take;
            workersLeft -= take;
            employed += take;
            const bus = lines.length ? busTime(lines, near, node, u) : null;
            const share = bus && bus.line >= 0 ? busShare(t, bus.t - freeRide, this.loadOf[bus.line]!) : 0;
            commuteSum += take * (share > 0 ? share * bus!.t + (1 - share) * t : t);
            if (share > 0) {
              const r = take * share * TRAFFIC.tripsPerWorker;
              this.riders[bus!.line] += r;
              this.stopUse[bus!.line]![bus!.a] += r;
              this.stopUse[bus!.line]![bus!.b] += r;
            }
            const n = take * TRAFFIC.tripsPerWorker * car * (1 - share);
            load(u, n);
            flows.addSegment(accessOf(sim, j.b)?.seg ?? -1, n);
            trips.offer(n, () => trip(sim, g, home(), j.b, u, 'work'));
          }
        }
        const shops = this.shopsAt.get(u);
        if (shops && shoppersLeft > 0 && cost <= COMMUTE.maxShopTrip) {
          for (const sh of shops) {
            if (sh.open <= 0 || shoppersLeft <= 0 || !live(sh.b)) continue;
            const take = Math.min(sh.open, shoppersLeft);
            sh.open -= take;
            this.openShops -= take;
            shoppersLeft -= take;
            shopped += take;
            customers.set(sh.b.id, (customers.get(sh.b.id) ?? 0) + take);
            const n = take * TRAFFIC.shopTripsPerResident * car;
            load(u, n);
            flows.addSegment(accessOf(sim, sh.b)?.seg ?? -1, n);
            trips.offer(n, () => trip(sim, g, home(), sh.b, u, 'shop'));
          }
        }
        // Search on only while something is left to find: once every job (or every shop slot
        // within a shopping trip) in the city is taken, farther nodes can't add anything.
        return (
          (workersLeft > 0 && this.openJobs > 0) ||
          (shoppersLeft > 0 && this.openShops > 0 && cost <= COMMUTE.maxShopTrip)
        );
      },
      this.costs,
      true,
    );
    flows.accumulate(dijkstra);
    if (back?.size) {
      for (const [u, l] of back) flows.addLoad(u, l);
      let left = back.size;
      const reached = new Set<number>();
      dijkstra.runReverse(
        g,
        [{ node, cost: 0 }],
        Infinity,
        (u) => {
          if (back.has(u)) {
            reached.add(u);
            left--;
          }
          return left > 0;
        },
        this.costs,
        true,
      );
      flows.accumulateReverse(dijkstra);
      // A job with no way home (a one-way dead end) keeps no phantom load for the next origin.
      for (const u of back.keys()) if (!reached.has(u)) flows.clearLoad(u);
    }
    // Share results among the origin's buildings (largest remainder, deterministic).
    const avgCommute = employed > 0 ? commuteSum / employed : 0;
    distribute(
      o.list,
      employed,
      (e) => e.workers,
      (e, v) => (e.b.employed = v),
    );
    const shopShare = o.shoppers > 0 ? shopped / o.shoppers : 0;
    for (const e of o.list) {
      e.b.commute = e.b.employed > 0 ? avgCommute : 0;
      e.b.shop = shopShare;
      // Trips on the home's own street.
      const acc = accessOf(sim, e.b);
      if (acc)
        flows.addSegment(
          acc.seg,
          (e.b.employed * TRAFFIC.tripsPerWorker + e.shoppers * shopShare * TRAFFIC.shopTripsPerResident) *
            car,
        );
    }
  }

  /** Match whatever is left, then settle shops, freight, buses and the traffic volumes. */
  finish(): void {
    const { sim, flows, lines } = this;
    const s = sim.state;
    this.step(Infinity);
    // The region (M23): neighbours' commuters and shoppers take what's left, the city's unemployed
    // take jobs out of town, and visitors travel from where they arrive.
    sim.regionFlows = regionRound(sim, {
      g: this.g,
      costs: this.costs,
      flows,
      trips: this.trips,
      jobsAt: this.jobsAt,
      shopsAt: this.shopsAt,
      customers: this.customers,
      origins: this.origins,
      car: this.car,
    });
    if (this.order.length || sim.regionFlows.shoppersIn > 0)
      for (const list of this.shopsAt.values()) {
        for (const sh of list) {
          const capacity = sh.b.cap * COMMUTE.customersPerJob;
          sh.b.shop = capacity > 0 ? (this.customers.get(sh.b.id) ?? 0) / capacity : 0;
        }
      }
    runFreight(sim, this.g, truckCosts(sim, this.g, this.costs), flows, this.trips, this.jobsAt);
    // Buses add a little traffic along their loops; full buses turn riders away next round.
    busTraffic(lines, (seg, pcu) => flows.addSegment(seg, pcu));
    s.transit.riders = new Map();
    s.transit.load = new Map();
    sim.stopUse = new Map();
    lines.forEach((line, i) => {
      line.stops.forEach((id, k) =>
        sim.stopUse.set(id, (sim.stopUse.get(id) ?? 0) + Math.round(this.stopUse[i]![k]!)),
      );
      const r = Math.round(this.riders[i]!);
      s.transit.riders.set(line.depot, r);
      const load = this.loadOf[i]!;
      const demand = ((this.riders[i]! / Math.max(0.05, load)) * TRAFFIC.peakShare) / 2;
      const target = demand > 0 ? Math.min(1, line.capacityPerHour / demand) : 1;
      s.transit.load.set(line.depot, Math.round((load + 0.5 * (target - load)) * 1000) / 1000);
    });
    applyVolumes(sim, flows.next);
    sim.tripSamples = this.trips.samples;
    sim.trafficChanged();
  }
}

/**
 * Trucks' edge costs (M21): a road in a district with a heavy-traffic ban counts DISTRICT.truckBan
 * times its time, so trucks go round where there's another way and still get in where there isn't.
 */
export function truckCosts(sim: Sim, g: RoadGraph, costs: Float64Array): Float64Array {
  const banned = sim.districtPolicies().get('heavyTrafficBan');
  if (!banned?.size) return costs;
  const cells = sim.state.districtCells;
  const out = costs.slice();
  const inside = new Map<number, boolean>();
  for (let k = 0; k < g.seg.length; k++) {
    const sid = g.seg[k]!;
    let b = inside.get(sid);
    if (b === undefined) {
      const c = sim.net.curve(sid);
      const p = c.pointAt(c.length / 2);
      b = banned.has(districtAt(cells, p.x, p.z));
      inside.set(sid, b);
    }
    if (b) out[k] = costs[k]! * DISTRICT.truckBan;
  }
  return out;
}

/**
 * Freight: industry ships to the nearest shops that need goods; what's left is exported via the
 * highway, and shops that still need goods import them from the highway. Trucks count extra.
 */
function runFreight(
  sim: Sim,
  g: RoadGraph,
  costs: Float64Array,
  flows: FlowAccumulator,
  trips: TripReservoir,
  jobsAt: Map<number, Slot[]>,
): void {
  const pcu = TRAFFIC.truckPcu;
  const need = new Map<number, { b: Building; att: Attachment; open: number }[]>();
  const makers: { node: number; b: Building; out: number }[] = [];
  for (const [node, list] of [...jobsAt].sort((a, b) => a[0] - b[0])) {
    for (const j of list) {
      if (j.b.zone === ZONE_C) {
        const open = j.b.pop * TRAFFIC.freightPerCommercialJob;
        if (open > 0) {
          const l = need.get(node) ?? [];
          l.push({ b: j.b, att: j.att, open });
          need.set(node, l);
        }
      } else if (j.b.zone === ZONE_I && j.b.pop > 0) {
        makers.push({ node, b: j.b, out: j.b.pop * TRAFFIC.freightPerIndustrialJob });
      }
    }
  }
  const exports = new Map<number, { amount: number; b: Building }>();
  const byNode = new Map<number, { b: Building; out: number }[]>();
  for (const m of makers) {
    const l = byNode.get(m.node) ?? [];
    l.push(m);
    byNode.set(m.node, l);
  }
  for (const [node, list] of [...byNode].sort((a, b) => a[0] - b[0])) {
    let left = list.reduce((sum, m) => sum + m.out, 0);
    const from = list[0]!.b;
    dijkstra.run(
      g,
      [{ node, cost: 0 }],
      COMMUTE.maxCommute,
      (u) => {
        for (const c of need.get(u) ?? []) {
          if (c.open <= 0 || left <= 0) continue;
          const take = Math.min(c.open, left);
          c.open -= take;
          left -= take;
          flows.addLoad(u, take * pcu);
          trips.offer(take * pcu, () => trip(sim, g, from, c.b, u, 'freight'));
        }
        return left > 0;
      },
      costs,
      true,
    );
    flows.accumulate(dijkstra);
    for (const m of list) flows.addSegment(accessOf(sim, m.b)?.seg ?? -1, m.out * pcu);
    if (left > 0) exports.set(node, { amount: left, b: from });
  }
  // Exports and imports use one tree grown from the highway connection.
  const hw = sim.state.highway;
  const hwNode = g.index.get(hw.connect);
  if (hwNode === undefined) return;
  let external = 0;
  const loads: {
    node: number;
    amount: number;
    id: number;
    acc: { seg: number; s: number } | null;
    purpose: 'export' | 'import' | 'event';
    /** Cars rather than trucks (the match-day crowd). */
    cars?: boolean;
  }[] = [];
  const load = (node: number, amount: number, b: Building, purpose: 'export' | 'import') =>
    loads.push({ node, amount, id: b.id, acc: accessOf(sim, b), purpose });
  for (const [node, e] of exports) load(node, e.amount, e.b, 'export');
  for (const [node, list] of need) for (const c of list) if (c.open > 0) load(node, c.open, c.b, 'import');
  // A match day (M17): the crowd drives in from the highway to the stadium.
  const match = matchDayNow(sim);
  const acc = match?.civic.access;
  const seg = acc && sim.state.net.segments.get(acc.seg);
  if (match && acc && seg) {
    const len = sim.net.curve(seg.id).length;
    const node = g.index.get(acc.s <= len / 2 ? seg.a : seg.b);
    if (node !== undefined)
      loads.push({ node, amount: match.trips, id: match.civic.id, acc, purpose: 'event', cars: true });
  }
  sim.railFreight = new Map();
  railFreight(sim, g, costs, flows, trips, loads, hwNode);
  if (!loads.length) return;
  const reach = new Set<number>();
  dijkstra.run(
    g,
    [{ node: hwNode, cost: 0 }],
    Infinity,
    (u) => {
      reach.add(u);
      return true;
    },
    costs,
    true,
  );
  let crowd = 0;
  // With one-way roads (M19) exports leave by their own route to the highway (below).
  const outbound = g.hasOneWay ? loads.filter((l) => l.purpose === 'export') : [];
  for (const l of loads) {
    if (!reach.has(l.node) || outbound.includes(l)) continue;
    const units = l.amount * (l.cars ? 1 : pcu);
    if (l.cars) crowd += l.amount;
    else external += l.amount;
    flows.addLoad(l.node, units);
    flows.addSegment(l.acc?.seg ?? -1, units);
    trips.offer(units, () => {
      const legs = legsThroughTree(sim, g, dijkstra, null, l.node, l.acc);
      const out = sim.net.curve(hw.segment).length;
      const hwSeg = sim.state.net.segments.get(hw.segment)!;
      const toOutside = hwSeg.a === hw.connect ? { s0: 0, s1: out } : { s0: out, s1: 0 };
      // The tree runs from the highway to the building; reverse it for exports.
      const inbound = [{ seg: hw.segment, s0: toOutside.s1, s1: toOutside.s0 }, ...legs];
      const outbound = [...inbound].reverse().map((x) => ({ seg: x.seg, s0: x.s1, s1: x.s0 }));
      return {
        from: l.id,
        to: 0,
        purpose: l.purpose,
        legs: l.purpose === 'export' ? outbound : inbound,
        weight: units,
      };
    });
  }
  flows.accumulate(dijkstra);
  if (outbound.length) {
    const out = sim.net.curve(hw.segment).length;
    const hwSeg = sim.state.net.segments.get(hw.segment)!;
    const outside = { seg: hw.segment, s: hwSeg.a === hw.connect ? out : 0 };
    const reachOut = new Set<number>();
    dijkstra.runReverse(
      g,
      [{ node: hwNode, cost: 0 }],
      Infinity,
      (u) => {
        reachOut.add(u);
        return true;
      },
      costs,
      true,
    );
    for (const l of outbound) {
      if (!reachOut.has(l.node)) continue;
      const units = l.amount * pcu;
      external += l.amount;
      flows.addLoad(l.node, units);
      flows.addSegment(l.acc?.seg ?? -1, units);
      const acc = l.acc;
      trips.offer(units, () => {
        const legs = acc ? routeBetween(g, sim.net, acc, outside, (sg) => segSpeed(sim, sg)) : null;
        return legs?.length ? { from: l.id, to: 0, purpose: 'export', legs, weight: units } : null;
      });
    }
    flows.accumulateReverse(dijkstra);
  }
  flows.addSegment(hw.segment, external * pcu + crowd);
}

/** An export, import or match-day crowd heading for the highway (see runFreight). */
interface ExternalLoad {
  node: number;
  amount: number;
  id: number;
  acc: { seg: number; s: number } | null;
  purpose: 'export' | 'import' | 'event';
  cars?: boolean;
}

/**
 * Rail freight (M20): exports and imports go through a rail freight terminal linked to the regional
 * railway when the drive there plus loading (RAIL.freightHandling) beats the drive to the highway,
 * up to what the terminal can load a day; trains take them on from there, off the roads. Takes those
 * trucks out of `loads` and records each terminal's day in `sim.railFreight`.
 */
function railFreight(
  sim: Sim,
  g: RoadGraph,
  costs: Float64Array,
  flows: FlowAccumulator,
  trips: TripReservoir,
  loads: ExternalLoad[],
  hwNode: number,
): void {
  const terminals = railTerminals(sim);
  if (!terminals.length || !loads.some((l) => l.purpose !== 'event')) return;
  const pcu = TRAFFIC.truckPcu;
  // Drive times to the highway, to weigh against.
  const toHw = new Float64Array(g.size).fill(Infinity);
  dijkstra.run(
    g,
    [{ node: hwNode, cost: 0 }],
    Infinity,
    (u, cost) => {
      toHw[u] = cost;
      return true;
    },
    costs,
    true,
  );
  for (const t of terminals) {
    const acc = t.access!;
    const seg = sim.state.net.segments.get(acc.seg);
    if (!seg) continue;
    const len = sim.net.curve(acc.seg).length;
    const node = g.index.get(acc.s <= len / 2 ? seg.a : seg.b);
    if (node === undefined) continue;
    let left = CIVIC.get(t.def)!.railFreight!.trucks;
    const at = new Float64Array(g.size).fill(Infinity);
    dijkstra.run(
      g,
      [{ node, cost: RAIL.freightHandling }],
      Infinity,
      (u, cost) => {
        at[u] = cost;
        return true;
      },
      costs,
      true,
    );
    let moved = 0;
    for (const l of loads) {
      if (l.purpose === 'event' || l.amount <= 0 || left <= 0) continue;
      if (!(at[l.node]! < toHw[l.node]!)) continue;
      const take = Math.min(l.amount, left);
      left -= take;
      l.amount -= take;
      moved += take;
      const units = take * pcu;
      flows.addLoad(l.node, units);
      flows.addSegment(l.acc?.seg ?? -1, units);
      trips.offer(units, () => {
        const legs = legsThroughTree(sim, g, dijkstra, acc, l.node, l.acc);
        if (!legs.length) return null;
        const out = [...legs].reverse().map((x) => ({ seg: x.seg, s0: x.s1, s1: x.s0 }));
        return {
          from: l.id,
          to: t.id,
          purpose: l.purpose,
          legs: l.purpose === 'export' ? out : legs,
          weight: units,
        };
      });
    }
    flows.accumulate(dijkstra);
    flows.addSegment(acc.seg, moved * pcu);
    sim.railFreight.set(t.id, Math.round(moved));
  }
  // Loads the terminals took in full drop out; the rest drive to the highway as before.
  for (let i = loads.length - 1; i >= 0; i--) if (loads[i]!.amount <= 1e-9) loads.splice(i, 1);
}

/** A sampled trip from building `a` to building `b` (reached at node `u` of the current tree). */
function trip(
  sim: Sim,
  g: RoadGraph,
  a: Building,
  b: Building,
  u: number,
  purpose: 'work' | 'shop' | 'freight',
): TripSample | null {
  const legs = legsThroughTree(sim, g, dijkstra, accessOf(sim, a), u, accessOf(sim, b));
  if (!legs.length) return null;
  const sample: TripSample = { from: a.id, to: b.id, purpose, legs, weight: 1 };
  // A route out along a one-way road (M19) can't simply be driven backwards to get home.
  const from = accessOf(sim, b);
  const to = accessOf(sim, a);
  if (g.hasOneWay && from && to && legs.some((l) => sim.state.net.segments.get(l.seg)?.oneway)) {
    const home = routeBetween(g, sim.net, from, to, (seg) => segSpeed(sim, seg));
    if (home?.length) sample.back = home;
  }
  return sample;
}

function distribute<T>(
  items: T[],
  total: number,
  weight: (t: T) => number,
  set: (t: T, v: number) => void,
): void {
  const sum = items.reduce((s, t) => s + weight(t), 0);
  if (sum <= 0) {
    for (const t of items) set(t, 0);
    return;
  }
  let given = 0;
  const rems: { t: T; r: number; i: number }[] = [];
  items.forEach((t, i) => {
    const exact = (total * weight(t)) / sum;
    const v = Math.floor(exact);
    set(t, v);
    given += v;
    rems.push({ t, r: exact - v, i });
  });
  rems.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; k < total - given && k < rems.length; k++) {
    const e = rems[k]!;
    set(e.t, Math.floor((total * weight(e.t)) / sum) + 1);
  }
}
