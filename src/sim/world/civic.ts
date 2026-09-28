import { scenarioForbids } from '../systems/scenario';
import { placementPrice, projectBlocked, type ProjectBuild } from '../systems/projects';
import { MODULE } from '../../data/modules';
import { CIVIC, MOVE, SPECIALISATION, type CivicDef } from '../../data/civic';
import { GRADING, ROAD_RULES, ROAD_TYPES, isRail } from '../../data/roads';
import { MAP_SIZE, SHORE_HEIGHT, GRID_CELL, GRID_RES } from '../../data/world';
import { fail, ok, type CommandResult } from '../commands';
import { pointRectDistance, rectsOverlap, type ORect, type Vec2 } from '../geom';
import type { Sim } from '../sim';
import { clearTreesUnder, footprint as zonedFootprint } from './buildings';
import { sendHome } from '../systems/vehicles';
import { planPad, reshapeGround, type EarthPlan } from './earthworks';
import { RAIL } from '../../data/balance';

/** A player-placed civic building (utility, service, park, landmark). */
export interface Civic {
  id: number;
  def: string;
  x: number;
  z: number;
  y: number;
  /** Road tangent angle; the front faces the road (same convention as zoned buildings). */
  angle: number;
  side: 1 | -1;
  access: { seg: number; s: number } | null;
  /** Garbage stored (landfill) and processed today (recycling, incinerator). */
  stored: number;
  processedToday: number;
  /** Garbage processed during the previous day (drives incinerator power). */
  lastDay: number;
  /** Vehicles currently out. */
  out: number;
  cost: number;
  born: number;
  variant: number;
  /** Hours until disaster damage is repaired (offline until then), and under flood water now. */
  damage: number;
  flooded: boolean;
  /** Add-on modules installed (M10); a repeatable one appears once per copy. */
  modules: string[];
  /** Garbage facilities: what their trucks brought back today and the day before (playtest fixes). */
  collection?: { today: CollectionDay; last: CollectionDay };
  /** Big projects (M17): the construction in hand; absent once finished (and for everything else). */
  build?: ProjectBuild;
}

/** A day of garbage collection at one facility: units unloaded, rounds finished, their minutes and stops. */
export interface CollectionDay {
  units: number;
  rounds: number;
  ticks: number;
  stops: number;
}

/** Garbage trucks a facility has with its extra trucks (before funding). */
export function civicTrucks(c: Civic): number {
  return (civicDef(c).garbage?.trucks ?? 0) + c.modules.reduce((a, m) => a + (MODULE.get(m)?.trucks ?? 0), 0);
}

/** Vehicles, seats or beds, and buses a building has with its modules (before funding). */
export function civicVehicles(c: Civic): number {
  return (
    (civicDef(c).service?.vehicles ?? 0) + c.modules.reduce((a, m) => a + (MODULE.get(m)?.vehicles ?? 0), 0)
  );
}
export function civicCapacity(c: Civic): number {
  return (
    (civicDef(c).service?.capacity ?? 0) + c.modules.reduce((a, m) => a + (MODULE.get(m)?.capacity ?? 0), 0)
  );
}
export function civicBuses(c: Civic): number {
  return (civicDef(c).transit?.buses ?? 0) + c.modules.reduce((a, m) => a + (MODULE.get(m)?.buses ?? 0), 0);
}
/** Monthly upkeep at 100 % funding, modules included. */
export function civicUpkeep(c: Civic): number {
  // A project costs its stages while it's built, and upkeep only once it opens.
  if (c.build) return 0;
  return civicDef(c).upkeep + c.modules.reduce((a, m) => a + (MODULE.get(m)?.upkeep ?? 0), 0);
}

/** Add a module to a civic building. */
export function addModule(sim: Sim, civicId: number, moduleId: string, dryRun: boolean): CommandResult {
  const c = sim.state.civics.get(civicId);
  const m = MODULE.get(moduleId);
  if (!c || !m) return { ok: false, reason: 'Nothing to add that to' };
  if (!m.for.includes(c.def)) return { ok: false, reason: "That module doesn't fit this building" };
  const have = c.modules.filter((x) => x === m.id).length;
  if (have >= (m.max ?? 1)) return { ok: false, reason: m.max ? `Already has ${m.max}` : 'Already added' };
  if (!sim.isUnlocked(m.unlockPopulation))
    return { ok: false, reason: `Unlocks at ${m.unlockPopulation.toLocaleString('en-US')} residents` };
  if (!sim.state.options.sandbox && sim.state.treasury < m.cost)
    return { ok: false, reason: 'Not enough money' };
  if (dryRun) return { ok: true, cost: m.cost };
  sim.spend(m.cost, 'construction');
  c.modules = [...c.modules, m.id];
  c.cost += m.cost;
  sim.civicStatusChanged(c.id);
  return { ok: true, cost: m.cost };
}

/** Mean richness (0–1) of an ore or oil deposit under a footprint. */
export function resourceRichness(sim: Sim, kind: 'ore' | 'oil', r: ORect): number {
  const raster = kind === 'ore' ? sim.terrain.ore : sim.terrain.oil;
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  let sum = 0;
  let n = 0;
  for (let u = -1; u <= 1; u += 0.5)
    for (let v = -1; v <= 1; v += 0.5) {
      const x = r.x + u * r.hw * c - v * r.hd * s;
      const z = r.z + u * r.hw * s + v * r.hd * c;
      const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(x / GRID_CELL)));
      const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(z / GRID_CELL)));
      sum += raster[j * GRID_RES + i]! / 255;
      n++;
    }
  return sum / n;
}

/** A civic building works unless it's damaged or flooded. */
export function civicOnline(c: Civic): boolean {
  return c.damage <= 0 && !c.flooded && !c.build;
}

export function civicDef(c: Civic): CivicDef {
  return CIVIC.get(c.def)!;
}

export function civicRect(c: { x: number; z: number; angle: number; def: string }, shrink = 0): ORect {
  const d = CIVIC.get(c.def)!;
  return { x: c.x, z: c.z, hw: d.w / 2 - shrink, hd: d.d / 2 - shrink, angle: c.angle };
}

/** Unit vector from the road towards the back of the lot. */
export function awayDir(angle: number, side: 1 | -1): Vec2 {
  // Left normal of the tangent (cos a, sin a) is (sin a, −cos a); `side` picks the road side.
  return { x: Math.sin(angle) * side, z: -Math.cos(angle) * side };
}

/** Middle of the front edge (the side facing the road). */
export function frontPoint(c: { x: number; z: number; angle: number; side: 1 | -1; def: string }): Vec2 {
  const d = CIVIC.get(c.def)!;
  const a = awayDir(c.angle, c.side);
  return { x: c.x - a.x * (d.d / 2), z: c.z - a.z * (d.d / 2) };
}

/**
 * The railway along the back of a building (a rail freight terminal's siding, M20), if one runs
 * within RAIL.sidingReach of it.
 */
export function railSiding(
  sim: Sim,
  c: { x: number; z: number; angle: number; side: 1 | -1; def: string },
): { seg: number; s: number; x: number; z: number } | null {
  const d = CIVIC.get(c.def);
  if (!d) return null;
  const away = awayDir(c.angle, c.side);
  const back = { x: c.x + away.x * (d.d / 2), z: c.z + away.z * (d.d / 2) };
  const hit = sim.net.nearestSegment(back, RAIL.sidingReach + 12, (id) => isRail(sim.net.segment(id).type));
  if (!hit || hit.d > RAIL.sidingReach + sim.net.halfWidth(hit.seg)) return null;
  return { seg: hit.seg, s: hit.s, x: hit.x, z: hit.z };
}

/** Nearest road the front edge touches (within its corridor plus a few metres). */
export function findAccess(
  sim: Sim,
  c: { x: number; z: number; angle: number; side: 1 | -1; def: string },
): { seg: number; s: number } | null {
  const f = frontPoint(c);
  // Stations face their railway (M20); everything else faces a road.
  const rail = CIVIC.get(c.def)?.track === 'rail';
  const hit = sim.net.nearestSegment(f, 24, (id) =>
    rail ? isRail(sim.net.segment(id).type) : ROAD_TYPES[sim.net.segment(id).type].access,
  );
  if (!hit) return null;
  if (hit.d > sim.net.halfWidth(hit.seg) + 4) return null;
  return { seg: hit.seg, s: hit.s };
}

export interface PlacementCheck {
  ok: boolean;
  reason?: string;
  demolish: number[];
  access: { seg: number; s: number } | null;
  y: number;
  /** Earthworks for a level pad on uneven ground (M13), or null. */
  pad: EarthPlan | null;
}

export function checkPlacement(
  sim: Sim,
  defId: string,
  x: number,
  z: number,
  angle: number,
  side: 1 | -1,
  ignoreCivic = 0,
  /** What it costs here (a move's fee rather than the building's price). */
  price?: number,
): PlacementCheck {
  const def = CIVIC.get(defId);
  const res: PlacementCheck = { ok: false, demolish: [], access: null, y: 0, pad: null };
  if (!def) return { ...res, reason: 'Unknown building' };
  // A scenario's limits (M18) come first: no spot would do.
  const forbidden = ignoreCivic ? null : scenarioForbids(sim, { civic: def.id });
  if (forbidden) return { ...res, reason: forbidden };
  if (![x, z, angle].every(Number.isFinite)) return { ...res, reason: 'Invalid position' };
  const rect: ORect = { x, z, hw: def.w / 2, hd: def.d / 2, angle };
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pts: Vec2[] = [{ x, z }];
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const) {
    pts.push({ x: x + u * rect.hw * c - v * rect.hd * s, z: z + u * rect.hw * s + v * rect.hd * c });
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    if (p.x < 4 || p.z < 4 || p.x > MAP_SIZE - 4 || p.z > MAP_SIZE - 4)
      return { ...res, reason: 'Outside the city limits' };
    const h = sim.terrain.heightAt(p.x, p.z);
    if (h < SHORE_HEIGHT) return { ...res, reason: "Can't build on water" };
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  if (hi - lo > GRADING.padMax) return { ...res, reason: 'Ground is too steep' };
  res.y = hi;
  if (def.nearWater !== undefined) {
    const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(x / GRID_CELL)));
    const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(z / GRID_CELL)));
    const wd = sim.waterDist()[j * GRID_RES + i]!;
    if (wd > def.nearWater + Math.max(def.w, def.d) / 2)
      return { ...res, reason: 'Must be next to a river, lake or the sea' };
  }
  if (def.unique)
    for (const o of sim.state.civics.values())
      if (o.def === def.id && o.id !== ignoreCivic)
        return { ...res, reason: `The city already has a ${def.name.toLowerCase()}` };
  if (def.requires && ![...sim.state.civics.values()].some((o) => o.def === def.requires))
    return { ...res, reason: `Needs a ${CIVIC.get(def.requires)?.name.toLowerCase() ?? def.requires} first` };
  if (def.resource && resourceRichness(sim, def.resource.kind, rect) < SPECIALISATION.minRichness)
    return {
      ...res,
      reason: `Must stand on ${def.resource.kind === 'ore' ? 'an ore deposit' : 'an oil field'} (see the resources map)`,
    };
  // Roads crossing the footprint.
  const shrunk: ORect = { ...rect, hw: rect.hw - 0.5, hd: rect.hd - 0.5 };
  const rad = Math.hypot(rect.hw, rect.hd);
  for (const sid of sim.net.segHash.queryPoint(x, z, rad + 16)) {
    const curve = sim.net.curve(sid);
    const hw = sim.net.halfWidth(sid);
    for (let i = 0; i < curve.xs.length; i++) {
      if (pointRectDistance({ x: curve.xs[i]!, z: curve.zs[i]! }, shrunk) < hw)
        return { ...res, reason: 'Overlaps a road' };
    }
  }
  // Other civic buildings.
  for (const id of sim.civHash.queryPoint(x, z, rad + 80)) {
    if (id === ignoreCivic) continue;
    const other = sim.state.civics.get(id)!;
    if (rectsOverlap(shrunk, civicRect(other))) return { ...res, reason: 'Overlaps another building' };
  }
  res.access = findAccess(sim, { x, z, angle, side, def: defId });
  if (!res.access)
    return { ...res, reason: def.track === 'rail' ? 'Must face a railway' : 'Must face a road' };
  // A rail freight terminal needs its railway along the back (M20).
  if (def.railFreight && !railSiding(sim, { x, z, angle, side, def: defId }))
    return {
      ...res,
      reason: `Needs a railway along its back (within ${RAIL.sidingReach} m) to load trains`,
    };
  // Zoned buildings in the way are demolished.
  for (const id of sim.bldHash.queryPoint(x, z, rad + 40)) {
    const b = sim.state.buildings.get(id)!;
    if (rectsOverlap(shrunk, zonedFootprint(b, 0.5))) res.demolish.push(id);
  }
  if (!ignoreCivic && !sim.isUnlocked(def.unlockPopulation))
    return { ...res, reason: `Unlocks at ${def.unlockPopulation.toLocaleString('en-US')} residents` };
  if (def.project && !ignoreCivic) {
    const why = projectBlocked(sim, def);
    if (why) return { ...res, reason: why };
  }
  // Uneven ground: level a pad at the height where the building meets its road (M13).
  if (hi - lo > GRADING.padFrom) {
    const away = awayDir(angle, side);
    const front = sim.terrain.heightAt(x - away.x * rect.hd, z - away.z * rect.hd);
    res.y = Math.min(hi, Math.max(lo, front));
    const doomed = new Set(res.demolish);
    res.pad = planPad(sim.terrain, sim.net, rect, res.y, (px, pz) => {
      const p = { x: px, z: pz };
      for (const id of sim.bldHash.queryPoint(px, pz, 3))
        if (!doomed.has(id) && pointRectDistance(p, zonedFootprint(sim.state.buildings.get(id)!)) < 2)
          return true;
      for (const id of sim.civHash.queryPoint(px, pz, 3))
        if (id !== ignoreCivic && pointRectDistance(p, civicRect(sim.state.civics.get(id)!)) < 2) return true;
      return false;
    });
  }
  if (
    !sim.state.options.sandbox &&
    sim.state.treasury < (price ?? placementPrice(def)) + (res.pad?.cost ?? 0)
  )
    return { ...res, reason: 'Not enough money' };
  res.ok = true;
  return res;
}

export function placeCivic(
  sim: Sim,
  defId: string,
  x: number,
  z: number,
  angle: number,
  side: 1 | -1,
  dryRun: boolean,
): CommandResult {
  const chk = checkPlacement(sim, defId, x, z, angle, side);
  const def = CIVIC.get(defId);
  const earth = chk.pad ? { volume: chk.pad.volume, cost: chk.pad.cost } : null;
  const info = { demolish: chk.demolish.length, access: !!chk.access, earth };
  if (!chk.ok || !def) return fail(chk.reason ?? 'Invalid placement', { at: { x, z }, info });
  const price = placementPrice(def);
  const total = price + (earth?.cost ?? 0);
  if (dryRun) return ok(total, { info });
  const s = sim.state;
  const civ: Civic = {
    id: s.nextId++,
    def: defId,
    x,
    z,
    y: chk.y,
    angle,
    side,
    access: chk.access,
    stored: 0,
    processedToday: 0,
    lastDay: 0,
    out: 0,
    cost: price,
    born: s.tick,
    variant: sim.rng.world.int(1 << 16),
    damage: 0,
    flooded: false,
    modules: [],
  };
  // A big project starts on its first stage (M17).
  if (def.project) civ.build = { stage: 0, months: 0, waiting: false };
  for (const id of chk.demolish) sim.removeBuilding(id);
  sim.addCivic(civ);
  sim.spend(price, def.project ? 'projects' : 'construction');
  if (earth?.cost) sim.spend(earth.cost, 'construction');
  if (chk.pad?.idx.length) {
    reshapeGround(sim, chk.pad.idx, chk.pad.to);
    sim.net.revalidate(chk.pad.box!);
  }
  clearTreesUnder(sim, civicRect(civ, 0));
  return ok(total, { created: [civ.id], info });
}

/** What moving a civic building costs, before any earthworks for its new site (M14). */
export function moveFee(defId: string): number {
  const def = CIVIC.get(defId)!;
  return Math.max(MOVE.minFee, Math.round(def.cost * MOVE.share));
}

/**
 * Pick up a civic building and put it down elsewhere (M14): it keeps its add-ons, stock and
 * everything else, and faces its new road. The same placement rules apply as for a new one.
 */
export function moveCivic(
  sim: Sim,
  id: number,
  x: number,
  z: number,
  angle: number,
  side: 1 | -1,
  dryRun: boolean,
): CommandResult {
  const c = sim.state.civics.get(id);
  if (!c) return fail('Nothing to move');
  if (Math.hypot(x - c.x, z - c.z) < 1 && Math.abs(angle - c.angle) < 1e-3 && side === c.side)
    return fail('It is already here');
  const fee = moveFee(c.def);
  const chk = checkPlacement(sim, c.def, x, z, angle, side, id, fee);
  const earth = chk.pad ? { volume: chk.pad.volume, cost: chk.pad.cost } : null;
  const info = { demolish: chk.demolish.length, access: !!chk.access, earth, fee };
  if (!chk.ok) return fail(chk.reason ?? 'Invalid placement', { at: { x, z }, info });
  const total = fee + (earth?.cost ?? 0);
  if (dryRun) return ok(total, { info });
  for (const bid of chk.demolish) sim.removeBuilding(bid);
  sim.relocateCivic(c, { x, z, angle, side, y: chk.y, access: chk.access });
  // Vehicles on their way back head for the new site; those still out find it when they turn home.
  for (const v of [...sim.state.vehicles.values()]) if (v.home === id && v.phase === 'back') sendHome(sim, v);
  sim.spend(total, 'construction');
  if (chk.pad?.idx.length) {
    reshapeGround(sim, chk.pad.idx, chk.pad.to);
    sim.net.revalidate(chk.pad.box!);
  }
  clearTreesUnder(sim, civicRect(c, 0));
  return ok(total, { info });
}

export function bulldozeCivic(
  sim: Sim,
  id: number,
  dryRun: boolean,
  refundShare = ROAD_RULES.bulldozeRefund,
): CommandResult {
  const c = sim.state.civics.get(id);
  if (!c) return fail('Nothing to bulldoze');
  const refund = Math.round(c.cost * refundShare);
  if (dryRun) return ok(-refund, { info: { refund, buildings: [] } });
  sim.removeCivic(id);
  sim.earn(refund, 'refunds');
  return ok(-refund, { info: { refund, buildings: [] } });
}

/** Centre, angle and side for a civic building of depth `d` standing beside a segment at arc length s. */
export function roadsidePose(
  net: {
    curve(id: number): { pointAt(s: number): Vec2; tangentAt(s: number): Vec2; length: number };
    halfWidth(id: number): number;
  },
  segId: number,
  s: number,
  side: 1 | -1,
  d: number,
): { x: number; z: number; angle: number; side: 1 | -1 } {
  const curve = net.curve(segId);
  const p = curve.pointAt(s);
  const t = curve.tangentAt(s);
  const hw = net.halfWidth(segId);
  const away = { x: t.z * side, z: -t.x * side };
  const off = hw + d / 2 + 0.5;
  return { x: p.x + away.x * off, z: p.z + away.z * off, angle: Math.atan2(t.z, t.x), side };
}
