/**
 * Raids and battles at home (phase 5, M35), DESIGN.md §3.29. Computer neighbours decide now and
 * then to raid the city; a raid is announced (the radar's warning), arrives, and is fought here: the
 * battle (src/sim/battle) runs a step at a time inside this city's sim, and every event it gives
 * reaches the city through one handler, `applyWarDamage` (fires, rubble, city buildings closed or
 * wrecked, craters, units lost), the disasters' own machinery repairing it all afterwards. A report
 * is kept for the war room. Everything here exists only in a city with war on.
 */
import {
  RAIDS,
  RIVAL_MIX,
  RIVAL_TARGET,
  ROUTES,
  SKIRMISH,
  TRAVEL,
  WAR_DAMAGE,
  WARNING,
  type BattleRoute,
  type BattleTarget,
  type Stance,
} from '../../data/battle';
import { PERSONALITY, UNIT, type UnitKind } from '../../data/war';
import { Battle } from '../battle/battle';
import { battleLayout } from '../battle/layout';
import {
  BATTLE_VERSION,
  type BattleEvent,
  type BattleFrame,
  type BattleInput,
  type BattleUnitIn,
  type Outcome,
} from '../battle/types';
import { DMath } from '../dmath';
import { fail, ok, type CommandResult } from '../commands';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../time';
import { BState } from '../world/buildings';
import { civicOnline } from '../world/civic';
import { ZONE_I, ZONE_R } from '../../data/zones';
import { CIVIC } from '../../data/civic';
import { ignite, toRubble } from './incidents';
import { militaryCivics, militaryOf } from './war';
import type { Neighbour, RivalNeighbour } from './region';

/** A force on its way to the city. */
export interface Raid {
  id: number;
  /** The neighbour it comes from (id) and its name. */
  from: number;
  name: string;
  units: { kind: UnitKind; hp: number }[];
  target: BattleTarget;
  route: BattleRoute;
  stance: Stance;
  readiness: number;
  /** Ticks: when the city hears of it, and when it arrives. */
  warn: number;
  arrive: number;
  warned?: true;
  /** Residents near what it's after, and those the shelters take (counted at the warning). */
  near?: number;
  sheltered?: number;
}

/** What a battle did, for the war room and the notices. */
export interface BattleReport {
  id: number;
  start: number;
  end: number;
  other: string;
  /** This city attacked (an expedition) rather than defended. */
  ours: boolean;
  target: BattleTarget;
  outcome: Outcome | null;
  collapsed: number[];
  burning: number[];
  civics: { id: number; def: string; wrecked: boolean }[];
  craters: number;
  /** This city's units lost, by kind; the other side's lost and how many came. */
  lost: Partial<Record<UnitKind, number>>;
  theirLost: number;
  theirTotal: number;
  near: number;
  sheltered: number;
  /** Residents whose homes fell (they move out). */
  homeless: number;
  /** An expedition's battle in the other town: what fell there, and the objectives hit. */
  away?: { destroyed: number; damaged: number; objectives: { aimed: number; down: number } };
  /** The page's record of the battle to watch again, if it kept one. */
  replay?: string;
}

/** The battle being fought in this city. Its course is re-run from `input` after a load. */
export interface HostedBattle {
  id: number;
  input: BattleInput;
  step: number;
  start: number;
  raid: Raid;
  report: BattleReport;
}

/** Colours for computer neighbours' forces, by their place in the region. */
const RIVAL_COLOURS = [0xd8493f, 0x8e4fb5, 0xe08a2a, 0x3d9a6a];

export function neighbourColour(sim: Sim, id: number): number {
  const k = sim.state.region.neighbours.findIndex((n) => n.id === id);
  return RIVAL_COLOURS[Math.max(0, k) % RIVAL_COLOURS.length]!;
}

/** The city's fighting strength: its units by health, and its manned defences. */
export function cityStrength(sim: Sim): number {
  const w = sim.state.war;
  if (!w) return 0;
  let s = 0;
  for (const u of w.units.values()) s += (UNIT.get(u.kind)?.strength ?? 1) * u.hp;
  for (const c of militaryCivics(sim)) {
    const d = militaryOf(c)!.defends;
    if (d && civicOnline(c)) s += d.strength * Math.min(1, c.staff ?? 0) * (c.powered ?? 0);
  }
  return s;
}

/** Working radars give earlier warning: hours of warning a force on its way gives. */
export function warningHours(sim: Sim): number {
  let radars = 0;
  for (const c of militaryCivics(sim))
    if (militaryOf(c)!.radar && civicOnline(c) && (c.staff ?? 0) >= 0.25 && (c.powered ?? 0) >= 0.5) radars++;
  return Math.min(WARNING.max, WARNING.base + WARNING.perRadar * radars);
}

/** Hours a force takes to come by a route, from a neighbour on one side. */
export function travelHours(route: BattleRoute, side: string, units: { kind: UnitKind }[]): number {
  let h = ROUTES[route].hours;
  if (side === 'north' || side === 'south') h *= TRAVEL.northSouth;
  if (route === 'highway' || route === 'rail') {
    const squads = units.filter((u) => u.kind === 'infantry').length;
    const trucks = units.filter((u) => u.kind === 'transport').length;
    if (squads && !trucks) h *= TRAVEL.walking;
    else if (squads && trucks * 4 >= squads) h *= TRAVEL.riding;
  }
  return Math.max(1, Math.ceil(h));
}

/** A computer neighbour's raiding force: its strength's share in units, mixed by its character. */
export function rivalForce(r: RivalNeighbour, share: number, rng: Rng): { kind: UnitKind; hp: number }[] {
  const mix = RIVAL_MIX[r.personality] ?? RIVAL_MIX.honourable!;
  const kinds = (Object.keys(mix) as UnitKind[]).sort();
  const total = kinds.reduce((a, k) => a + mix[k]!, 0);
  let budget = r.forces * share;
  const out: { kind: UnitKind; hp: number }[] = [];
  for (let guard = 0; guard < 200 && out.length < 24 && budget > 0.5; guard++) {
    let pick = rng.next() * total;
    let kind = kinds[0]!;
    for (const k of kinds) {
      pick -= mix[k]!;
      if (pick < 0) {
        kind = k;
        break;
      }
    }
    const cost = UNIT.get(kind)!.strength;
    if (cost > budget + 0.5) {
      if (out.length) break;
      continue;
    }
    out.push({ kind, hp: 1 });
    budget -= cost;
  }
  if (!out.length) out.push({ kind: 'infantry', hp: 1 });
  return out;
}

function eligible(sim: Sim): boolean {
  const s = sim.state;
  return s.totals.population >= RAIDS.minPopulation && s.tick >= RAIDS.minMonths * TICKS_PER_MONTH;
}

/** Every tick while a raid is on its way: its warning when the city hears of it, and its arrival. */
export function raidsTick(sim: Sim): void {
  const w = sim.state.war;
  if (!w?.incoming) return;
  const s = sim.state;
  for (const r of w.incoming) if (!r.warned && s.tick >= r.warn) warnRaid(sim, r);
  const due = w.incoming.find((r) => s.tick >= r.arrive);
  if (!due) return;
  // One battle at a time: a second force waits an hour.
  if (w.battle) due.arrive = s.tick + TICKS_PER_HOUR;
  else {
    w.incoming = w.incoming.filter((r) => r !== due);
    if (!w.incoming.length) delete w.incoming;
    startHomeBattle(sim, due);
  }
}

/** Each hour, in the war hour: the neighbours decide whether to raid. */
export function raidsHour(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  const s = sim.state;
  if (!RAIDS.decide || w.incoming?.length || w.battle || !eligible(sim)) return;
  const last = w.raided?.any ?? -Infinity;
  if (s.tick - last < RAIDS.gapAny * TICKS_PER_MONTH) return;
  const rng = new Rng(w.rng);
  const strength = Math.max(1, cityStrength(sim));
  for (const n of s.region.neighbours) {
    const r = n.rival;
    if (!r || n.player) continue;
    if (s.tick - (w.raided?.by[n.id] ?? -Infinity) < RAIDS.gapEach * TICKS_PER_MONTH) continue;
    const p = PERSONALITY[r.personality];
    let chance = (p.aggression * Math.min(RAIDS.ratioCap, r.forces / strength)) / RAIDS.perHour;
    if (r.relation <= RAIDS.hostile) chance *= 2;
    else if (r.relation >= RAIDS.friendly) chance *= 0.25;
    if (!rng.chance(chance)) continue;
    w.rng = rng.getState();
    planRaid(sim, n, r, rng);
    w.rng = rng.getState();
    return;
  }
  w.rng = rng.getState();
}

/** A neighbour sets off: the raid's force, target and timing. */
export function planRaid(sim: Sim, n: Neighbour, r: RivalNeighbour, rng: Rng, hours?: number): Raid {
  const w = sim.state.war!;
  const s = sim.state;
  const units = rivalForce(r, RAIDS.share, rng);
  const allAir = units.every((u) => UNIT.get(u.kind)!.domain === 'air');
  const route: BattleRoute = allAir ? 'air' : 'highway';
  const travel = hours ?? travelHours(route, n.side, units);
  const lead = Math.min(travel, warningHours(sim));
  const raid: Raid = {
    id: s.nextId++,
    from: n.id,
    name: n.name,
    units,
    target: RIVAL_TARGET[r.personality] ?? 'military',
    route,
    stance: r.personality === 'cautious' || r.personality === 'mercantile' ? 'cautious' : 'bold',
    readiness: 0.8,
    warn: s.tick + (travel - lead) * TICKS_PER_HOUR,
    arrive: s.tick + travel * TICKS_PER_HOUR,
  };
  (w.incoming ??= []).push(raid);
  w.raided = { any: s.tick, by: { ...(w.raided?.by ?? {}), [n.id]: s.tick } };
  sim.warChanged();
  if (s.tick >= raid.warn) warnRaid(sim, raid);
  return raid;
}

/** Residents near what a raid is after: the homes within reach of those targets. */
function shelterCount(sim: Sim, target: BattleTarget): { near: number; sheltered: number } {
  const s = sim.state;
  const spots: { x: number; z: number }[] = [];
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    const def = CIVIC.get(c.def);
    if (!def) continue;
    if (
      (target === 'military' && def.category === 'military') ||
      (target === 'power' && def.category === 'power')
    )
      spots.push({ x: c.x, z: c.z });
  }
  if (target === 'industry')
    for (const b of s.buildings.values())
      if (b.zone === ZONE_I && b.state === BState.Active) spots.push({ x: b.x, z: b.z });
  let near = 0;
  if (spots.length)
    for (const b of s.buildings.values()) {
      if (b.zone !== ZONE_R || b.state !== BState.Active || b.pop <= 0) continue;
      if (spots.some((p) => DMath.hypot(p.x - b.x, p.z - b.z) <= 600)) near += b.pop;
    }
  let places = 0;
  for (const c of militaryCivics(sim)) {
    const m = militaryOf(c)!;
    if (m.shelters && civicOnline(c)) places += m.shelters * Math.min(1, Math.max(0.5, c.staff ?? 0));
  }
  return { near: Math.round(near), sheltered: Math.round(Math.min(near, places)) };
}

function warnRaid(sim: Sim, r: Raid): void {
  r.warned = true;
  const { near, sheltered } = shelterCount(sim, r.target);
  r.near = near;
  r.sheltered = sheltered;
  sim.events.push({
    kind: 'raidWarning',
    id: r.id,
    info: {
      from: r.name,
      hours: Math.max(0, Math.round((r.arrive - sim.state.tick) / TICKS_PER_HOUR)),
      near,
      sheltered,
      units: r.units.length,
    },
  });
  sim.warChanged();
}

function emptyReport(r: Raid, start: number): BattleReport {
  return {
    id: r.id,
    start,
    end: 0,
    other: r.name,
    ours: false,
    target: r.target,
    outcome: null,
    collapsed: [],
    burning: [],
    civics: [],
    craters: 0,
    lost: {},
    theirLost: 0,
    theirTotal: r.units.length,
    near: r.near ?? 0,
    sheltered: r.sheltered ?? 0,
    homeless: 0,
  };
}

/** The raid arrives: the battle begins, here. */
export function startHomeBattle(sim: Sim, r: Raid): void {
  const w = sim.state.war!;
  const s = sim.state;
  if (!r.warned) warnRaid(sim, r);
  const n = s.region.neighbours.find((x) => x.id === r.from);
  const layout = battleLayout(sim, { target: r.target, from: n?.side ?? 'west' });
  const units: BattleUnitIn[] = r.units.map((u, k) => ({
    id: -(k + 1),
    kind: u.kind,
    hp: u.hp,
    x: 0,
    z: 0,
    base: -1,
  }));
  const input: BattleInput = {
    v: BATTLE_VERSION,
    id: `raid-${r.id}`,
    seed: `${s.options.seed}:battle:${r.id}`,
    scale: 'skirmish',
    layout,
    attacker: {
      name: r.name,
      color: neighbourColour(sim, r.from),
      units,
      route: r.route,
      target: r.target,
      stance: r.stance,
      readiness: r.readiness,
    },
    defender: { name: s.options.cityName, color: 0x3a78c8 },
    orders: [],
    caps: { maxCollapse: SKIRMISH.maxCollapse, maxWreck: SKIRMISH.maxWreck },
  };
  w.battle = { id: r.id, input, step: 0, start: s.tick, raid: r, report: emptyReport(r, s.tick) };
  sim.battleRun = null;
  sim.events.push({ kind: 'battleStarted', id: r.id, info: { from: r.name, target: r.target } });
  sim.warChanged();
}

/**
 * A battle fought elsewhere, hosted here (M35): `watch` plays it out a tick at a time (a replay, or
 * the view of a neighbour's town), `instant` plays it to its end at once (a city whose player was
 * away). Its damage reaches the city as any battle's does.
 */
export function resolveBattle(
  sim: Sim,
  input: BattleInput,
  mode: 'watch' | 'instant',
  dryRun: boolean,
  replay?: string,
): CommandResult {
  const s = sim.state;
  const w = s.war;
  if (!w) return fail('War is off in this city');
  if (w.battle) return fail('A battle is on in the city already');
  if (input.v !== BATTLE_VERSION) return fail('That battle was fought by another version of the game');
  if (dryRun) return ok(0);
  const a = input.attacker;
  const raid: Raid = {
    id: s.nextId++,
    from: -1,
    name: a.name,
    units: a.units.map((u) => ({ kind: u.kind, hp: u.hp })),
    target: a.target,
    route: a.route,
    stance: a.stance,
    readiness: a.readiness,
    warn: s.tick,
    arrive: s.tick,
    warned: true,
    near: 0,
    sheltered: 0,
  };
  w.battle = { id: raid.id, input, step: 0, start: s.tick, raid, report: emptyReport(raid, s.tick) };
  if (replay) w.battle.report.replay = replay.slice(0, 60);
  sim.battleRun = null;
  sim.events.push({ kind: 'battleStarted', id: raid.id, info: { from: a.name, target: a.target } });
  if (mode === 'instant') {
    const run = new Battle(input);
    while (!run.outcome) applyWarDamage(sim, w.battle.report, run.tick());
    w.battle.step = run.step;
    sim.battleFrame = run.frame();
    endHomeBattle(sim, run);
  }
  sim.warChanged();
  return ok(0, { created: [raid.id] });
}

/** Every tick a battle is on: its steps for the tick, their damage to the city, the frame. */
export function battleTick(sim: Sim): void {
  const w = sim.state.war;
  const hb = w?.battle;
  if (!w || !hb) return;
  let run = sim.battleRun;
  if (!run || run.input !== hb.input) {
    // After a load (or the first tick): play the battle up to where it was, its damage long done.
    run = new Battle(hb.input);
    while (run.step < hb.step && !run.outcome) run.stepOnce();
    run.drain();
    sim.battleRun = run;
  }
  const events = run.tick();
  applyWarDamage(sim, hb.report, events);
  hb.step = run.step;
  sim.battleFrame = run.frame();
  if (run.outcome) endHomeBattle(sim, run);
}

/** The single way a battle's damage reaches the city. */
export function applyWarDamage(sim: Sim, report: BattleReport, events: BattleEvent[]): void {
  const s = sim.state;
  const w = s.war;
  for (const e of events) {
    if (e.k === 'damaged') {
      const b = s.buildings.get(e.s);
      if (b) {
        if (b.state !== BState.Rubble && b.state !== BState.Construction && b.fire <= 0) {
          ignite(sim, b);
          report.burning.push(b.id);
        }
        continue;
      }
      const c = s.civics.get(e.s);
      if (c) {
        damageCivic(sim, c.id, WAR_DAMAGE.civicHours, false);
        if (!report.civics.some((x) => x.id === c.id))
          report.civics.push({ id: c.id, def: c.def, wrecked: false });
      }
    } else if (e.k === 'destroyed') {
      const b = s.buildings.get(e.s);
      if (b) {
        if (b.state !== BState.Rubble) {
          report.homeless += b.zone === ZONE_R ? Math.round(b.pop) : 0;
          toRubble(sim, b, 'collapsed');
          report.collapsed.push(b.id);
        }
        continue;
      }
      const c = s.civics.get(e.s);
      if (c) {
        damageCivic(sim, c.id, WAR_DAMAGE.wreckHours, true);
        const r = report.civics.find((x) => x.id === c.id);
        if (r) r.wrecked = true;
        else report.civics.push({ id: c.id, def: c.def, wrecked: true });
      }
    } else if (e.k === 'crater') {
      if (!s.net.segments.has(e.seg) || e.seg === s.highway.segment) continue;
      const had = s.roadDamage.get(e.seg) ?? 0;
      s.roadDamage.set(e.seg, Math.max(had, WAR_DAMAGE.roadHours));
      if (!had) {
        report.craters++;
        sim.roadsBlockedChanged();
      }
    } else if (e.k === 'out') {
      if (e.side === 1) {
        if (w?.units.delete(e.unit)) {
          report.lost[e.kind] = (report.lost[e.kind] ?? 0) + 1;
          sim.events.push({ kind: 'unitLost', id: e.unit, info: { kind: e.kind } });
          sim.warChanged();
        }
      } else report.theirLost++;
    } else if (e.k === 'end') report.outcome = e.outcome;
  }
}

/** A city building hit in a battle closes for repairs; knocked out, it's a wreck until repaired. */
function damageCivic(sim: Sim, id: number, hours: number, wreck: boolean): void {
  const c = sim.state.civics.get(id);
  if (!c) return;
  const was = c.damage;
  c.damage = Math.max(c.damage, Math.round(hours));
  if (wreck) c.wrecked = true;
  if (!was || wreck) {
    sim.civicStatusChanged(c.id);
    sim.events.push({ kind: 'civicDamaged', id: c.id });
  }
}

function endHomeBattle(sim: Sim, run: Battle): void {
  const w = sim.state.war!;
  const hb = w.battle!;
  const s = sim.state;
  const result = run.result();
  // The defenders who came through keep their scars; they mend at their bases.
  for (const u of result.units) {
    if (u.side !== 1 || u.out) continue;
    const unit = w.units.get(u.id);
    if (unit) unit.hp = Math.max(0.05, u.hp);
  }
  // The neighbour's losses come off its forces.
  const n = s.region.neighbours.find((x) => x.id === hb.raid.from);
  if (n?.rival) {
    let lost = 0;
    for (const u of result.units) if (u.side === 0 && u.out) lost += UNIT.get(u.kind)?.strength ?? 1;
    n.rival.forces = Math.max(0, Math.round((n.rival.forces - lost) * 10) / 10);
  }
  const report = hb.report;
  report.end = s.tick;
  report.outcome = result.outcome;
  w.reports = [...(w.reports ?? []), report].slice(-12);
  delete w.battle;
  sim.battleRun = null;
  sim.events.push({
    kind: 'battleEnded',
    id: report.id,
    info: {
      from: report.other,
      outcome: result.outcome,
      collapsed: report.collapsed.length,
      civics: report.civics.length,
      lost: Object.values(report.lost).reduce((a, v) => a + (v ?? 0), 0),
      theirLost: report.theirLost,
    },
  });
  sim.warChanged();
}

/** Approval the last raid costs for three days, by the share of nearby residents left unsheltered. */
export function raidMood(sim: Sim): number {
  const w = sim.state.war;
  const r = w?.reports?.at(-1);
  if (!r || r.ours || !r.near) return 0;
  const age = sim.state.tick - r.end;
  const span = 3 * 24 * TICKS_PER_HOUR;
  if (age >= span) return 0;
  return -0.04 * (1 - r.sheltered / r.near) * (1 - age / span);
}

/** Units at a staffed, powered base mend a little each hour (M35). */
export function mendUnits(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  for (const u of [...w.units.values()].sort((a, b) => a.id - b.id)) {
    if (u.hp >= 1) continue;
    const c = sim.state.civics.get(u.base);
    if (!c || !civicOnline(c)) continue;
    const rate = 0.05 * Math.min(1, c.staff ?? 0) * (c.powered ?? 0);
    if (rate <= 0) continue;
    u.hp = Math.min(1, Math.round((u.hp + rate) * 1000) / 1000);
    sim.warChanged();
  }
}

/** The battle frame for the page while a battle is on (null otherwise). */
export function battleFrameOf(sim: Sim): BattleFrame | null {
  return sim.state.war?.battle ? sim.battleFrame : null;
}
