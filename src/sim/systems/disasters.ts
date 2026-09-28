import { WEATHER } from '../../data/climate';
import { chronicleEvent } from './chronicle';
import { DISASTERS } from '../../data/balance';
import { ROAD_TYPES } from '../../data/roads';
import { GRID_CELL, GRID_RES, MAP_SIZE } from '../../data/world';
import type { CommandResult } from '../commands';
import type { Sim } from '../sim';
import { TICKS_PER_HOUR } from '../time';
import { BState, type Building } from '../world/buildings';
import { civicDef, civicRect, type Civic } from '../world/civic';
import { book } from './economy';
import { dispatch, ignite, toRubble, type Incident } from './incidents';
import { SERVICES } from '../../data/civic';

export type DisasterKind = 'earthquake' | 'tornado' | 'flood' | 'meteor';
export const DISASTER_KINDS: readonly DisasterKind[] = ['earthquake', 'tornado', 'flood', 'meteor'];

/** An active disaster (saved). Positions are pure functions of these fields and the tick. */
export interface Disaster {
  id: number;
  kind: DisasterKind;
  /** Epicentre (earthquake), start of the path (tornado), source (flood), impact point (meteor). */
  x: number;
  z: number;
  /** First tick of the event (a meteor lands `fallTicks` later) and the tick it's over. */
  start: number;
  end: number;
  /** Magnitude (earthquake), half-width (tornado), peak water level (flood), crater radius (meteor). */
  size: number;
  /** Tornado heading (radians). */
  heading: number;
  /** Wobble phase for the tornado path. */
  seed: number;
  /** Earthquake or meteor effects applied. */
  struck: boolean;
  /** Damage report. */
  destroyed: number;
  damaged: number;
  roads: number;
  casualties: number;
}

/** A meteor's scorched crater (drawn until it fades). */
export interface Crater {
  x: number;
  z: number;
  r: number;
  tick: number;
}

export interface DisasterOptions {
  size?: number;
  heading?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where a tornado is at `tick`: a straight track with a lazy sideways wobble. */
export function tornadoAt(d: Disaster, tick: number): { x: number; z: number } {
  const t = clamp(tick - d.start, 0, d.end - d.start);
  const along = DISASTERS.tornado.speed * t;
  const side = 45 * Math.sin(t * 0.06 + d.seed) + 20 * Math.sin(t * 0.17 + d.seed * 2.3);
  const cx = Math.cos(d.heading);
  const cz = Math.sin(d.heading);
  return { x: d.x + cx * along - cz * side, z: d.z + cz * along + cx * side };
}

/** Flood water level (terrain height, m) at `tick`: rises, holds, then falls away. */
export function floodLevel(d: Disaster, tick: number): number {
  const f = DISASTERS.flood;
  const t = tick - d.start;
  if (t < 0 || tick > d.end) return 0;
  let k: number;
  if (t < f.riseTicks) k = t / f.riseTicks;
  else if (t < f.riseTicks + f.holdTicks) k = 1;
  else k = 1 - (t - f.riseTicks - f.holdTicks) / f.fallTicks;
  // Ease so the water creeps up and drains smoothly.
  k = clamp(k, 0, 1);
  return d.size * (k * k * (3 - 2 * k));
}

/** Meteor impact tick. */
export function impactTick(d: Disaster): number {
  return d.start + DISASTERS.meteor.fallTicks;
}

function earthquakeRadius(m: number): number {
  const e = DISASTERS.earthquake;
  return e.radiusBase + e.radiusPerMagnitude * (m - 5);
}

/** How far a disaster's damage can reach from (x, z), for UI previews. */
export function disasterReach(kind: DisasterKind, size: number): number {
  if (kind === 'earthquake') return earthquakeRadius(size);
  if (kind === 'flood') return DISASTERS.flood.radius;
  if (kind === 'meteor') return size * DISASTERS.meteor.fireReach;
  return size;
}

function waterDistanceAt(sim: Sim, x: number, z: number): number {
  const i = clamp(Math.floor(x / GRID_CELL), 0, GRID_RES - 1);
  const j = clamp(Math.floor(z / GRID_CELL), 0, GRID_RES - 1);
  return sim.waterDist()[j * GRID_RES + i]!;
}

/** Peak flood level near a source: well above most of the low shoreline land around it. */
function floodPeak(sim: Sim, x: number, z: number): number {
  const wd = sim.waterDist();
  const hs: number[] = [];
  const r = 260;
  for (let j = Math.floor((z - r) / GRID_CELL); j <= Math.floor((z + r) / GRID_CELL); j++)
    for (let i = Math.floor((x - r) / GRID_CELL); i <= Math.floor((x + r) / GRID_CELL); i++) {
      if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) continue;
      const d = wd[j * GRID_RES + i]!;
      if (d <= 0 || d > 150) continue;
      const h = sim.terrain.heightAt((i + 0.5) * GRID_CELL, (j + 0.5) * GRID_CELL);
      if (h > 0) hs.push(h);
    }
  if (!hs.length) return DISASTERS.flood.height[0];
  hs.sort((a, b) => a - b);
  const p = hs[Math.floor(0.45 * (hs.length - 1))]!;
  return clamp(p + DISASTERS.flood.aboveShore, DISASTERS.flood.height[0], DISASTERS.flood.height[1]);
}

/** Population-weighted centre of the city (or the map centre if empty). */
function cityCentre(sim: Sim): { x: number; z: number } {
  let x = 0;
  let z = 0;
  let w = 0;
  for (const b of sim.state.buildings.values()) {
    if (b.state !== BState.Active) continue;
    const k = Math.max(1, b.pop);
    x += b.x * k;
    z += b.z * k;
    w += k;
  }
  return w ? { x: x / w, z: z / w } : { x: MAP_SIZE / 2, z: MAP_SIZE / 2 };
}

/** Start a disaster (from the disasters menu, a cheat or at random). */
export function startDisaster(
  sim: Sim,
  kind: DisasterKind,
  at: { x: number; z: number },
  opts: DisasterOptions = {},
  dryRun = false,
): CommandResult {
  const s = sim.state;
  if (!DISASTER_KINDS.includes(kind)) return { ok: false, reason: 'Unknown disaster' };
  if (at.x < 0 || at.z < 0 || at.x > MAP_SIZE || at.z > MAP_SIZE)
    return { ok: false, reason: 'Outside city limits', at };
  if (s.disasters.length >= DISASTERS.maxActive)
    return { ok: false, reason: 'Enough is going wrong already. Wait for it to pass.', at };
  if (kind === 'flood' && waterDistanceAt(sim, at.x, at.z) > DISASTERS.flood.maxWaterDistance)
    return { ok: false, reason: 'Floods need a river, lake or coast nearby', at };
  if (dryRun) return { ok: true, cost: 0 };
  const rng = sim.rng.disasters;
  const between = (r: [number, number]) => r[0] + rng.next() * (r[1] - r[0]);
  const start = s.tick + 1;
  const d: Disaster = {
    id: s.nextId++,
    kind,
    x: at.x,
    z: at.z,
    start,
    end: start,
    size: 0,
    heading: 0,
    seed: rng.next() * Math.PI * 2,
    struck: false,
    destroyed: 0,
    damaged: 0,
    roads: 0,
    casualties: 0,
  };
  if (kind === 'earthquake') {
    // Most quakes are moderate; the big ones are rare.
    const [lo, hi] = DISASTERS.earthquake.magnitude;
    d.size = opts.size ?? lo + (hi - lo) * rng.next() ** 2;
    d.end = start + DISASTERS.earthquake.shakeTicks;
  } else if (kind === 'tornado') {
    d.size = opts.size ?? between(DISASTERS.tornado.halfWidth);
    const c = cityCentre(sim);
    const toward =
      Math.hypot(c.x - at.x, c.z - at.z) > 60 ? Math.atan2(c.z - at.z, c.x - at.x) : rng.next() * 6.28;
    d.heading = opts.heading ?? toward + (rng.next() - 0.5) * 0.8;
    d.end = start + Math.round(between(DISASTERS.tornado.ticks));
  } else if (kind === 'flood') {
    d.size = opts.size ?? floodPeak(sim, at.x, at.z);
    const f = DISASTERS.flood;
    d.end = start + f.riseTicks + f.holdTicks + f.fallTicks;
  } else {
    d.size = opts.size ?? between(DISASTERS.meteor.radius);
    d.end = impactTick(d) + 60;
  }
  s.disasters.push(d);
  sim.disastersChanged();
  sim.events.push({ kind: 'disaster', id: d.id });
  chronicleEvent(sim, 'disaster', d.kind);
  return { ok: true, cost: 0, created: [d.id] };
}

/** Collapse a building: rubble, and an ambulance call if people were inside. */
function collapse(sim: Sim, b: Building, d: Disaster): void {
  if (b.state === BState.Rubble) return;
  const occupied = b.pop > 0 && b.state === BState.Active;
  toRubble(sim, b, 'collapsed');
  d.destroyed++;
  if (!occupied) return;
  d.casualties++;
  const s = sim.state;
  const inc: Incident = {
    id: s.nextId++,
    kind: 'emergency',
    building: b.id,
    deadline: s.tick + SERVICES.emergencyWindow,
    responder: 0,
  };
  s.incidents.set(inc.id, inc);
  const v = dispatch(sim, 'health', 'ambulance', b.id, inc.id);
  if (v) inc.responder = v.id;
}

function damageRoad(sim: Sim, seg: number, hours: number, d: Disaster): void {
  const s = sim.state;
  if (!s.net.segments.has(seg) || seg === s.highway.segment) return;
  const had = s.roadDamage.get(seg) ?? 0;
  if (!had) d.roads++;
  s.roadDamage.set(seg, Math.max(had, Math.round(hours)));
  if (!had) sim.roadsBlockedChanged();
}

function damageCivic(sim: Sim, c: Civic, hours: number, d: Disaster): void {
  const was = c.damage;
  c.damage = Math.max(c.damage, Math.round(hours));
  if (!was) {
    d.damaged++;
    sim.civicStatusChanged(c.id);
    sim.events.push({ kind: 'civicDamaged', id: c.id });
  }
}

function segmentsNear(sim: Sim, x: number, z: number, r: number): { seg: number; d: number }[] {
  const out: { seg: number; d: number }[] = [];
  for (const id of sim.net.segHash.queryPoint(x, z, r)) {
    const p = sim.net.curve(id).project({ x, z });
    if (p.d <= r) out.push({ seg: id, d: p.d });
  }
  return out.sort((a, b) => a.seg - b.seg);
}

function buildingsNear(sim: Sim, x: number, z: number, r: number): Building[] {
  return [...sim.bldHash.queryPoint(x, z, r)]
    .sort((a, b) => a - b)
    .map((id) => sim.state.buildings.get(id)!)
    .filter((b) => b && Math.hypot(b.x - x, b.z - z) <= r);
}

function civicsNear(sim: Sim, x: number, z: number, r: number): Civic[] {
  return [...sim.civHash.queryPoint(x, z, r)]
    .sort((a, b) => a - b)
    .map((id) => sim.state.civics.get(id)!)
    .filter((c) => {
      if (!c) return false;
      const rect = civicRect(c);
      return Math.hypot(c.x - x, c.z - z) <= r + Math.min(rect.hw, rect.hd);
    });
}

function clearTrees(sim: Sim, x: number, z: number, r: number): void {
  const s = sim.state;
  for (let j = Math.floor((z - r) / GRID_CELL); j <= Math.floor((z + r) / GRID_CELL); j++)
    for (let i = Math.floor((x - r) / GRID_CELL); i <= Math.floor((x + r) / GRID_CELL); i++) {
      if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) continue;
      if (Math.hypot((i + 0.5) * GRID_CELL - x, (j + 0.5) * GRID_CELL - z) > r) continue;
      const idx = j * GRID_RES + i;
      if (!s.trees[idx]) continue;
      s.trees[idx] = 0;
      sim.markTreesDirty(idx);
    }
}

function earthquake(sim: Sim, d: Disaster): void {
  const e = DISASTERS.earthquake;
  const R = earthquakeRadius(d.size);
  const strength = clamp((d.size - 4.5) / 2.5, 0, 1.3);
  const rng = sim.rng.disasters;
  const intensity = (dist: number) => Math.pow(clamp(1 - dist / R, 0, 1), 1.3) * strength;
  for (const b of buildingsNear(sim, d.x, d.z, R)) {
    if (b.state === BState.Rubble) continue;
    const I = intensity(Math.hypot(b.x - d.x, b.z - d.z));
    const tall = b.density === 2 ? 1.2 : 1;
    const weak = b.state === BState.Abandoned || b.state === BState.Construction ? 1.5 : 1;
    if (rng.chance(clamp(e.collapse * I * I * tall * weak, 0, 0.95))) collapse(sim, b, d);
    else if (rng.chance(e.fire * I)) {
      ignite(sim, b);
      d.damaged++;
    }
  }
  for (const { seg, d: dist } of segmentsNear(sim, d.x, d.z, R * e.roadReach)) {
    const I = intensity(dist);
    if (rng.chance(e.roadChance * I))
      damageRoad(sim, seg, DISASTERS.roadRepairHours + DISASTERS.roadRepairPerIntensity * I, d);
  }
  for (const c of civicsNear(sim, d.x, d.z, R)) {
    const I = intensity(Math.hypot(c.x - d.x, c.z - d.z));
    if (rng.chance(e.civicChance * I))
      damageCivic(sim, c, DISASTERS.civicRepairHours + DISASTERS.civicRepairPerIntensity * I, d);
  }
}

function tornadoTick(sim: Sim, d: Disaster): void {
  const t = DISASTERS.tornado;
  const p = tornadoAt(d, sim.state.tick);
  const rng = sim.rng.disasters;
  const w = d.size;
  for (const b of buildingsNear(sim, p.x, p.z, w)) {
    if (b.state === BState.Rubble) continue;
    const core = Math.hypot(b.x - p.x, b.z - p.z) < w * 0.6;
    if (rng.chance(core ? t.destroyCore : t.destroyEdge)) collapse(sim, b, d);
  }
  for (const c of civicsNear(sim, p.x, p.z, w)) if (!c.damage) damageCivic(sim, c, t.civicHours, d);
  for (const { seg } of segmentsNear(sim, p.x, p.z, w * 0.5))
    if (!sim.state.roadDamage.has(seg) && rng.chance(0.3)) damageRoad(sim, seg, t.roadHours, d);
  clearTrees(sim, p.x, p.z, w);
}

function meteorImpact(sim: Sim, d: Disaster): void {
  const m = DISASTERS.meteor;
  const r = d.size;
  const rng = sim.rng.disasters;
  for (const b of buildingsNear(sim, d.x, d.z, r * m.fireReach)) {
    if (b.state === BState.Rubble) continue;
    const dist = Math.hypot(b.x - d.x, b.z - d.z);
    if (dist <= r) collapse(sim, b, d);
    else if (rng.chance(0.55 * (1 - dist / (r * m.fireReach)))) {
      ignite(sim, b);
      d.damaged++;
    }
  }
  for (const c of civicsNear(sim, d.x, d.z, r * m.fireReach)) {
    const rect = civicRect(c);
    const dist = Math.hypot(c.x - d.x, c.z - d.z);
    if (dist <= r + Math.min(rect.hw, rect.hd) * 0.5) {
      // A direct hit flattens it: the player has to build it again.
      d.destroyed++;
      sim.events.push({ kind: 'civicDestroyed', id: c.id, info: { def: c.def, x: c.x, z: c.z } });
      sim.removeCivic(c.id);
    } else damageCivic(sim, c, m.civicHours, d);
  }
  for (const { seg } of segmentsNear(sim, d.x, d.z, r)) damageRoad(sim, seg, m.roadHours, d);
  clearTrees(sim, d.x, d.z, r * 1.6);
  sim.state.craters.push({ x: d.x, z: d.z, r, tick: sim.state.tick });
  sim.disastersChanged();
}

/** Segments under flood water right now (any stretch of the road below the level). */
export function floodedSegments(sim: Sim): Set<number> {
  const out = new Set<number>();
  for (const d of sim.state.disasters) {
    if (d.kind !== 'flood') continue;
    const level = floodLevel(d, Math.floor(sim.state.tick / TICKS_PER_HOUR) * TICKS_PER_HOUR);
    if (level <= 0) continue;
    const R = DISASTERS.flood.radius;
    for (const { seg } of segmentsNear(sim, d.x, d.z, R)) {
      // Impassable if any stretch of it dips under the water.
      const c = sim.net.curve(seg);
      for (let k = 0; k <= 6; k++) {
        const at = (c.length * k) / 6;
        const p = c.pointAt(at);
        if (Math.hypot(p.x - d.x, p.z - d.z) > R) continue;
        if (sim.roadHeightAt(seg, at, p.x, p.z) < level) {
          out.add(seg);
          break;
        }
      }
    }
  }
  return out;
}

/** Is a point under any flood right now? */
function underFlood(sim: Sim, x: number, z: number, levels: { d: Disaster; level: number }[]): boolean {
  for (const { d, level } of levels) {
    if (Math.hypot(x - d.x, z - d.z) > DISASTERS.flood.radius) continue;
    if (sim.terrain.heightAt(x, z) < level) return true;
  }
  return false;
}

/** Hourly: who is under water, and how long they've been there. */
function floodHour(sim: Sim): void {
  const s = sim.state;
  const f = DISASTERS.flood;
  const levels = s.disasters
    .filter((d) => d.kind === 'flood')
    .map((d) => ({ d, level: floodLevel(d, s.tick) }))
    .filter((x) => x.level > 0);
  const rng = sim.rng.disasters;
  for (const b of [...s.buildings.values()].sort((a, c) => a.id - c.id)) {
    const wet = levels.length > 0 && b.state !== BState.Rubble && underFlood(sim, b.x, b.z, levels);
    if (wet) {
      const src = levels.find((l) => Math.hypot(b.x - l.d.x, b.z - l.d.z) <= f.radius)!.d;
      if (!b.flooded) {
        src.damaged++;
        sim.markBuildingDirty(b.id);
      }
      b.flooded++;
      if (b.flooded > f.graceHours && rng.chance(b.density === 0 ? f.destroyLow : f.destroyOther))
        collapse(sim, b, src);
    } else if (b.flooded) {
      b.flooded = 0;
      sim.markBuildingDirty(b.id);
    }
  }
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    const wet = levels.length > 0 && underFlood(sim, c.x, c.z, levels);
    if (wet !== c.flooded) {
      c.flooded = wet;
      sim.civicStatusChanged(c.id);
      if (wet) {
        const src = levels.find((l) => Math.hypot(c.x - l.d.x, c.z - l.d.z) <= f.radius);
        if (src) src.d.damaged++;
      }
    }
  }
  sim.floodChanged();
}

/** Every tick: advance active disasters; strike, sweep and finish them. */
export function disastersTick(sim: Sim): void {
  const s = sim.state;
  if (!s.disasters.length) return;
  for (const d of [...s.disasters]) {
    if (d.kind === 'earthquake' && !d.struck && s.tick >= d.start) {
      d.struck = true;
      earthquake(sim, d);
    } else if (d.kind === 'meteor' && !d.struck && s.tick >= impactTick(d)) {
      d.struck = true;
      meteorImpact(sim, d);
    } else if (d.kind === 'tornado' && s.tick >= d.start && s.tick <= d.end) tornadoTick(sim, d);
    if (s.tick >= d.end) {
      s.disasters = s.disasters.filter((x) => x !== d);
      sim.disastersChanged();
      sim.events.push({
        kind: 'disasterOver',
        id: d.id,
        info: {
          kind: d.kind,
          destroyed: d.destroyed,
          damaged: d.damaged,
          roads: d.roads,
          casualties: d.casualties,
          x: d.x,
          z: d.z,
        },
      });
      if (d.kind === 'flood') floodHour(sim);
    }
  }
}

/** Hourly: floods, repairs, old craters, and now and then a random disaster. */
export function disastersHour(sim: Sim): void {
  const s = sim.state;
  if (s.disasters.some((d) => d.kind === 'flood') || hasWet(sim)) floodHour(sim);
  // Road crews and engineers fix what was broken; the city pays when each job is done.
  for (const [seg, h] of [...s.roadDamage].sort((a, b) => a[0] - b[0])) {
    if (h > 1) {
      s.roadDamage.set(seg, h - 1);
      continue;
    }
    s.roadDamage.delete(seg);
    const sd = s.net.segments.get(seg);
    if (sd) {
      const cost = ROAD_TYPES[sd.type].costPerMetre * sim.net.curve(seg).length * DISASTERS.roadRepairShare;
      book(sim, 'repairs', -cost);
      sim.events.push({ kind: 'roadRepaired', id: seg });
    }
    sim.roadsBlockedChanged();
  }
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    if (c.damage <= 0) continue;
    c.damage--;
    if (c.damage > 0) continue;
    book(sim, 'repairs', -civicDef(c).cost * DISASTERS.civicRepairShare);
    sim.civicStatusChanged(c.id);
    sim.events.push({ kind: 'civicRepaired', id: c.id });
  }
  const craters = s.craters.length;
  s.craters = s.craters.filter((c) => s.tick - c.tick < DISASTERS.meteor.scorchTicks);
  if (s.craters.length !== craters) sim.disastersChanged();
  randomDisaster(sim);
  riverFlood(sim);
}

/**
 * Heavy rain and melting snow raise the river (M22); well above its banks, homes by the water can
 * flood. Only with disasters on, and the weather's dice decide.
 */
function riverFlood(sim: Sim): void {
  const s = sim.state;
  const over = s.weather.river - WEATHER.floodRise;
  if (over <= 0 || !s.options.disasters || s.disasters.length) return;
  if (s.totals.population < DISASTERS.minPopulation) return;
  const rng = sim.rng.weather;
  if (!rng.chance(WEATHER.floodChance * over)) return;
  const near = [...s.buildings.values()]
    .filter(
      (b) =>
        b.state === BState.Active && waterDistanceAt(sim, b.x, b.z) < DISASTERS.flood.maxWaterDistance - 60,
    )
    .sort((a, b) => a.id - b.id);
  if (!near.length) return;
  const target = near[Math.floor(rng.next() * near.length)]!;
  startDisaster(sim, 'flood', { x: target.x, z: target.z });
}

function hasWet(sim: Sim): boolean {
  for (const b of sim.state.buildings.values()) if (b.flooded) return true;
  for (const c of sim.state.civics.values()) if (c.flooded) return true;
  return false;
}

/** Rarely, if disasters are on and the city is big enough, something happens by itself. */
function randomDisaster(sim: Sim): void {
  const s = sim.state;
  if (!s.options.disasters) return;
  if (s.totals.population < DISASTERS.minPopulation || s.disasters.length) return;
  const rng = sim.rng.disasters;
  if (!rng.chance(DISASTERS.hourlyChance)) return;
  const homes = [...s.buildings.values()]
    .filter((b) => b.state === BState.Active)
    .sort((a, b) => a.id - b.id);
  if (!homes.length) return;
  const near = homes.filter((b) => waterDistanceAt(sim, b.x, b.z) < DISASTERS.flood.maxWaterDistance - 60);
  const w = DISASTERS.weights;
  const kinds: [DisasterKind, number][] = [
    ['earthquake', w.earthquake],
    ['tornado', w.tornado],
    ['flood', near.length ? w.flood : 0],
    ['meteor', w.meteor],
  ];
  const total = kinds.reduce((a, k) => a + k[1], 0);
  let roll = rng.next() * total;
  let kind: DisasterKind = 'earthquake';
  for (const [k, v] of kinds) {
    if (roll < v) {
      kind = k;
      break;
    }
    roll -= v;
  }
  const target = (kind === 'flood' ? near : homes)[
    Math.floor(rng.next() * (kind === 'flood' ? near : homes).length)
  ]!;
  let at = { x: target.x, z: target.z };
  if (kind === 'tornado') {
    // Touch down outside town and head in.
    const a = rng.next() * Math.PI * 2;
    at = {
      x: clamp(target.x + Math.cos(a) * 450, 20, MAP_SIZE - 20),
      z: clamp(target.z + Math.sin(a) * 450, 20, MAP_SIZE - 20),
    };
  }
  startDisaster(sim, kind, at);
}
