import { snowFactor } from '../../data/climate';
import { ROAD_TYPES } from '../../data/roads';
import { VEHICLE_SPEED_SCALE } from '../../data/civic';
import type { Sim } from '../sim';
import { routeBetween, type Leg } from './graph';

export type VehicleKind = 'garbage' | 'fire' | 'police' | 'ambulance' | 'bus' | 'plough';

/** A dispatched service vehicle driving along road legs. DESIGN §3.7. */
export interface Vehicle {
  id: number;
  kind: VehicleKind;
  /** Civic building it belongs to. */
  home: number;
  /** Building (or incident) it is heading for. */
  target: number;
  legs: Leg[];
  leg: number;
  /** Metres driven along the current leg. */
  t: number;
  phase: 'out' | 'work' | 'back';
  load: number;
  /** Ticks left working on site. */
  wait: number;
  /** Incident this vehicle answers (0 if none). */
  ref: number;
  /** Tick it set out, and stops made on this trip so far (garbage rounds). */
  born: number;
  stops: number;
}

export function segSpeed(sim: Sim, segId: number): number {
  const seg = sim.state.net.segments.get(segId);
  if (!seg) return 10;
  return ((ROAD_TYPES[seg.type].speed / 3.6) * sim.congestionFactor(segId)) / snowFactor(seg.snow);
}

/**
 * Snow ploughs (M22) work at four times a service vehicle's pace and aren't slowed by the snow they
 * clear: a snowfall lasts hours of the compressed calendar, and at the usual pace a plough would
 * clear a street or two before it melted.
 */
const PLOUGH_PACE = 4;

function speedOf(sim: Sim, kind: VehicleKind, segId: number): number {
  if (kind !== 'plough') return segSpeed(sim, segId);
  return segSpeed(sim, segId) * snowFactor(sim.state.net.segments.get(segId)?.snow) * PLOUGH_PACE;
}

export function route(
  sim: Sim,
  from: { seg: number; s: number },
  to: { seg: number; s: number },
): Leg[] | null {
  const costs = sim.congestedCosts();
  return routeBetween(
    sim.graph(),
    sim.net,
    from,
    to,
    (id) => segSpeed(sim, id),
    (k) => costs[k]!,
  );
}

/** Total length of a route in metres. */
export function routeLength(legs: Leg[]): number {
  return legs.reduce((s, l) => s + Math.abs(l.s1 - l.s0), 0);
}

export interface VehicleHandlers {
  arrive(sim: Sim, v: Vehicle): void;
  workDone(sim: Sim, v: Vehicle): void;
  home(sim: Sim, v: Vehicle): void;
  /** Called as the vehicle reaches the end of each leg (snow ploughs clear the road behind them). */
  passed?(sim: Sim, v: Vehicle, seg: number): void;
}

const handlers = new Map<VehicleKind, VehicleHandlers>();
export function registerVehicleKind(kind: VehicleKind, h: VehicleHandlers): void {
  handlers.set(kind, h);
}

export function spawnVehicle(
  sim: Sim,
  kind: VehicleKind,
  home: number,
  target: number,
  legs: Leg[],
): Vehicle {
  const v: Vehicle = {
    id: sim.state.nextId++,
    kind,
    home,
    target,
    legs,
    leg: 0,
    t: 0,
    phase: 'out',
    load: 0,
    wait: 0,
    ref: 0,
    born: sim.state.tick,
    stops: 0,
  };
  sim.state.vehicles.set(v.id, v);
  const c = sim.state.civics.get(home);
  if (c) c.out++;
  sim.markVehiclesDirty();
  return v;
}

export function despawnVehicle(sim: Sim, v: Vehicle): void {
  sim.state.vehicles.delete(v.id);
  const c = sim.state.civics.get(v.home);
  if (c) c.out = Math.max(0, c.out - 1);
  sim.markVehiclesDirty();
}

/** Send a vehicle on from where it is to a new destination (phase 'out'); false if there's no route. */
export function driveOn(sim: Sim, v: Vehicle, target: number, to: { seg: number; s: number }): boolean {
  const at = currentPoint(sim, v);
  const legs = at ? route(sim, at, to) : null;
  if (!legs) return false;
  v.legs = legs;
  v.leg = 0;
  v.t = 0;
  v.phase = 'out';
  v.target = target;
  sim.markVehiclesDirty();
  return true;
}

/** Send a vehicle back to its home building from wherever it is. */
export function sendHome(sim: Sim, v: Vehicle): void {
  const home = sim.state.civics.get(v.home);
  const at = currentPoint(sim, v);
  const legs = home?.access && at ? route(sim, at, home.access) : null;
  if (!legs) {
    despawnVehicle(sim, v);
    return;
  }
  v.legs = legs;
  v.leg = 0;
  v.t = 0;
  v.phase = 'back';
  sim.markVehiclesDirty();
}

function currentPoint(sim: Sim, v: Vehicle): { seg: number; s: number } | null {
  const l = v.legs[Math.min(v.leg, v.legs.length - 1)];
  if (!l || !sim.state.net.segments.has(l.seg)) return null;
  const dir = l.s1 >= l.s0 ? 1 : -1;
  return { seg: l.seg, s: l.s0 + dir * Math.min(v.t, Math.abs(l.s1 - l.s0)) };
}

/** Move every vehicle one tick along its legs. */
export function stepVehicles(sim: Sim): void {
  for (const v of [...sim.state.vehicles.values()]) {
    if (v.phase === 'work') {
      if (--v.wait <= 0) handlers.get(v.kind)?.workDone(sim, v);
      continue;
    }
    // Roads can vanish under a vehicle (bulldozed): reroute or give up.
    if (v.legs.some((l) => !sim.state.net.segments.has(l.seg))) {
      if (v.phase === 'back') despawnVehicle(sim, v);
      else sendHome(sim, v);
      continue;
    }
    let budget = 0;
    while (v.leg < v.legs.length) {
      const l = v.legs[v.leg]!;
      if (budget === 0) budget = VEHICLE_SPEED_SCALE * speedOf(sim, v.kind, l.seg);
      const len = Math.abs(l.s1 - l.s0);
      const left = len - v.t;
      if (budget < left) {
        v.t += budget;
        budget = -1;
        break;
      }
      budget -= left;
      handlers.get(v.kind)?.passed?.(sim, v, l.seg);
      v.leg++;
      v.t = 0;
      if (budget <= 0) {
        budget = -1;
        break;
      }
    }
    if (v.leg >= v.legs.length) {
      v.leg = v.legs.length - 1;
      v.t = Math.abs(v.legs[v.leg]!.s1 - v.legs[v.leg]!.s0);
      const h = handlers.get(v.kind);
      if (v.phase === 'out') h?.arrive(sim, v);
      else h?.home(sim, v);
      sim.markVehiclesDirty();
    }
  }
}
