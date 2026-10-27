/**
 * Expeditions (phase 5, M35), DESIGN.md §3.29: the city sends a force to raid a computer
 * neighbour. The force leaves by the city's edge and is away for the journey; when it arrives the
 * sim says so (`forceArrived`) and the page fights the battle in the neighbour's town (it has the
 * town; the city's sim never does) and hands back what happened as a command (`battleReport`): the
 * units knocked out are gone, the rest come home scarred, the neighbour's numbers fall and it
 * remembers. Skirmishes only in M35: military buildings, industry or power near the border.
 */
import {
  BATTLE,
  FIGHT_TIMEOUT_HOURS,
  RAIDS,
  SETTLE_TIMEOUT_HOURS,
  SKIRMISH,
  type BattleRoute,
  type BattleTarget,
  type Stance,
} from '../../data/battle';
import { UNIT, type UnitKind } from '../../data/war';
import { fail, ok, type CommandErr, type CommandResult } from '../commands';
import type { Sim } from '../sim';
import { TICKS_PER_HOUR } from '../time';
import { civicOnline } from '../world/civic';
import type { Outcome } from '../battle/types';
import { travelHours, type BattleReport } from './raids';
import { militaryCivics, militaryOf } from './war';
import { researchEffect, superweaponsAllowed } from './research';
import { formatInt } from '../dmath';
import type { Neighbour } from './region';
import { RESEARCH } from '../../data/research';
import { scoreAwayBattle, strikeBreaks, strikeRefusal } from './diplomacy';

/** A force away from the city. */
export interface Expedition {
  id: number;
  units: number[];
  /** The neighbour it's raiding (id) and its name; a friend's city's place in the region. */
  to: number;
  name: string;
  slot?: number;
  route: BattleRoute;
  target: BattleTarget;
  stance: Stance;
  /** Ticks: left, arrives, and (once fought) home again. */
  depart: number;
  arrive: number;
  home: number;
  state: 'out' | 'fighting' | 'back';
  /**
   * Its battle with a friend's city is with the region (M36): it can't be called back, and waits
   * for the region's answer (the page reports the battle once the region keeps it).
   */
  settling?: true;
  /**
   * Its battle was fought and reported, for a force with a superweapon (M37): the superweapon winds
   * up again once home, for twice as long when it was knocked out (`downed`). A force called back or
   * turned away spends none.
   */
  fought?: true;
  downed?: number[];
}

/** What the page hands back after fighting an expedition's battle. */
export interface AwayResult {
  outcome: Outcome;
  /** Our units: health after (0–1) and whether knocked out. */
  units: { id: number; hp: number; out: boolean }[];
  /** Their units knocked out (strength) of those that defended, and defences knocked out. */
  theirLost: number;
  theirStrength: number;
  defencesLost: number;
  /** Buildings knocked down and set on fire in their town, and objectives hit. */
  destroyed: number;
  damaged: number;
  objectives: { aimed: number; down: number };
  hash: string;
  /** The page's record of the battle, to watch again. */
  replay?: string;
}

const ROUTE_DOMAINS: Record<BattleRoute, readonly string[]> = {
  highway: ['land', 'air'],
  rail: ['land'],
  sea: ['sea', 'air'],
  air: ['air'],
};

const BY_ROUTE: Record<BattleRoute, string> = {
  highway: 'by road',
  rail: 'by rail',
  sea: 'by sea',
  air: 'by air',
};

/**
 * Whether a force can come from the sea (M37): a computer neighbour's resort grows on the coast; a
 * friend's city says so in its report.
 */
export function hasCoast(n: Neighbour): boolean {
  return n.player ? n.player.coast === true : n.kind === 'resort';
}

/** Why a force's superweapon (M37) can't go, or null: one a force, its own route, wound up, the rules. */
function superRefusal(sim: Sim, units: number[], n: Neighbour, route: BattleRoute): string | null {
  const w = sim.state.war!;
  const supers = units.flatMap((id) => {
    const u = w.units.get(id)!;
    const d = UNIT.get(u.kind)!;
    return d.super ? [{ u, d }] : [];
  });
  if (!supers.length) return null;
  if (!superweaponsAllowed(sim)) return 'Your region’s rules turn superweapons off';
  if (supers.length > 1) return 'A force takes one superweapon';
  const { u, d } = supers[0]!;
  const name = d.name.toLowerCase();
  if (!d.super!.routes.includes(route)) return `The ${name} goes only ${BY_ROUTE[d.super!.routes[0]!]}`;
  if (u.ready !== undefined && u.ready > w.clock)
    return `The ${name} is winding up again: ready in ${formatInt(u.ready - w.clock)} hours`;
  if (n.player && !n.player.online) return `${n.name}’s player isn’t here: superweapons wait for them`;
  return null;
}

/** Why a force can't go, or null. */
export function sendRefusal(
  sim: Sim,
  units: number[],
  to: number,
  route: BattleRoute,
  target: BattleTarget,
  breakPact = false,
): CommandErr | null {
  const why = forceRefusal(sim, units, to, route, target);
  if (why) return fail(why);
  // Diplomacy (M36): neutrality, vassals, wars not yet open, the seat of power, pacts in the way.
  return strikeRefusal(sim, to, target, breakPact);
}

function forceRefusal(
  sim: Sim,
  units: number[],
  to: number,
  route: BattleRoute,
  target: BattleTarget,
): string | null {
  const s = sim.state;
  const w = s.war;
  if (!w) return 'War is off in this city';
  if (sim.shared) return 'Sending forces from a shared city comes with war among friends';
  const n = s.region.neighbours.find((x) => x.id === to);
  if (!n) return 'No such neighbour';
  // A friend's city in a shared region (M35): only where the region's rules allow war.
  const rules = s.region.rules;
  if (n.player && !rules?.war) return 'Your region’s rules don’t allow war';
  if (!n.player && !n.rival) return `${n.name} isn’t a rival`;
  if (rules && !rules.war) return 'Your region’s rules don’t allow war';
  if (target !== 'cityhall' && !SKIRMISH.targets.includes(target))
    return 'A skirmish strikes military buildings, industry or power';
  const hq = militaryCivics(sim).find((c) => militaryOf(c)!.hq);
  if (!hq || !civicOnline(hq) || (hq.staff ?? 0) < 0.25) return 'Forces are sent from a working military HQ';
  if (!units.length) return 'Choose the units to send';
  if (units.length > BATTLE.maxAttackers) return `A raid takes ${BATTLE.maxAttackers} units at most`;
  if (new Set(units).size !== units.length) return 'A unit is listed twice';
  for (const id of units) {
    const u = w.units.get(id);
    if (!u) return 'A unit isn’t in the city’s forces';
    if (u.away) return `The ${UNIT.get(u.kind)!.name.toLowerCase()} is away already`;
    if (u.hp < 0.5) return `The ${UNIT.get(u.kind)!.name.toLowerCase()} is still being repaired`;
    const d = UNIT.get(u.kind)!;
    if (!ROUTE_DOMAINS[route].includes(d.domain))
      return route === 'air'
        ? 'Air routes are for planes, helicopters and drones'
        : route === 'sea'
          ? `${d.plural} can’t go by sea`
          : route === 'rail'
            ? `${d.plural} can’t go by rail`
            : `${d.plural} can’t go by road`;
  }
  if (units.every((x) => UNIT.get(w.units.get(x)!.kind)!.stats.attack <= 0))
    return 'A force needs units that fight';
  const sup = superRefusal(sim, units, n, route);
  if (sup) return sup;
  // By sea only to a town with a coast (M37; M35 let boats sail to any).
  if (route === 'sea' && !hasCoast(n))
    return units.some((id) => w.units.get(id)!.kind === 'clockworkwhale')
      ? `The clockwork whale needs a coast: ${n.name} has none it can reach`
      : `${n.name} has no coast to come from`;
  if (route === 'rail' && !s.railway) return 'The city has no rail link';
  if (w.expeditions?.some((e) => e.to === to && e.state !== 'back'))
    return `A force is already on its way to ${n.name}`;
  return null;
}

export function sendForce(
  sim: Sim,
  units: number[],
  to: number,
  route: BattleRoute,
  target: BattleTarget,
  stance: Stance,
  breakPact: boolean,
  dryRun: boolean,
): CommandResult {
  const why = sendRefusal(sim, units, to, route, target, breakPact);
  if (why) return why;
  if (dryRun) return ok(0);
  strikeBreaks(sim, to);
  const s = sim.state;
  const w = s.war!;
  const n = s.region.neighbours.find((x) => x.id === to)!;
  const kinds = units.map((id) => ({ kind: w.units.get(id)!.kind }));
  // Superweapons walk and fly slowly (M37): the robot and the fortress take twice as long.
  const slow = Math.max(1, ...kinds.map((k) => UNIT.get(k.kind)!.super?.travel ?? 1));
  const hours = travelHours(route, n.side, kinds, researchEffect(sim, 'travel') * slow);
  const e: Expedition = {
    id: s.nextId++,
    units: [...units],
    to,
    name: n.name,
    ...(n.player ? { slot: n.player.slot } : {}),
    route,
    target,
    stance,
    depart: s.tick,
    arrive: s.tick + hours * TICKS_PER_HOUR,
    home: 0,
    state: 'out',
  };
  for (const id of units) w.units.get(id)!.away = e.id;
  (w.expeditions ??= []).push(e);
  sim.warChanged();
  return ok(0, { created: [e.id] });
}

/**
 * Call a force back: on its way, it turns round and comes home the way it went; at its target
 * (whose battle hasn't been reported), it pulls out and comes home.
 */
export function recallForce(sim: Sim, id: number, dryRun: boolean): CommandResult {
  const w = sim.state.war;
  const e = w?.expeditions?.find((x) => x.id === id);
  if (!w || !e) return fail('No such force');
  if (e.state === 'back') return fail('The force is on its way home');
  if (e.settling) return fail('Its battle is with the region: the force comes home once the region answers');
  if (dryRun) return ok(0);
  turnBack(sim, e);
  return ok(0);
}

/**
 * The page has fought a force's battle with a friend's city and puts it to the region (M36): the
 * force is pinned until the region answers (`on`), or freed again when it turned the battle away.
 */
export function battleSettling(sim: Sim, id: number, on: boolean, dryRun: boolean): CommandResult {
  const e = sim.state.war?.expeditions?.find((x) => x.id === id);
  if (!e) return fail('No such force');
  if (on && e.state !== 'fighting') return fail('That force isn’t fighting');
  if (dryRun) return ok(0);
  if (on) e.settling = true;
  else delete e.settling;
  sim.warChanged();
  return ok(0);
}

/** A force turns for home: back as far as it came (the whole way from its target). */
export function turnBack(sim: Sim, e: Expedition): void {
  const s = sim.state;
  const out = e.state === 'out' ? s.tick - e.depart : e.arrive - e.depart;
  e.state = 'back';
  delete e.settling;
  e.home = s.tick + Math.max(TICKS_PER_HOUR, out);
  sim.warChanged();
}

/** Every tick while forces are away: arrivals (the page fights their battles) and homecomings. */
export function expeditionsTick(sim: Sim): void {
  const w = sim.state.war;
  if (!w?.expeditions?.length) return;
  const s = sim.state;
  for (const e of w.expeditions) {
    // A city shared with friends can't report a battle fought away (its page alone could): the
    // force turns back instead, everywhere alike. One that hears nothing of its battle comes home.
    if (
      (e.state === 'out' && sim.shared && s.tick >= e.arrive) ||
      (e.state === 'fighting' &&
        (sim.shared ||
          s.tick >= e.arrive + (e.settling ? SETTLE_TIMEOUT_HOURS : FIGHT_TIMEOUT_HOURS) * TICKS_PER_HOUR))
    ) {
      turnBack(sim, e);
      continue;
    }
    if (e.state === 'out' && s.tick >= e.arrive) {
      e.state = 'fighting';
      sim.events.push({
        kind: 'forceArrived',
        id: e.id,
        info: { to: e.name, neighbour: e.to, ...(e.slot ? { slot: e.slot } : {}) },
      });
      sim.warChanged();
    } else if (e.state === 'back' && s.tick >= e.home) {
      // With Repair crews (M37), a repair truck in the force mends the rest on the way home.
      const truck = e.units.some((id) => w.units.get(id)?.kind === 'repair');
      const mend = truck && researchEffect(sim, 'repairMend') > 0 ? RESEARCH.awayMend : 0;
      for (const id of e.units) {
        const u = w.units.get(id);
        if (!u) continue;
        delete u.away;
        if (mend > 0 && u.hp < 1) u.hp = Math.min(1, Math.round((u.hp + mend) * 1000) / 1000);
        // A superweapon home from a battle winds up again (M37): twice as long if it was knocked out.
        const sup = UNIT.get(u.kind)?.super;
        if (sup && e.fought) u.ready = w.clock + sup.cooldown * (e.downed?.includes(id) ? 2 : 1);
      }
      if (e.units.some((id) => w.units.has(id)))
        sim.events.push({ kind: 'forceHome', id: e.id, info: { from: e.name } });
      e.units = [];
      sim.warChanged();
    }
  }
  w.expeditions = w.expeditions.filter((e) => e.state !== 'back' || e.units.length);
  if (!w.expeditions.length) delete w.expeditions;
}

/** The page's account of an expedition's battle: losses, the neighbour's, and the way home. */
export function battleReport(sim: Sim, id: number, r: AwayResult, dryRun: boolean): CommandResult {
  const w = sim.state.war;
  const e = w?.expeditions?.find((x) => x.id === id);
  if (!w || !e) return fail('No such force');
  if (e.state !== 'fighting') return fail('That force isn’t fighting');
  if (dryRun) return ok(0);
  const s = sim.state;
  const lost: Partial<Record<UnitKind, number>> = {};
  // Whether any of the force was hurt (before its scars are taken).
  const hurt = r.units.some((u) => {
    const unit = e.units.includes(u.id) ? w.units.get(u.id) : undefined;
    return !!unit && (u.out || u.hp < unit.hp);
  });
  for (const u of r.units) {
    if (!e.units.includes(u.id)) continue;
    const unit = w.units.get(u.id);
    if (!unit) continue;
    if (u.out && UNIT.get(unit.kind)?.super) {
      // Superweapons are never lost (M37): knocked out, one is wound down and towed home.
      unit.hp = 0.05;
      (e.downed ??= []).push(u.id);
      sim.events.push({ kind: 'superTowed', id: u.id, info: { kind: unit.kind } });
    } else if (u.out) {
      lost[unit.kind] = (lost[unit.kind] ?? 0) + 1;
      w.units.delete(u.id);
      sim.events.push({ kind: 'unitLost', id: u.id, info: { kind: unit.kind } });
    } else unit.hp = Math.max(0.05, Math.min(1, Math.round(u.hp * 1000) / 1000));
  }
  const sent = e.units.length;
  e.units = e.units.filter((u) => w.units.has(u));
  const n = s.region.neighbours.find((x) => x.id === e.to);
  if (n?.rival) {
    n.rival.forces = Math.max(0, Math.round((n.rival.forces - r.theirLost) * 10) / 10);
    n.rival.defences = Math.max(0, Math.round((n.rival.defences - r.defencesLost * 3) * 10) / 10);
    n.rival.relation = Math.max(-100, n.rival.relation - RAIDS.relationHit);
  }
  // Struck: a computer neighbour may answer, and a friend's city may answer even as a newcomer.
  if (n) w.struck = { ...(w.struck ?? {}), [n.id]: s.tick };
  const report: BattleReport = {
    id: e.id,
    start: e.arrive,
    end: s.tick,
    other: e.name,
    ours: true,
    target: e.target,
    outcome: r.outcome,
    collapsed: [],
    burning: [],
    civics: [],
    craters: 0,
    lost,
    theirLost: Math.round(r.theirLost),
    theirTotal: Math.round(r.theirStrength),
    near: 0,
    sheltered: 0,
    homeless: 0,
    away: { destroyed: r.destroyed, damaged: r.damaged, objectives: r.objectives },
    ...(typeof r.replay === 'string' ? { replay: r.replay.slice(0, 60) } : {}),
  };
  w.reports = [...(w.reports ?? []), report].slice(-12);
  // In a declared war the battle moves the score, and may take the seat of power (M36).
  scoreAwayBattle(sim, e.to, report, sent, hurt);
  // A superweapon's cooldown counts from a battle fought (only such a force keeps the mark).
  if (e.units.some((id) => UNIT.get(w.units.get(id)!.kind)?.super)) e.fought = true;
  e.state = 'back';
  delete e.settling;
  e.home = s.tick + Math.max(TICKS_PER_HOUR, e.arrive - e.depart);
  if (!e.units.length) e.home = s.tick;
  sim.events.push({
    kind: 'expeditionReport',
    id: e.id,
    info: {
      to: e.name,
      outcome: r.outcome,
      lost: Object.values(lost).reduce((a, v) => a + (v ?? 0), 0),
      destroyed: r.destroyed,
      down: r.objectives.down,
    },
  });
  sim.warChanged();
  return ok(0);
}
