import { POLICY_EFFECTS } from '../../data/policies';
import { GARBAGE } from '../../data/civic';
import { ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import { civicDef, civicOnline, civicTrucks, type Civic, type CollectionDay } from '../world/civic';
import { accrue } from './economy';
import { attachmentOf } from './commute';
import { Dijkstra } from './graph';
import {
  registerVehicleKind,
  route,
  sendHome,
  spawnVehicle,
  despawnVehicle,
  driveOn,
  type Vehicle,
} from './vehicles';

const dijkstra = new Dijkstra();

/** Garbage made per hour by a building. */
export function garbageRate(sim: Sim, b: Building): number {
  if (b.state !== BState.Active || b.pop <= 0) return 0;
  const k = sim.policyAt('recycling', b.x, b.z) ? POLICY_EFFECTS.recycling : 1;
  return (k * (b.zone === ZONE_R ? b.pop * GARBAGE.perResident : b.pop * GARBAGE.perJob[b.zone]!)) / 24;
}

export function garbageHour(sim: Sim): void {
  for (const b of sim.state.buildings.values()) {
    const r = garbageRate(sim, b);
    if (!r) continue;
    const before = b.garbage;
    if (before >= GARBAGE.maxPile) continue;
    b.garbage = Math.min(GARBAGE.maxPile, Math.round((b.garbage + r) * 1000) / 1000);
    if (before < GARBAGE.visible !== b.garbage < GARBAGE.visible) sim.markBuildingDirty(b.id);
  }
}

/** Trucks a facility can run at current funding (its own plus any extra it bought). */
export function trucksFor(sim: Sim, c: Civic): number {
  if (!civicDef(c).garbage) return 0;
  return Math.max(0, Math.round(civicTrucks(c) * sim.fundingEff('garbage')));
}

const emptyDay = (): CollectionDay => ({ units: 0, rounds: 0, ticks: 0, stops: 0 });

/** Start a new day's collection figures (at midnight, with the processed-today counters). */
export function rollCollectionDay(c: Civic): void {
  if (!civicDef(c).garbage) return;
  c.collection = { today: emptyDay(), last: c.collection?.today ?? emptyDay() };
}

function full(c: Civic): boolean {
  const g = civicDef(c).garbage!;
  if (g.storage !== undefined) return c.stored >= g.storage;
  if (g.process !== undefined) return c.processedToday >= g.process;
  return false;
}

/** Hourly: each facility sends free trucks to the fullest reachable buildings. */
export function dispatchGarbage(sim: Sim): void {
  const s = sim.state;
  const g = sim.graph();
  const targeted = new Set<number>();
  for (const v of s.vehicles.values()) if (v.kind === 'garbage') targeted.add(v.target);
  const facilities = [...s.civics.values()]
    .filter((c) => civicDef(c).garbage && c.access && civicOnline(c))
    .sort((a, b) => a.id - b.id);
  // Buildings worth a trip, and where they join the roads (worked out once, not per facility).
  const dirty: { b: Building; node: number }[] = [];
  for (const b of s.buildings.values()) {
    if (b.garbage < GARBAGE.pickupMin) continue;
    const att = attachmentOf(sim, g, b);
    if (att) dirty.push({ b, node: att.node });
  }
  for (const c of facilities) {
    let free = trucksFor(sim, c) - c.out;
    if (free <= 0 || full(c)) continue;
    const seg = s.net.segments.get(c.access!.seg);
    if (!seg) continue;
    const node = g.index.get(c.access!.s < sim.net.curve(seg.id).length / 2 ? seg.a : seg.b);
    if (node === undefined) continue;
    const reach = new Map<number, number>();
    dijkstra.run(g, [{ node, cost: 0 }], GARBAGE.range * 4, (u, cost) => {
      reach.set(u, cost);
      return true;
    });
    const cands: { b: Building; cost: number }[] = [];
    for (const { b, node } of dirty) {
      if (targeted.has(b.id)) continue;
      const cost = reach.get(node);
      if (cost === undefined) continue;
      cands.push({ b, cost });
    }
    cands.sort((a, b) => b.b.garbage - a.b.garbage || a.cost - b.cost || a.b.id - b.b.id);
    for (const cand of cands) {
      if (free <= 0) break;
      if (targeted.has(cand.b.id)) continue;
      const acc = sim.buildingAccess(cand.b);
      if (!acc) continue;
      const legs = route(sim, c.access!, acc);
      if (!legs) continue;
      spawnVehicle(sim, 'garbage', c.id, cand.b.id, legs);
      targeted.add(cand.b.id);
      // Neighbours the truck will also serve aren't targeted separately this round.
      for (const id of sim.bldHash.queryPoint(cand.b.x, cand.b.z, GARBAGE.pickupRadius)) targeted.add(id);
      free--;
    }
  }
}

/**
 * A collection round: with room left in the truck, drive on to the nearest building nearby with
 * garbage that no other truck is heading for. One long drive from the landfill then serves many
 * stops instead of one (trucks had come back with a fifth of a load after hours on the road).
 */
function nextStop(sim: Sim, v: Vehicle): boolean {
  const s = sim.state;
  const home = s.civics.get(v.home);
  const here = s.buildings.get(v.target);
  if (!home || !here) return false;
  const cap = civicDef(home).garbage!.truckCapacity;
  if (v.load >= cap * GARBAGE.round.full || v.stops + 1 >= GARBAGE.round.stops) return false;
  const taken = new Set<number>();
  for (const o of s.vehicles.values()) if (o.kind === 'garbage' && o.id !== v.id) taken.add(o.target);
  const near = sim.bldHash
    .queryPoint(here.x, here.z, GARBAGE.round.radius)
    .map((id) => s.buildings.get(id)!)
    .filter((b) => b && b.garbage >= GARBAGE.pickupMin && !taken.has(b.id))
    .map((b) => ({ b, d: Math.hypot(b.x - here.x, b.z - here.z) }))
    .sort((a, b) => a.d - b.d || a.b.id - b.b.id);
  for (const { b } of near.slice(0, 4)) {
    const acc = sim.buildingAccess(b);
    if (acc && driveOn(sim, v, b.id, acc)) {
      v.stops++;
      return true;
    }
  }
  return false;
}

/** Is a building within reach of a garbage facility that still has room? (for maps and mood) */
export function garbageCovered(sim: Sim): Set<number> {
  const s = sim.state;
  const g = sim.graph();
  const covered = new Set<number>();
  for (const c of s.civics.values()) {
    if (!civicDef(c).garbage || !c.access || full(c) || !civicOnline(c)) continue;
    const seg = s.net.segments.get(c.access.seg);
    if (!seg) continue;
    const node = g.index.get(c.access.s < sim.net.curve(seg.id).length / 2 ? seg.a : seg.b);
    if (node === undefined) continue;
    const reach = new Set<number>();
    dijkstra.run(g, [{ node, cost: 0 }], GARBAGE.range * 4, (u) => {
      reach.add(u);
      return true;
    });
    for (const b of s.buildings.values()) {
      const att = attachmentOf(sim, g, b);
      if (att && reach.has(att.node)) covered.add(b.id);
    }
  }
  return covered;
}

registerVehicleKind('garbage', {
  arrive(sim, v) {
    const s = sim.state;
    const home = s.civics.get(v.home);
    const cap = home ? civicDef(home).garbage!.truckCapacity : 0;
    const target = s.buildings.get(v.target);
    const near = target ? sim.bldHash.queryPoint(target.x, target.z, GARBAGE.pickupRadius) : [];
    const list = near
      .map((id) => s.buildings.get(id)!)
      .filter((b) => b && b.garbage > 0)
      .sort((a, b) =>
        a.id === v.target ? -1 : b.id === v.target ? 1 : b.garbage - a.garbage || a.id - b.id,
      );
    for (const b of list) {
      const take = Math.min(b.garbage, cap - v.load);
      if (take <= 0) break;
      const before = b.garbage;
      b.garbage = Math.round((b.garbage - take) * 1000) / 1000;
      v.load = Math.round((v.load + take) * 1000) / 1000;
      if (before >= GARBAGE.visible && b.garbage < GARBAGE.visible) sim.markBuildingDirty(b.id);
    }
    v.phase = 'work';
    v.wait = 12;
  },
  workDone(sim, v) {
    if (!nextStop(sim, v)) sendHome(sim, v);
  },
  home(sim, v) {
    const c = sim.state.civics.get(v.home);
    if (c) {
      const g = civicDef(c).garbage!;
      c.collection ??= { today: emptyDay(), last: emptyDay() };
      const day = c.collection.today;
      day.units = Math.round((day.units + v.load) * 1000) / 1000;
      day.rounds++;
      day.ticks += sim.state.tick - v.born;
      day.stops += v.stops + 1;
      if (g.storage !== undefined) c.stored = Math.min(g.storage, c.stored + v.load);
      else {
        c.processedToday += v.load;
        if (g.revenuePerUnit) accrue(sim, 'trade', v.load * g.revenuePerUnit);
      }
    }
    despawnVehicle(sim, v);
  },
});
