import { RAIL, TRAFFIC, TRAM, TRANSIT } from '../../data/balance';
import { ROAD_TYPES } from '../../data/roads';
import { fail, ok, type CommandResult } from '../commands';
import type { Sim } from '../sim';
import { civicBuses, civicDef, civicOnline } from '../world/civic';
import { routeBetween, type Leg } from './graph';

/**
 * Buses (DESIGN §3.8): the player places a depot and stops; each stop is served by the depot it
 * can reach soonest, and each depot runs its buses round one loop through its stops. Commuters
 * compare door-to-door times by car and by bus; riders leave their cars at home.
 */

export interface BusStop {
  id: number;
  x: number;
  z: number;
  seg: number;
  s: number;
  /** A tram stop (M20), on a road with tram track; bus stops otherwise. */
  tram?: true;
}

export interface TransitState {
  stops: Map<number, BusStop>;
  /** Riders per day on each depot's line at the last assignment round. */
  riders: Map<number, number>;
  /** Share of would-be riders who fit on each line (1 unless the buses are full). */
  load: Map<number, number>;
}

export function emptyTransit(): TransitState {
  return { stops: new Map(), riders: new Map(), load: new Map() };
}

export interface BusLine {
  /** Buses or trams (M20) from a depot, or trains between stations (M20). */
  mode: 'bus' | 'tram' | 'train';
  /** The depot (buses, trams), or the station at one end of the line (trains). */
  depot: number;
  /** Stop ids in the order the buses visit them (station ids for trains). */
  stops: number[];
  /** Where each stop is, for walking to it. */
  stopPos: { x: number; z: number }[];
  /**
   * Trains shuttle along their line and back (a ride between two stations is the time between them,
   * either way); buses go round a loop.
   */
  shuttle: boolean;
  /** The whole loop from the depot through every stop and back. */
  legs: Leg[];
  /** Seconds from leaving the depot to reaching each stop. */
  stopTime: number[];
  loopTime: number;
  buses: number;
  headway: number;
  /** Passengers per hour the line can carry past any point. */
  capacityPerHour: number;
}

const SNAP = 14;

/** The nearest road a stop can go on: any local road for buses, one with tram track for trams. */
function snapToRoad(
  sim: Sim,
  x: number,
  z: number,
  tram: boolean,
): { seg: number; s: number; x: number; z: number } | null {
  const hit = sim.net.nearestSegment({ x, z }, SNAP, (id) => {
    const seg = sim.net.segment(id);
    return tram ? !!seg.tram : ROAD_TYPES[seg.type].access;
  });
  return hit ? { seg: hit.seg, s: hit.s, x: hit.x, z: hit.z } : null;
}

export function placeStop(sim: Sim, x: number, z: number, dryRun: boolean, tram = false): CommandResult {
  const s = sim.state;
  const at = snapToRoad(sim, x, z, tram);
  if (!at)
    return fail(tram ? 'Tram stops go on a road with tram track' : 'Bus stops go beside a road', {
      at: { x, z },
    });
  if (tram && !sim.isUnlocked(TRAM.unlockPopulation))
    return fail(`Trams unlock at ${TRAM.unlockPopulation.toLocaleString('en-US')} residents`, { at });
  // A tram stop can stand beside a bus stop (people change there), not beside another tram stop.
  for (const st of s.transit.stops.values())
    if (!!st.tram === tram && Math.hypot(st.x - at.x, st.z - at.z) < 40)
      return fail('Too close to another stop', { at });
  if (TRANSIT.stopCost > s.treasury && !s.options.sandbox) return fail('Not enough money', { at });
  if (dryRun) return ok(TRANSIT.stopCost, { info: { x: at.x, z: at.z, seg: at.seg } });
  const stop: BusStop = {
    id: s.nextId++,
    x: at.x,
    z: at.z,
    seg: at.seg,
    s: at.s,
    ...(tram ? { tram: true } : {}),
  };
  s.transit.stops.set(stop.id, stop);
  sim.spend(TRANSIT.stopCost, 'transit');
  sim.transitChanged();
  return ok(TRANSIT.stopCost, { created: [stop.id] });
}

export function removeStop(sim: Sim, id: number, dryRun: boolean, refundShare = 0.25): CommandResult {
  const stop = sim.state.transit.stops.get(id);
  if (!stop) return fail('Nothing to bulldoze');
  const refund = Math.round(TRANSIT.stopCost * refundShare);
  if (dryRun) return ok(-refund, { info: { refund } });
  sim.state.transit.stops.delete(id);
  sim.earn(refund, 'refunds');
  sim.transitChanged();
  return ok(-refund, { info: { refund } });
}

/** After the road network changes, stops follow their road (tram stops, its track) or go if it's gone. */
export function relocateStops(sim: Sim): boolean {
  let changed = false;
  for (const st of [...sim.state.transit.stops.values()].sort((a, b) => a.id - b.id)) {
    const seg = sim.state.net.segments.get(st.seg);
    if (seg && (!st.tram || seg.tram)) {
      const p = sim.net.curve(st.seg).project({ x: st.x, z: st.z });
      if (p.d < 1) continue;
    }
    const at = snapToRoad(sim, st.x, st.z, !!st.tram);
    if (!at) sim.state.transit.stops.delete(st.id);
    else Object.assign(st, at);
    changed = true;
  }
  return changed;
}

/**
 * Seconds to drive a leg at rush-hour speeds; trams (M20) feel `share` of the road's congestion delay.
 */
function legSeconds(sim: Sim, l: Leg, peak: Float64Array, share = 1): number {
  const g = sim.graph();
  const seg = sim.state.net.segments.get(l.seg);
  if (!seg) return 0;
  const len = sim.net.curve(l.seg).length;
  const free = g.segSeconds.get(l.seg) ?? len / (ROAD_TYPES[seg.type].speed / 3.6);
  // The congested/free ratio of this segment, from any of its edges.
  const ia = g.index.get(seg.a)!;
  let ratio = 1;
  for (let k = g.start[ia]!; k < g.start[ia + 1]!; k++)
    if (g.seg[k] === l.seg) {
      ratio = peak[k]! / Math.max(1e-6, g.cost[k]!);
      break;
    }
  return (Math.abs(l.s1 - l.s0) / Math.max(1e-6, len)) * free * (1 + (ratio - 1) * share);
}

/** Every bus, tram (M20) and train (M20) line. A pure function of the network, depots, stops, funding and traffic. */
export function computeLines(sim: Sim): BusLine[] {
  return [...loopLines(sim, 'bus'), ...loopLines(sim, 'tram'), ...trainLines(sim)];
}

/**
 * Every bus or tram depot's loop. Stops go to the depot that reaches them soonest; each loop visits
 * its stops nearest-first from the depot. Buses drive any road; trams keep to their track.
 */
function loopLines(sim: Sim, mode: 'bus' | 'tram'): BusLine[] {
  const s = sim.state;
  const tram = mode === 'tram';
  const depots = [...s.civics.values()]
    .filter((c) => (tram ? civicDef(c).tram : civicDef(c).transit) && c.access && civicOnline(c))
    // Trams leave the depot along the tracked road it faces.
    .filter((c) => !tram || !!s.net.segments.get(c.access!.seg)?.tram)
    .sort((a, b) => a.id - b.id);
  const stops = [...s.transit.stops.values()].filter((st) => !!st.tram === tram).sort((a, b) => a.id - b.id);
  if (!depots.length || stops.length < 2) return [];
  const g = tram ? sim.tramGraph() : sim.graph();
  const peak = sim.peakCosts();
  const share = tram ? TRAM.trafficShare : 1;
  const secs = (l: Leg) => legSeconds(sim, l, peak, share);
  const speed = (id: number) => (ROAD_TYPES[sim.net.segment(id).type].speed / 3.6) * 0.999;
  // Buses pick their way round the rush-hour traffic; trams follow the track.
  const route = (a: { seg: number; s: number }, b: { seg: number; s: number }) =>
    tram ? routeBetween(g, sim.net, a, b, speed) : routeBetween(g, sim.net, a, b, speed, (k) => peak[k]!);
  // Assign stops to depots by drive time.
  const byDepot = new Map<number, { stop: BusStop; t: number }[]>();
  for (const st of stops) {
    let best: { depot: number; t: number } | null = null;
    for (const d of depots) {
      const legs = route(d.access!, { seg: st.seg, s: st.s });
      if (!legs) continue;
      const t = legs.reduce((sum, l) => sum + secs(l), 0);
      if (!best || t < best.t) best = { depot: d.id, t };
    }
    if (!best) continue;
    const list = byDepot.get(best.depot) ?? [];
    list.push({ stop: st, t: best.t });
    byDepot.set(best.depot, list);
  }
  const dwell = tram ? TRAM.dwell : TRANSIT.dwell;
  const lines: BusLine[] = [];
  for (const d of depots) {
    const list = byDepot.get(d.id);
    if (!list || list.length < 2) continue;
    // Nearest-neighbour tour (straight-line) from the depot.
    const left = list.map((x) => x.stop);
    const order: BusStop[] = [];
    let cur = { x: d.x, z: d.z };
    while (left.length) {
      let bi = 0;
      let bd = Infinity;
      left.forEach((st, i) => {
        const dd = Math.hypot(st.x - cur.x, st.z - cur.z);
        if (dd < bd - 1e-9) {
          bd = dd;
          bi = i;
        }
      });
      const next = left.splice(bi, 1)[0]!;
      order.push(next);
      cur = next;
    }
    const points = [d.access!, ...order.map((st) => ({ seg: st.seg, s: st.s })), d.access!];
    const legs: Leg[] = [];
    const stopTime: number[] = [];
    let t = 0;
    let okLine = true;
    for (let i = 0; i + 1 < points.length; i++) {
      const part = route(points[i]!, points[i + 1]!);
      if (!part) {
        okLine = false;
        break;
      }
      for (const l of part) {
        legs.push(l);
        t += secs(l);
      }
      if (i < order.length) {
        stopTime.push(t);
        t += dwell;
      }
    }
    if (!okLine || t <= 0) continue;
    const def = civicDef(d);
    const fleet = tram ? def.tram!.trams : civicBuses(d);
    const funded = Math.max(1, Math.round(fleet * Math.min(1.25, sim.fundingEff('transit'))));
    const buses = tram ? Math.max(1, Math.min(funded, Math.floor(t / TRAM.minHeadway))) : funded;
    const seats = tram ? def.tram!.capacity : def.transit!.capacity;
    lines.push({
      mode,
      shuttle: false,
      depot: d.id,
      stops: order.map((st) => st.id),
      stopPos: order.map((st) => ({ x: st.x, z: st.z })),
      legs,
      stopTime,
      loopTime: t,
      buses,
      headway: t / buses,
      capacityPerHour: (buses * seats * 3600) / t,
    });
  }
  return lines;
}

/**
 * Train lines (M20): the stations on each connected stretch of track run one line, shuttling from
 * the station at one end to the far end and back, calling at the others in order along the way.
 */
export function trainLines(sim: Sim): BusLine[] {
  const s = sim.state;
  const rg = sim.railGraph();
  const stations = [...s.civics.values()]
    .filter((c) => civicDef(c).rail && c.access && civicOnline(c) && s.net.segments.has(c.access.seg))
    .sort((a, b) => a.id - b.id);
  if (stations.length < 2) return [];
  const groups = new Map<number, typeof stations>();
  for (const st of stations) {
    const comp = rg.componentOfNode(sim.net.segment(st.access!.seg).a);
    const list = groups.get(comp) ?? [];
    list.push(st);
    groups.set(comp, list);
  }
  const speed = (id: number) => (ROAD_TYPES[sim.net.segment(id).type].speed / 3.6) * RAIL.speedShare;
  const route = (a: { seg: number; s: number }, b: { seg: number; s: number }) =>
    routeBetween(rg, sim.net, a, b, speed);
  const seconds = (legs: Leg[]) =>
    legs.reduce((t, l) => t + Math.abs(l.s1 - l.s0) / Math.max(0.1, speed(l.seg)), 0);
  const out: BusLine[] = [];
  for (const group of [...groups.values()].sort((a, b) => a[0]!.id - b[0]!.id)) {
    if (group.length < 2) continue;
    // One end: the station farthest from the first; then every station in order of time from it.
    const from = (x: (typeof group)[number]) =>
      new Map(
        group.map((y) => {
          const r = x === y ? [] : route(x.access!, y.access!);
          return [y.id, r ? seconds(r) : Infinity] as const;
        }),
      );
    const t0 = from(group[0]!);
    const end = group.reduce((a, b) => (t0.get(b.id)! > t0.get(a.id)! ? b : a));
    const tEnd = from(end);
    const order = group
      .filter((x) => Number.isFinite(tEnd.get(x.id)!))
      .sort((a, b) => tEnd.get(a.id)! - tEnd.get(b.id)!);
    if (order.length < 2) continue;
    const legs: Leg[] = [];
    const stopTime: number[] = [0];
    let t = RAIL.dwell;
    for (let i = 0; i + 1 < order.length; i++) {
      const part = route(order[i]!.access!, order[i + 1]!.access!);
      if (!part) break;
      legs.push(...part);
      t += seconds(part);
      stopTime.push(t);
      t += RAIL.dwell;
    }
    if (stopTime.length < order.length) continue;
    const trains = Math.max(
      1,
      Math.round(
        order.reduce((n, x) => n + civicDef(x).rail!.trains, 0) * Math.min(1.25, sim.fundingEff('transit')),
      ),
    );
    const loopTime = 2 * t;
    const seats = civicDef(order[0]!).rail!.capacity;
    out.push({
      mode: 'train',
      shuttle: true,
      depot: order[0]!.id,
      stops: order.map((x) => x.id),
      stopPos: order.map((x) => ({ x: x.x, z: x.z })),
      legs,
      stopTime,
      loopTime,
      buses: trains,
      headway: loopTime / trains,
      capacityPerHour: (trains * seats * 3600) / loopTime,
    });
  }
  return out;
}

/** Stops within walking distance of each graph node: line index, stop index and walking seconds. */
export function stopsNearNodes(
  sim: Sim,
  lines: BusLine[],
): Map<number, { line: number; stop: number; walk: number }[]> {
  const g = sim.graph();
  const out = new Map<number, { line: number; stop: number; walk: number }[]>();
  lines.forEach((line, li) => {
    // People walk further to a train or a tram (M20).
    const reach =
      TRANSIT.walkRadius *
      (line.mode === 'train' ? RAIL.walkFactor : line.mode === 'tram' ? TRAM.walkFactor : 1);
    line.stopPos.forEach((st, si) => {
      for (let n = 0; n < g.size; n++) {
        const node = sim.state.net.nodes.get(g.ids[n]!)!;
        const d = Math.hypot(node.x - st.x, node.z - st.z);
        if (d > reach) continue;
        const list = out.get(n) ?? [];
        list.push({ line: li, stop: si, walk: (d * 1.3) / TRANSIT.walkSpeed });
        out.set(n, list);
      }
    });
  });
  return out;
}

/** Door-to-door seconds by bus between two nodes, or Infinity. */
export function busTime(
  lines: BusLine[],
  near: Map<number, { line: number; stop: number; walk: number }[]>,
  from: number,
  to: number,
): { t: number; line: number } {
  const a = near.get(from);
  const b = near.get(to);
  let best = { t: Infinity, line: -1 };
  if (!a || !b) return best;
  for (const x of a) {
    for (const y of b) {
      if (x.line !== y.line || x.stop === y.stop) continue;
      const line = lines[x.line]!;
      const ride = line.shuttle
        ? Math.abs(line.stopTime[y.stop]! - line.stopTime[x.stop]!)
        : (line.stopTime[y.stop]! - line.stopTime[x.stop]! + line.loopTime) % line.loopTime;
      const comfort = line.mode === 'train' ? RAIL.trainBonus : line.mode === 'tram' ? TRAM.bonus : 0;
      const t = x.walk + line.headway / 2 + ride + y.walk - comfort;
      if (t < best.t) best = { t, line: x.line };
    }
  }
  return best;
}

/** Share of commuters who take the bus given both door-to-door times. */
export function busShare(carSeconds: number, busSeconds: number, load: number): number {
  if (!Number.isFinite(busSeconds)) return 0;
  const x = (carSeconds + TRANSIT.carPenalty - busSeconds) / TRANSIT.shareScale;
  return (TRANSIT.maxShare * load) / (1 + Math.exp(-x));
}

/**
 * Bus and tram passes a day add a little traffic along each line (they run all day, not at the peak);
 * trains run on their own track.
 */
export function busTraffic(lines: BusLine[], add: (seg: number, pcu: number) => void): void {
  for (const line of lines) {
    if (line.mode === 'train') continue;
    const passes = (18 * 3600) / line.headway;
    const pcu = (passes * (line.mode === 'tram' ? TRAM.pcu : TRANSIT.busPcu) * (1 / 18)) / TRAFFIC.peakShare;
    const segs = new Set(line.legs.map((l) => l.seg));
    for (const seg of [...segs].sort((a, b) => a - b)) add(seg, pcu);
  }
}
