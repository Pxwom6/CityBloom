import { TRAFFIC, TRANSIT } from '../../data/balance';
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
  depot: number;
  /** Stop ids in the order the buses visit them. */
  stops: number[];
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

function snapToRoad(sim: Sim, x: number, z: number): { seg: number; s: number; x: number; z: number } | null {
  const hit = sim.net.nearestSegment({ x, z }, SNAP, (id) => ROAD_TYPES[sim.net.segment(id).type].access);
  return hit ? { seg: hit.seg, s: hit.s, x: hit.x, z: hit.z } : null;
}

export function placeStop(sim: Sim, x: number, z: number, dryRun: boolean): CommandResult {
  const s = sim.state;
  const at = snapToRoad(sim, x, z);
  if (!at) return fail('Bus stops go beside a road', { at: { x, z } });
  for (const st of s.transit.stops.values())
    if (Math.hypot(st.x - at.x, st.z - at.z) < 40) return fail('Too close to another stop', { at });
  if (TRANSIT.stopCost > s.treasury && !s.options.sandbox) return fail('Not enough money', { at });
  if (dryRun) return ok(TRANSIT.stopCost, { info: { x: at.x, z: at.z, seg: at.seg } });
  const stop: BusStop = { id: s.nextId++, x: at.x, z: at.z, seg: at.seg, s: at.s };
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

/** After the road network changes, stops follow their road or go if it's gone. */
export function relocateStops(sim: Sim): boolean {
  let changed = false;
  for (const st of [...sim.state.transit.stops.values()].sort((a, b) => a.id - b.id)) {
    if (sim.state.net.segments.has(st.seg)) {
      const p = sim.net.curve(st.seg).project({ x: st.x, z: st.z });
      if (p.d < 1) continue;
    }
    const at = snapToRoad(sim, st.x, st.z);
    if (!at) sim.state.transit.stops.delete(st.id);
    else Object.assign(st, at);
    changed = true;
  }
  return changed;
}

/** Seconds to drive a leg at rush-hour speeds. */
function legSeconds(sim: Sim, l: Leg, peak: Float64Array): number {
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
  return (Math.abs(l.s1 - l.s0) / Math.max(1e-6, len)) * free * ratio;
}

/**
 * Every depot's loop. Stops go to the depot that reaches them soonest; each loop visits its stops
 * nearest-first from the depot. A pure function of roads, depots, stops, funding and traffic.
 */
export function computeLines(sim: Sim): BusLine[] {
  const s = sim.state;
  const g = sim.graph();
  const peak = sim.peakCosts();
  const depots = [...s.civics.values()]
    .filter((c) => civicDef(c).transit && c.access && civicOnline(c))
    .sort((a, b) => a.id - b.id);
  if (!depots.length || s.transit.stops.size < 2) return [];
  const speed = (id: number) => (ROAD_TYPES[sim.net.segment(id).type].speed / 3.6) * 0.999;
  const route = (a: { seg: number; s: number }, b: { seg: number; s: number }) =>
    routeBetween(g, sim.net, a, b, speed, (k) => peak[k]!);
  // Assign stops to depots by drive time.
  const byDepot = new Map<number, { stop: BusStop; t: number }[]>();
  for (const st of [...s.transit.stops.values()].sort((a, b) => a.id - b.id)) {
    let best: { depot: number; t: number } | null = null;
    for (const d of depots) {
      const legs = route(d.access!, { seg: st.seg, s: st.s });
      if (!legs) continue;
      const t = legs.reduce((sum, l) => sum + legSeconds(sim, l, peak), 0);
      if (!best || t < best.t) best = { depot: d.id, t };
    }
    if (!best) continue;
    const list = byDepot.get(best.depot) ?? [];
    list.push({ stop: st, t: best.t });
    byDepot.set(best.depot, list);
  }
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
        t += legSeconds(sim, l, peak);
      }
      if (i < order.length) {
        stopTime.push(t);
        t += TRANSIT.dwell;
      }
    }
    if (!okLine || t <= 0) continue;
    const def = civicDef(d).transit!;
    const buses = Math.max(1, Math.round(civicBuses(d) * Math.min(1.25, sim.fundingEff('transit'))));
    lines.push({
      depot: d.id,
      stops: order.map((st) => st.id),
      legs,
      stopTime,
      loopTime: t,
      buses,
      headway: t / buses,
      capacityPerHour: (buses * def.capacity * 3600) / t,
    });
  }
  return lines;
}

/** Stops within walking distance of each graph node: line index, stop index and walking seconds. */
export function stopsNearNodes(
  sim: Sim,
  lines: BusLine[],
): Map<number, { line: number; stop: number; walk: number }[]> {
  const g = sim.graph();
  const out = new Map<number, { line: number; stop: number; walk: number }[]>();
  const stops = sim.state.transit.stops;
  lines.forEach((line, li) => {
    line.stops.forEach((id, si) => {
      const st = stops.get(id)!;
      for (let n = 0; n < g.size; n++) {
        const node = sim.state.net.nodes.get(g.ids[n]!)!;
        const d = Math.hypot(node.x - st.x, node.z - st.z);
        if (d > TRANSIT.walkRadius) continue;
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
      const ride = (line.stopTime[y.stop]! - line.stopTime[x.stop]! + line.loopTime) % line.loopTime;
      const t = x.walk + line.headway / 2 + ride + y.walk;
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

/** Bus passes a day add a little traffic along each line (buses run all day, not at the peak). */
export function busTraffic(lines: BusLine[], add: (seg: number, pcu: number) => void): void {
  for (const line of lines) {
    const passes = (18 * 3600) / line.headway;
    const pcu = (passes * TRANSIT.busPcu * (1 / 18)) / TRAFFIC.peakShare;
    const segs = new Set(line.legs.map((l) => l.seg));
    for (const seg of [...segs].sort((a, b) => a - b)) add(seg, pcu);
  }
}
