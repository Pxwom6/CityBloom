/**
 * Raids and battles at home (phase 5, M35), DESIGN.md §3.29. Computer neighbours decide now and
 * then to raid the city; a raid is announced (the radar's warning), arrives, and is fought here: the
 * battle (src/sim/battle) runs a step at a time inside this city's sim, and every event it gives
 * reaches the city through one handler, `applyWarDamage` (fires, rubble, city buildings closed or
 * wrecked, craters, units lost), the disasters' own machinery repairing it all afterwards. A report
 * is kept for the war room. Everything here exists only in a city with war on.
 */
import {
  BATTLE,
  RAIDS,
  RIVAL_TARGET,
  ROUTES,
  SKIRMISH,
  SUPER,
  TRAVEL,
  WAR_DAMAGE,
  WARNING,
  type BattleRoute,
  type BattleTarget,
  type Stance,
} from '../../data/battle';
import { UNIT, type UnitKind } from '../../data/war';
import { Battle } from '../battle/battle';
import { checkBattleInput } from '../battle/check';
import { appendOrders, stampLive, type StampedOrder } from '../battle/live';
import { battleLayout, objectiveSpots, strengthFactors, structureAsSeen } from '../battle/layout';
import {
  BATTLE_V4,
  BATTLE_VERSION,
  S,
  type BattleEvent,
  type BattleFrame,
  type BattleInput,
  type BattleUnitIn,
  type ForceIn,
  type Outcome,
} from '../battle/types';
import { stampBattle } from '../battle/version';
import { rivalMix, rivalMods } from '../ai/tech';
import { DMath } from '../dmath';
import { fail, ok, type CommandResult } from '../commands';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../time';
import { BState } from '../world/buildings';
import { civicOnline } from '../world/civic';
import { ZONE_R } from '../../data/zones';
import { ignite, toRubble } from './incidents';
import { militaryCivics, militaryOf, raidThreat } from './war';
import { researchEffect, researchMods } from './research';
import { blackedOut, domePool, lowerDome, raiseDome, rivalBlackedOut } from './supers';
import { SUPER_UNCOUNTED, battleHasSuper } from './regionOps';
import { powerSabotaged, revealed, rivalKnows } from './intel';
import { INTEL } from '../../data/intel';
import { RESEARCH } from '../../data/research';
import { anyWarOpen, homeBattleFacts, raidStance, scoreHomeBattle } from './diplomacy';
import { wearinessRaid } from './weariness';
import { aggressionOf, warDifficulty } from './warEconomy';
import { DIPLOMACY } from '../../data/diplomacy';
import { CIVIC } from '../../data/civic';
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
  /** What the city's buildings knocked down or wrecked were worth ($; M36's war score). */
  worth?: number;
  /** A friend's raid that came while the player was away: half the damage (M36). */
  absent?: true;
}

/** The battle being fought in this city. Its course is re-run from `input` after a load. */
export interface HostedBattle {
  id: number;
  input: BattleInput;
  step: number;
  start: number;
  raid: Raid;
  report: BattleReport;
  /**
   * The city's own dome over a battle made elsewhere that knew of less of it (M37): what's left of
   * the difference, and the structures it has covered (their hits never reach the city).
   */
  cover?: DomeCover;
  /**
   * M39: a battle fought live with a friend, as the region room orders it. The battle never runs to
   * `allow` or past it (the room's frontier, raised by `battleLive`); `seq` is the last of the room's
   * stamped orders taken into `input.orders`. Optional, so a save without it is a battle as ever.
   */
  live?: LiveHosting;
}

/** The live battle this city hosts (M39): the room's id for it, the attacker's place, how far it may run. */
export interface LiveHosting {
  id: string;
  from: number;
  allow: number;
  seq: number;
  /** It has begun (the room's first word), and the city has felt it. */
  begun?: true;
}

/** A dome's pool beyond a battle's own (M37), spent on structures' whole strength, each once. */
export interface DomeCover {
  pool: number;
  ids: number[];
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
  for (const u of w.units.values()) if (!u.away) s += (UNIT.get(u.kind)?.strength ?? 1) * u.hp;
  for (const c of militaryCivics(sim)) {
    const d = militaryOf(c)!.defends;
    if (d && civicOnline(c)) s += d.strength * Math.min(1, c.staff ?? 0) * (c.powered ?? 0);
  }
  return s;
}

/**
 * Working radars give earlier warning: hours of warning a force on its way gives. Long-range radar
 * (M37) makes each radar's warning and the most they give longer.
 */
export function warningHours(sim: Sim): number {
  // Blacked out by a friend's tower (M37): the radars are dark.
  if (blackedOut(sim)) return WARNING.base;
  let radars = 0;
  for (const c of militaryCivics(sim))
    if (militaryOf(c)!.radar && civicOnline(c) && (c.staff ?? 0) >= 0.25 && (c.powered ?? 0) >= 0.5) radars++;
  const per = researchEffect(sim, 'radarWarning', WARNING.perRadar);
  const max = researchEffect(sim, 'radarWarningMax', WARNING.max);
  return Math.min(max, WARNING.base + per * radars);
}

/**
 * Hours a force takes to come by a route, from a neighbour on one side; `factor` is the sender's
 * Supply lines (M37), 1 for everyone else.
 */
export function travelHours(
  route: BattleRoute,
  side: string,
  units: { kind: UnitKind }[],
  factor = 1,
): number {
  let h = ROUTES[route].hours;
  if (side === 'north' || side === 'south') h *= TRAVEL.northSouth;
  if (route === 'highway' || route === 'rail') {
    const squads = units.filter((u) => u.kind === 'infantry').length;
    const trucks = units.filter((u) => u.kind === 'transport').length;
    if (squads && !trucks) h *= TRAVEL.walking;
    else if (squads && trucks * 4 >= squads) h *= TRAVEL.riding;
  }
  // To the half hour: air's hour and a half stays one, and riding saves time on rail too.
  return Math.max(1, Math.ceil(h * factor * 2) / 2);
}

/** A computer neighbour's raiding force: its strength's share in units, mixed by its character. */
export function rivalForce(r: RivalNeighbour, share: number, rng: Rng): { kind: UnitKind; hp: number }[] {
  // Its character's mix, heavier once its tech allows (M37).
  const mix = rivalMix(r);
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

/**
 * A neighbour's chance of setting off to raid the city in an hour: its aggression (with the
 * difficulty's, M38) times the ratio of its forces to the city's strength (capped), cooler or hotter by
 * its feelings, quadrupled when the city struck it lately, scaled by the stance (a war's) and by the
 * difficulty's raids lever. At Normal the levers are 0 and 1 and this is the M35 formula exactly.
 */
export function raidChance(
  sim: Sim,
  r: RivalNeighbour,
  strength: number,
  answering: boolean,
  stanceFactor: number,
): number {
  let chance =
    (aggressionOf(sim, r.personality) * Math.min(RAIDS.ratioCap, r.forces / strength)) / RAIDS.perHour;
  if (r.relation <= RAIDS.hostile) chance *= 2;
  else if (r.relation >= RAIDS.friendly) chance *= 0.25;
  if (answering) chance *= 4;
  chance *= stanceFactor;
  return chance * warDifficulty(sim).raids;
}

/** Each hour, in the war hour: the neighbours decide whether to raid. */
export function raidsHour(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  const s = sim.state;
  if (!RAIDS.decide) return;
  // A young or small city is left alone, unless it struck a neighbour first: that one may answer.
  const threat = raidThreat(sim);
  if (threat.open && !w.exposed && s.region.neighbours.some((n) => n.rival && !n.player)) {
    w.exposed = true;
    sim.events.push({ kind: 'raidsOpen', id: 0 });
  }
  if (w.incoming?.length || w.battle) return;
  // In a declared war (M36) raids come closer together, and a city at war is raided however young.
  const atWar = anyWarOpen(sim, true);
  const last = w.raided?.any ?? -Infinity;
  // The difficulty's raids lever (M38) stretches or shortens the waits too: in a war the gaps are
  // what bind, so a chance alone would hardly show (Normal divides by 1).
  const often = warDifficulty(sim).raids;
  if (s.tick - last < ((atWar ? DIPLOMACY.war.gapAnyMonths : RAIDS.gapAny) * TICKS_PER_MONTH) / often) return;
  if (!threat.open && !threat.answering.length && !atWar) return;
  const rng = new Rng(w.rng);
  const strength = Math.max(1, cityStrength(sim));
  for (const n of s.region.neighbours) {
    const r = n.rival;
    if (!r || n.player) continue;
    const stance = raidStance(sim, n);
    if (!stance) continue;
    const answering = threat.answering.includes(n.id);
    if (!threat.open && !answering && !stance.war) continue;
    if (s.tick - (w.raided?.by[n.id] ?? -Infinity) < (stance.gapEach * TICKS_PER_MONTH) / often) continue;
    if (r.forces < 1) continue;
    // Blacked out by the city's tower, or its power sabotaged by the city's spies (M37): no raids meanwhile.
    if (rivalBlackedOut(sim, n) || powerSabotaged(sim, n)) continue;
    if (!rng.chance(raidChance(sim, r, strength, answering, stance.factor))) continue;
    w.rng = rng.getState();
    // In a total war a neighbour that clearly outguns the city goes for its seat of power.
    planRaid(sim, n, r, rng, undefined, stance.seat && r.forces >= 1.2 * strength);
    w.rng = rng.getState();
    return;
  }
  w.rng = rng.getState();
}

/** A neighbour sets off: the raid's force, target and timing. */
export function planRaid(
  sim: Sim,
  n: Neighbour,
  r: RivalNeighbour,
  rng: Rng,
  hours?: number,
  seat = false,
): Raid {
  const w = sim.state.war!;
  const s = sim.state;
  const units = rivalForce(r, RAIDS.share, rng);
  const allAir = units.every((u) => UNIT.get(u.kind)!.domain === 'air');
  const route: BattleRoute = allAir ? 'air' : 'highway';
  const travel = hours ?? travelHours(route, n.side, units);
  // A neighbour the city's spies have looked round lately gives itself away sooner (M37).
  const lead = Math.min(travel, warningHours(sim) + (revealed(sim, n) ? INTEL.revealWarning : 0));
  const raid: Raid = {
    id: s.nextId++,
    from: n.id,
    name: n.name,
    units,
    target: raidTarget(sim, seat ? 'cityhall' : (RIVAL_TARGET[r.personality] ?? 'military')),
    route,
    stance: r.personality === 'cautious' || r.personality === 'mercantile' ? 'cautious' : 'bold',
    // Its own spies have looked round the city lately (M37): it comes readier.
    readiness: rivalKnows(sim, n) ? 0.8 + INTEL.revealReadiness : 0.8,
    warn: s.tick + (travel - lead) * TICKS_PER_HOUR,
    arrive: s.tick + travel * TICKS_PER_HOUR,
  };
  (w.incoming ??= []).push(raid);
  w.raided = { any: s.tick, by: { ...(w.raided?.by ?? {}), [n.id]: s.tick } };
  sim.warChanged();
  if (s.tick >= raid.warn) warnRaid(sim, raid);
  return raid;
}

/** What a raid goes for: what it wants if the city has one, else its military (M36: a raid that
 * finds nothing to strike is no battle at all). */
function raidTarget(sim: Sim, want: BattleTarget): BattleTarget {
  if (want === 'military' || objectiveSpots(sim, want).length) return want;
  return 'military';
}

/** Residents near what a raid is after: the homes within reach of those targets. */
function shelterCount(sim: Sim, target: BattleTarget): { near: number; sheltered: number } {
  const s = sim.state;
  // Around what the raid can strike: military buildings, or industry and power near the border.
  const spots = objectiveSpots(sim, target);
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
  // Computer neighbours bring no superweapons (M37).
  const pool = raisedDomePool(sim, false);
  if (pool > 0) layout.dome = pool;
  const units: BattleUnitIn[] = r.units.map((u, k) => ({
    id: -(k + 1),
    kind: u.kind,
    hp: u.hp,
    x: 0,
    z: 0,
    base: -1,
  }));
  // The raiders' research, from the neighbour's tech (M37: none until its tech arrives).
  const mods = n?.rival ? rivalMods(n.rival) : undefined;
  const input: BattleInput = stampBattle({
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
      ...(mods ? { mods } : {}),
    },
    defender: { name: s.options.cityName, color: 0x3a78c8 },
    orders: [],
    caps: { maxCollapse: SKIRMISH.maxCollapse, maxWreck: SKIRMISH.maxWreck },
  });
  w.battle = { id: r.id, input, step: 0, start: s.tick, raid: r, report: emptyReport(r, s.tick) };
  sim.battleRun = null;
  // The people mind a raid on their city (M38).
  wearinessRaid(sim);
  sim.events.push({ kind: 'battleStarted', id: r.id, info: { from: r.name, target: r.target } });
  sim.warChanged();
}

/**
 * A battle fought elsewhere, hosted here (M35): `watch` plays it out a tick at a time (a replay, or
 * the view of a neighbour's town), `instant` plays it to its end at once (a city whose player was
 * away). Its damage reaches the city as any battle's does. `live` (M39) hosts a battle this city's
 * own sim made the picture of (`liveBattleInput`) for a friend's force and that the region room
 * orders: it takes the input as it is (the other page runs the same one), plays only as far as the
 * room lets it (`battleLive`), and its orders arrive while it runs.
 */
export function resolveBattle(
  sim: Sim,
  input: BattleInput,
  mode: 'watch' | 'instant' | 'live',
  dryRun: boolean,
  replay?: string,
  from?: number,
  away = false,
  /** The region flagged it as bringing a superweapon, and counted it so (M37). */
  counted = false,
): CommandResult {
  const s = sim.state;
  const w = s.war;
  if (!w) return fail('War is off in this city');
  const why = checkBattleInput(input);
  if (why) return fail(why);
  const live = mode === 'live';
  if (live && (from === undefined || input.v !== BATTLE_V4))
    return fail('A live battle is a friend’s, and a version 4 one');
  // The record of a live battle this very city hosts (it was reloaded, or its page lost the room): it
  // stands in for the hosted one, which was only a part of the same battle.
  const standsIn = mode === 'instant' && from !== undefined && w.battle?.live?.id === input.id;
  if (w.battle && !standsIn) return fail(BATTLE_BUSY);
  // A friend's battle is known by its sender too (M36: two cities' battles may share an id).
  const takenKey = from === undefined ? input.id : `${from}:${input.id}`;
  if (!standsIn && (w.taken?.includes(takenKey) || w.taken?.includes(input.id))) return fail(BATTLE_TAKEN);
  // A friend's raid (M36): from a city of the region this one knows. Whether it may raid at all
  // (shields, the day's raids) the region room has decided already, as both cities' pages heard.
  const friend = from === undefined ? undefined : s.region.neighbours.find((n) => n.player?.slot === from);
  if (from !== undefined && !friend) return fail('That raid came from a city this one doesn’t know');
  // A friend's battle bringing a superweapon counts only as the region counted it (M37): one it
  // didn't flag takes nothing here (a forged page could otherwise dodge the day's superweapon).
  if (from !== undefined && !counted && battleHasSuper(input)) return fail(SUPER_UNCOUNTED);
  if (dryRun) return ok(0);
  if (standsIn) {
    delete w.battle;
    sim.battleRun = null;
    sim.battleFrame = null;
    lowerDome(sim);
  }
  // Only what really stands here, at home, takes the battle's damage; the caps are this city's, and
  // half them for a raid that came while the player was away.
  // (A live battle's picture is this city's own, made a moment ago and run by the friend's page too:
  // it is taken as it is, so both pages fight the same battle.)
  const adopted = live ? input : adoptBattle(sim, input, away);
  let run: Battle;
  try {
    run = new Battle(adopted);
  } catch {
    return fail('That battle could not be read');
  }
  const a = adopted.attacker;
  const shelter = shelterCount(sim, a.target);
  const raid: Raid = {
    id: s.nextId++,
    from: friend?.id ?? -1,
    name: a.name,
    units: a.units.map((u) => ({ kind: u.kind, hp: u.hp })),
    target: a.target,
    route: a.route,
    stance: a.stance,
    readiness: a.readiness,
    warn: s.tick,
    arrive: s.tick,
    warned: true,
    near: shelter.near,
    sheltered: shelter.sheltered,
  };
  w.battle = { id: raid.id, input: adopted, step: 0, start: s.tick, raid, report: emptyReport(raid, s.tick) };
  if (replay) w.battle.report.replay = replay.slice(0, 60);
  if (away) w.battle.report.absent = true;
  if (live) w.battle.live = { id: input.id, from: from!, allow: 0, seq: 0 };
  // The city's own dome is the authority (M37): a stale picture of it never makes it weaker.
  coverWithDome(
    w.battle,
    raisedDomePool(
      sim,
      a.units.some((u) => !!UNIT.get(u.kind)?.super),
    ),
  );
  // Each battle from outside is taken once, however often it's offered (a lost acknowledgement).
  w.taken = [...(w.taken ?? []), takenKey].slice(-BATTLE_TAKEN_KEEP);
  // A friend's raid weighs on the people as a neighbour's does (M38); a live battle's does once the
  // room lets it begin (it may still come to nothing).
  if (friend && !live) wearinessRaid(sim);
  sim.battleRun = run;
  // Its opening picture at once: a battle being watched shows before its first tick.
  sim.battleFrame = run.frame();
  if (!live)
    sim.events.push({ kind: 'battleStarted', id: raid.id, info: { from: a.name, target: a.target } });
  if (mode === 'instant') {
    try {
      while (!run.outcome) applyWarDamage(sim, w.battle.report, run.tick(), w.battle.cover);
      w.battle.step = run.step;
      sim.battleFrame = run.frame();
      endHomeBattle(sim, run);
    } catch {
      abandonBattle(sim);
    }
  }
  sim.warChanged();
  return ok(0, { created: [raid.id] });
}

/**
 * A friend's force asking for a live battle (M39): the region room's call, as the page passes it on.
 * `force` is the attacker's side as its own page made it (`awayForce`), `super` the region's flag
 * that it brings a superweapon.
 */
export interface LiveCall {
  id: string;
  /** The friend's place in the region. */
  from: number;
  force: ForceIn;
  super?: boolean;
}

const LIVE_TARGETS: readonly string[] = ['military', 'industry', 'power', 'cityhall'];

/**
 * The battle a friend's force fights in this city, live (M39, design call 4): the picture is the
 * city's own as it stands now (`battleLayout`, as for a computer raid), so every id is one of this
 * city's and the friend's page can run the very same input; the force is the friend's, as it asked.
 * Nothing in the city changes (a query); the page sends the input to the room, and hosts it with
 * `battleResolve` in `live` mode. Returns the input, or why this city can't take it now.
 */
export function liveBattleInput(sim: Sim, call: LiveCall): { input: BattleInput } | { refused: string } {
  const s = sim.state;
  const w = s.war;
  if (!w) return { refused: 'War is off in this city' };
  if (w.battle) return { refused: BATTLE_BUSY };
  if (w.taken?.includes(`${call.from}:${call.id}`)) return { refused: BATTLE_TAKEN };
  const n = s.region.neighbours.find((x) => x.player?.slot === call.from);
  if (!n) return { refused: 'That raid came from a city this one doesn’t know' };
  const f = call.force;
  if (
    !f ||
    !Array.isArray(f.units) ||
    f.units.length > BATTLE.maxAttackers + SUPER.maxCarried ||
    !f.units.every((u) => !!u && typeof u === 'object') ||
    !LIVE_TARGETS.includes(f.target)
  )
    return { refused: 'That force could not be read' };
  const layout = battleLayout(sim, { target: f.target, from: n.side });
  // The city's own dome over it, if it would rise (not raised yet: that's `battleResolve`'s).
  const pool = domePool(
    sim,
    f.units.some((u) => !!UNIT.get(u?.kind)?.super),
  );
  if (pool > 0) layout.dome = pool;
  const input = stampBattle({
    v: BATTLE_VERSION,
    id: call.id,
    seed: `${s.options.seed}:live:${call.from}:${call.id}`,
    scale: 'skirmish',
    layout,
    attacker: {
      name: n.name,
      color: neighbourColour(sim, n.id),
      units: f.units.map((u) => ({
        id: u.id,
        kind: u.kind,
        hp: u.hp,
        x: 0,
        z: 0,
        base: -1,
        ...(u.from !== undefined ? { from: u.from } : {}),
      })),
      route: f.route,
      target: f.target,
      stance: f.stance,
      readiness: f.readiness,
      ...(f.mods ? { mods: f.mods } : {}),
    },
    defender: { name: s.options.cityName, color: 0x3a78c8 },
    orders: [],
    caps: { maxCollapse: SKIRMISH.maxCollapse, maxWreck: SKIRMISH.maxWreck },
  });
  stampLive(input);
  const why = checkBattleInput(input);
  return why ? { refused: why } : { input };
}

/**
 * The room's word on a live battle this city hosts (M39): the stamped orders it has not taken yet
 * (by their numbers, so a log sent again changes nothing), and how far the battle may now run (never
 * back). The first time it may run, the battle has begun for the city: its people feel it and the
 * notice goes out. `abort` drops a battle that never began (the room turned the call down after the
 * city had set it up), as if it had not been offered.
 */
export function battleLive(
  sim: Sim,
  id: string,
  allow: number,
  orders: readonly StampedOrder[],
  abort: boolean,
  dryRun: boolean,
): CommandResult {
  const w = sim.state.war;
  const hb = w?.battle;
  const live = hb?.live;
  if (!w || !hb || !live || live.id !== id) return fail('No such live battle');
  if (!Number.isInteger(allow) || allow < 0 || allow > LIVE_ALLOW_MAX) return fail('Not a step');
  if (!Array.isArray(orders) || orders.length > 512) return fail('Too many orders');
  if (abort && live.begun) return fail('That battle has begun');
  if (dryRun) return ok(0);
  if (abort) {
    // As if it had not been offered: the offer may be taken again, the dome stays down.
    w.taken = (w.taken ?? []).filter((k) => k !== `${live.from}:${live.id}`);
    delete w.battle;
    sim.battleRun = null;
    sim.battleFrame = null;
    lowerDome(sim);
    sim.warChanged();
    return ok(0);
  }
  live.seq = appendOrders(hb.input, live.seq, orders);
  if (allow > live.allow) live.allow = allow;
  if (live.allow > 0 && !live.begun) {
    live.begun = true;
    // A friend's raid weighs on the people as a neighbour's does (M38).
    wearinessRaid(sim);
    sim.events.push({
      kind: 'battleStarted',
      id: hb.id,
      info: { from: hb.input.attacker.name, target: hb.input.attacker.target },
    });
  }
  sim.warChanged();
  return ok(0);
}

/** The most steps a live battle may be allowed: the longest a battle can run, and a good deal more. */
export const LIVE_ALLOW_MAX = 100_000;

/** Why a battle from outside waits: one is on in the city already (it's offered again later). */
export const BATTLE_BUSY = 'A battle is on in the city already';
/** Why a battle from outside is turned away for good: the city took it already. */
export const BATTLE_TAKEN = 'The city has taken that battle already';
export const BATTLE_TAKEN_KEEP = 32;

/**
 * A battle fought on a picture of this city made elsewhere (a friend's page, from the region's save
 * of it), brought home: its course is left as it was, so both cities see the same battle, but only
 * buildings that really stand where it says, and units of this city's at home and of that kind,
 * answer to its ids; anything else it names is a stranger to this city and takes no damage. The
 * caps are this city's own.
 */
export function adoptBattle(sim: Sim, input: BattleInput, away = false): BattleInput {
  const s = sim.state;
  const w = s.war;
  const L = input.layout;
  const structs = L.structs.slice();
  const n = structs.length / S.stride;
  // Strength as this city's own picture has it (M37: hardened buildings, working shields).
  const factors = strengthFactors(sim);
  for (let k = 0; k < n; k++) {
    const row = (f: number) => structs[k * S.stride + f]!;
    // As this city's own picture has it: in its place, the same kind of thing, no weaker.
    const seen = structureAsSeen(sim, row(S.id), factors);
    const same =
      !!seen &&
      Math.abs(seen.x - row(S.x)) <= 2 &&
      Math.abs(seen.z - row(S.z)) <= 2 &&
      seen.tags === row(S.tags) &&
      row(S.hp) >= seen.hp - 1 &&
      seen.gun === row(S.gun) &&
      seen.range === row(S.range) &&
      seen.against === row(S.against);
    if (!same) structs[k * S.stride + S.id] = -(k + 1);
  }
  // The defenders' research (M37) as this city has it: in a domain where the battle's picture is
  // weaker (a save from before the research, or left out), those defenders fight as strangers, so
  // their losses never reach the city.
  const own = researchMods(sim);
  const weak = new Set<string>();
  for (const [d, m] of Object.entries(own)) {
    const p = L.mods?.[d as keyof typeof own] ?? {};
    if (
      (p.hp ?? 1) < (m.hp ?? 1) - 1e-9 ||
      (p.attack ?? 1) < (m.attack ?? 1) - 1e-9 ||
      (p.armour ?? 0) < (m.armour ?? 0) - 1e-9 ||
      (p.evade ?? 0) < (m.evade ?? 0) - 1e-9
    )
      weak.add(d);
  }
  const defenders = L.defenders.map((u, k) => {
    // One of this city's units at home, of that kind, at its base, and no weaker than it is.
    const mine = w?.units.get(u.id);
    const base = mine ? s.civics.get(mine.base) : undefined;
    const same =
      !!mine &&
      !mine.away &&
      mine.kind === u.kind &&
      u.hp >= mine.hp - 0.05 &&
      !!base &&
      Math.abs(base.x - u.x) <= 2 &&
      Math.abs(base.z - u.z) <= 2 &&
      (u.base < 0 || structs[u.base * S.stride + S.id] === mine.base) &&
      !weak.has(UNIT.get(u.kind)?.domain ?? 'land');
    return same ? u : { ...u, id: -(k + 1) };
  });
  return {
    ...input,
    layout: { ...L, structs, defenders },
    caps: {
      maxCollapse: Math.min(input.caps.maxCollapse, away ? SKIRMISH.awayCollapse : SKIRMISH.maxCollapse),
      maxWreck: Math.min(input.caps.maxWreck, away ? SKIRMISH.awayWreck : SKIRMISH.maxWreck),
    },
  };
}

/**
 * A battle as a city whose player was away takes it (M36): half the damage. The page keeps the
 * battle this way too, so its replay plays out as it happened.
 */
export function awayCaps(input: BattleInput): BattleInput {
  return {
    ...input,
    caps: {
      maxCollapse: Math.min(input.caps.maxCollapse, SKIRMISH.awayCollapse),
      maxWreck: Math.min(input.caps.maxWreck, SKIRMISH.awayWreck),
    },
  };
}

/** A battle that can't go on (it could not be read after all): it ends, nothing more is done. */
function abandonBattle(sim: Sim): void {
  const w = sim.state.war!;
  const hb = w.battle;
  if (!hb) return;
  const report = hb.report;
  report.end = sim.state.tick;
  report.outcome ??= 'withdrew';
  w.reports = [...(w.reports ?? []), report].slice(-12);
  delete w.battle;
  sim.battleRun = null;
  sim.battleFrame = null;
  lowerDome(sim);
  sim.warChanged();
}

/** Every tick a battle is on: its steps for the tick, their damage to the city, the frame. */
export function battleTick(sim: Sim): void {
  const w = sim.state.war;
  const hb = w?.battle;
  if (!w || !hb) return;
  let run = sim.battleRun;
  try {
    if (!run || run.input !== hb.input) {
      // After a load (or the first tick): play the battle up to where it was, its damage long done.
      run = new Battle(hb.input);
      while (run.step < hb.step && !run.outcome) run.stepOnce();
      run.drain();
      sim.battleRun = run;
    }
    // A live battle (M39) plays only up to the room's frontier: where the room has not let it run, nothing
    // moves, and the picture stays as it was.
    const before = run.step;
    const events = run.tick(hb.live ? hb.live.allow : Infinity);
    applyWarDamage(sim, hb.report, events, hb.cover);
    hb.step = run.step;
    if (run.step !== before || !sim.battleFrame) sim.battleFrame = run.frame();
    if (run.outcome) endHomeBattle(sim, run);
  } catch {
    // A city is never left stuck on a battle it can't play (one kept from an older, broken save).
    abandonBattle(sim);
  }
}

/**
 * The pool of the city's own dome, raised for a battle (M37, design call 9): a charged dome in the
 * right mode rises when a battle starts here (`super` mode only for one that brings a superweapon).
 */
export function raisedDomePool(sim: Sim, bringsSuper: boolean): number {
  return raiseDome(sim, bringsSuper);
}

/**
 * The city's own dome over a battle made elsewhere (M37, design call 9): when its raised pool is
 * larger than the one the battle knew of (a friend's page works from the city's last save), the
 * difference covers structures here, whatever the battle says (`applyWarDamage`).
 */
export function coverWithDome(hb: HostedBattle, ownPool: number): void {
  const extra = ownPool - (hb.input.layout.dome ?? 0);
  if (extra > 0) hb.cover = { pool: extra, ids: [] };
  else delete hb.cover;
}

/**
 * Does the dome's extra pool keep this structure's hits off the city? It covers a structure once,
 * for its whole strength (as this city sees it), while the pool lasts; one it can't cover pops it.
 */
function domeCovers(sim: Sim, cover: DomeCover, id: number): boolean {
  if (cover.ids.includes(id)) return true;
  if (cover.pool <= 0) return false;
  const seen = structureAsSeen(sim, id);
  if (!seen) return false;
  if (seen.hp > cover.pool) {
    cover.pool = 0;
    return false;
  }
  cover.pool -= seen.hp;
  cover.ids.push(id);
  return true;
}

/** The single way a battle's damage reaches the city (`cover`: the city's own dome, M37). */
export function applyWarDamage(
  sim: Sim,
  report: BattleReport,
  events: BattleEvent[],
  cover?: DomeCover,
): void {
  const s = sim.state;
  const w = s.war;
  for (const e of events) {
    if ((e.k === 'damaged' || e.k === 'destroyed') && cover && domeCovers(sim, cover, e.s)) continue;
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
          report.worth = (report.worth ?? 0) + Math.max(10_000, b.cap * 2_000);
          toRubble(sim, b, 'collapsed');
          report.collapsed.push(b.id);
        }
        continue;
      }
      const c = s.civics.get(e.s);
      if (c) {
        if (!c.wrecked) report.worth = (report.worth ?? 0) + (CIVIC.get(c.def)?.cost ?? 0);
        damageCivic(sim, c.id, WAR_DAMAGE.wreckHours, true);
        const r = report.civics.find((x) => x.id === c.id);
        if (r) r.wrecked = true;
        else report.civics.push({ id: c.id, def: c.def, wrecked: true });
      }
    } else if (e.k === 'crater') {
      if (!s.net.segments.has(e.seg) || e.seg === s.highway.segment) continue;
      if (report.craters >= SKIRMISH.maxCraters) continue;
      const had = s.roadDamage.get(e.seg) ?? 0;
      s.roadDamage.set(e.seg, Math.max(had, WAR_DAMAGE.roadHours));
      if (!had) {
        report.craters++;
        sim.roadsBlockedChanged();
      }
    } else if (e.k === 'out') {
      if (e.side === 1) {
        const u = w?.units.get(e.unit);
        if (u && !u.away && w!.units.delete(e.unit)) {
          report.lost[e.kind] = (report.lost[e.kind] ?? 0) + 1;
          sim.events.push({ kind: 'unitLost', id: e.unit, info: { kind: e.kind } });
          sim.warChanged();
        }
      } else report.theirLost++;
    } else if (e.k === 'dome') sim.events.push({ kind: 'domePopped', id: 0 });
    else if (e.k === 'end') report.outcome = e.outcome;
  }
}

/** A city building hit in a battle closes for repairs; knocked out, it's a wreck until repaired. */
export function damageCivic(sim: Sim, id: number, hours: number, wreck: boolean): void {
  const c = sim.state.civics.get(id);
  if (!c) return;
  const was = c.damage;
  // Repair crews (M37) put war-damaged buildings back sooner.
  c.damage = Math.max(c.damage, Math.round(hours * (1 - researchEffect(sim, 'repairSooner'))));
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
  // The defenders who came through keep their scars (what the battle took off them); they mend at
  // their bases.
  const went = new Map(hb.input.layout.defenders.map((u) => [u.id, u.hp]));
  for (const u of result.units) {
    if (u.side !== 1 || u.out) continue;
    const unit = w.units.get(u.id);
    if (!unit || unit.away) continue;
    const took = Math.max(0, (went.get(u.id) ?? u.hp) - u.hp);
    if (took > 0) unit.hp = Math.max(0.05, Math.round((unit.hp - took) * 1000) / 1000);
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
  // A dome raised for it is down now, whatever was left of its pool (M37).
  lowerDome(sim);
  // In a declared war the battle moves the score, and may take or free the seat of power (M36).
  // Whether any unit of either side was hurt (a raid beaten off by wounds alone is still a battle).
  const before = new Map<string, number>([
    ...hb.input.attacker.units.map((u) => [`0:${u.id}`, u.hp] as const),
    ...hb.input.layout.defenders.map((u) => [`1:${u.id}`, u.hp] as const),
  ]);
  const hurt = result.units.some((u) => u.out || u.hp < (before.get(`${u.side}:${u.id}`) ?? u.hp));
  scoreHomeBattle(sim, hb.raid.from, report, result.objectives.aimed, result.objectives.down, hurt);
  // A friend's raid is scored by the region, from what this end of it knows (M39): the page passes it on.
  const raider = s.region.neighbours.find((x) => x.id === hb.raid.from);
  const facts = raider?.player
    ? homeBattleFacts(report, result.objectives.aimed, result.objectives.down, hurt)
    : null;
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
      // How it ended: the step and `hash()` (a live battle's page tells the room, M39).
      step: result.steps,
      hash: result.hash,
      ...(hb.live ? { live: hb.live.id } : {}),
      // A friend's raid (M39): the region's id for the battle and who raided, and (when there was
      // contact, `friendScored`) what the war score takes from it; flags are 0 or 1.
      ...(raider?.player
        ? {
            friendSlot: raider.player.slot,
            friendBattle: hb.live?.id ?? hb.input.id,
            friendScored: facts ? 1 : 0,
            friendDecisive: facts?.decisive ?? 0,
            friendWorth: Math.round(facts?.worth ?? 0),
            friendSeatDown: facts?.seatDown ? 1 : 0,
            friendAway: report.absent ? 1 : 0,
          }
        : {}),
    },
  });
  sim.warChanged();
}

/** Approval the last raid costs for three days, by the share of nearby residents left unsheltered. */
export function raidMood(sim: Sim): number {
  const w = sim.state.war;
  // The newest raid on the city that found residents near (a report of our own raid doesn't count).
  const r = [...(w?.reports ?? [])].reverse().find((x) => !x.ours && x.near > 0);
  if (!r) return 0;
  const age = sim.state.tick - r.end;
  const span = 3 * 24 * TICKS_PER_HOUR;
  if (age >= span) return 0;
  return -0.04 * (1 - r.sheltered / r.near) * (1 - age / span);
}

/**
 * Units at a staffed, powered base mend a little each hour (M35): land units faster after Field
 * workshops, and every unit faster for each repair truck at home after Repair crews (M37).
 */
export function mendUnits(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  const trucks = repairBoost(sim);
  const land = researchEffect(sim, 'landMend');
  for (const u of [...w.units.values()].sort((a, b) => a.id - b.id)) {
    if (u.hp >= 1 || u.away) continue;
    const c = sim.state.civics.get(u.base);
    if (!c || !civicOnline(c)) continue;
    let rate = 0.05 * Math.min(1, c.staff ?? 0) * (c.powered ?? 0) * trucks;
    if (UNIT.get(u.kind)?.domain === 'land') rate *= land;
    if (rate <= 0) continue;
    u.hp = Math.min(1, Math.round((u.hp + rate) * 1000) / 1000);
    sim.warChanged();
  }
}

/** Mending's boost from repair trucks at home (M37): 1, and up to `RESEARCH.repairMax` with Repair crews. */
export function repairBoost(sim: Sim): number {
  const each = researchEffect(sim, 'repairMend');
  const w = sim.state.war;
  if (!each || !w) return 1;
  let trucks = 0;
  for (const u of w.units.values()) if (u.kind === 'repair' && !u.away) trucks++;
  return Math.min(RESEARCH.repairMax, 1 + each * trucks);
}

/** The battle frame for the page while a battle is on (null otherwise). */
export function battleFrameOf(sim: Sim): BattleFrame | null {
  return sim.state.war?.battle ? sim.battleFrame : null;
}
