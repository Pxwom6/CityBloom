/**
 * Weapons research (M37): weapons labs (faster with a research park) work through a queue of tiers
 * on the war clock; each tier is paid for when it starts. A unit a tier unlocks is a prototype until
 * it has passed a trial at the proving ground; buildings it unlocks can be placed at once. Every
 * effect is a number read here, 1 (or nothing) without research, so cities that never research play
 * exactly as before. Data in src/data/research.ts; DESIGN.md §3.31.
 */
import {
  CIVIC_TIER,
  RESEARCH,
  SPINOFFS,
  TIER,
  TIERS,
  TRIAL,
  UNIT_TIER,
  prerequisite,
  type BattleMod,
  type Branch,
  type EffectKey,
  type SpinoffId,
  type TierKey,
} from '../../data/research';
import { CIVIC } from '../../data/civic';
import { UNIT, WAR, type UnitDomain, type UnitKind } from '../../data/war';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import type { Sim } from '../sim';
import { civicOnline, type Civic } from '../world/civic';
import { accrue } from './economy';
import { openProject } from './projects';
import { hasResearchPark } from './specialisations';
import { militaryCivics, militaryOf } from './war';

/** A prototype on trial at a proving ground (war-clock hours done of `hours`). */
export interface Trial {
  ground: number;
  kind: UnitKind;
  done: number;
  hours: number;
  /** Money paid for it (what's left of it comes back if it's called off). */
  paid: number;
  /** Runs reported so far (a notice at each). */
  runs: number;
}

/** The city's weapons research (`WarState.research`): made by its first `queueResearch`. */
export interface Research {
  /** Tiers done, in the order they were finished. */
  done: TierKey[];
  /** Tiers waiting their turn; the labs work on the first. */
  queue: TierKey[];
  /** Points put into each tier so far (kept when it leaves the queue). */
  points: Partial<Record<TierKey, number>>;
  /** Tiers paid for (paid once, when each first reaches the head of the queue). */
  paid: TierKey[];
  /** Unit kinds researched but not yet tried at the proving ground, and those that passed. */
  prototypes: UnitKind[];
  proven: UnitKind[];
  /** Trials under way, one per proving ground. */
  trials: Trial[];
  /** Why the labs wait, told once until it changes (money short, no research park). */
  waiting?: string;
}

/** Research as the war room shows it (M37). */
export interface ResearchSummary {
  /** The labs' points a war-clock hour now, how many labs, and the research park's lift. */
  rate: number;
  labs: number;
  park: number;
  done: TierKey[];
  queue: TierKey[];
  points: Partial<Record<TierKey, number>>;
  paid: TierKey[];
  waiting: string | null;
  prototypes: UnitKind[];
  proven: UnitKind[];
  trials: Trial[];
  /** Superweapons allowed by the region's rules (always with computer rivals). */
  supers: boolean;
}

export function researchSummary(sim: Sim): ResearchSummary | null {
  const w = sim.state.war;
  if (!w) return null;
  const r = w.research;
  return {
    rate: Math.round(researchRate(sim) * 100) / 100,
    labs: militaryCivics(sim).filter((c) => !!militaryOf(c)!.lab && !c.build).length,
    park: parkFactor(sim),
    done: [...(r?.done ?? [])],
    queue: [...(r?.queue ?? [])],
    points: { ...(r?.points ?? {}) },
    paid: [...(r?.paid ?? [])],
    waiting: r?.waiting ?? null,
    prototypes: [...(r?.prototypes ?? [])],
    proven: [...(r?.proven ?? [])],
    trials: (r?.trials ?? []).map((t) => ({ ...t })),
    supers: superweaponsAllowed(sim),
  };
}

/** Research of a city (undefined: none yet). */
export function researchOf(sim: Sim): Research | undefined {
  return sim.state.war?.research;
}

/** Has the city done this tier? */
export function researched(sim: Sim, key: TierKey | string): boolean {
  return !!sim.state.war?.research?.done.includes(key as TierKey);
}

/** Tiers done in each branch (0–4), in the branches' order. */
export function tierCounts(sim: Sim): Record<Branch, number> {
  const out: Record<Branch, number> = { land: 0, air: 0, sea: 0, defence: 0, intel: 0, logistics: 0 };
  for (const k of sim.state.war?.research?.done ?? []) {
    const t = TIER.get(k);
    if (t) out[t.branch] = Math.max(out[t.branch], t.tier);
  }
  return out;
}

const MULTIPLY: readonly EffectKey[] = [
  'vehicleTraining',
  'aircraftTraining',
  'boatTraining',
  'droneTraining',
  'landMend',
  'travel',
  'storeCapacity',
  'stealth',
];
const ADD: readonly EffectKey[] = ['forwardReadiness', 'repairMend', 'repairSooner'];

/**
 * A number research changes: multiplied ones are 1 without research, added ones 0, and the rest
 * (a new value, like an airfield's places) `fallback` until a tier sets them. Tiers in `TIERS` order.
 */
export function researchEffect(sim: Sim, key: EffectKey, fallback = 1): number {
  const done = sim.state.war?.research?.done;
  const mul = MULTIPLY.includes(key);
  const add = ADD.includes(key);
  let v = mul ? 1 : add ? 0 : fallback;
  if (!done?.length) return v;
  for (const t of TIERS) {
    const e = t.effects?.[key];
    if (e === undefined || !done.includes(t.key)) continue;
    v = mul ? v * e : add ? v + e : e;
  }
  return v;
}

/** Battle modifiers by domain from the city's research (empty without it). */
export function researchMods(sim: Sim): Partial<Record<UnitDomain, BattleMod>> {
  const done = sim.state.war?.research?.done;
  const out: Partial<Record<UnitDomain, BattleMod>> = {};
  if (!done?.length) return out;
  for (const t of TIERS) {
    if (!t.mods || !done.includes(t.key)) continue;
    for (const [d, m] of Object.entries(t.mods) as [UnitDomain, BattleMod][]) {
      const o = (out[d] ??= {});
      if (m.hp !== undefined) o.hp = (o.hp ?? 1) * m.hp;
      if (m.attack !== undefined) o.attack = (o.attack ?? 1) * m.attack;
      if (m.armour !== undefined) o.armour = (o.armour ?? 0) + m.armour;
      if (m.evade !== undefined) o.evade = (o.evade ?? 0) + m.evade;
    }
  }
  return out;
}

/** How much more buildings stand in battle (Hardened buildings): city and military ones, the rest. */
export function hardened(sim: Sim): { civic: number; other: number } {
  let civic = 1;
  let other = 1;
  for (const k of sim.state.war?.research?.done ?? []) {
    const h = TIER.get(k)?.hardened;
    if (h) {
      civic *= h.civic;
      other *= h.other;
    }
  }
  return { civic, other };
}

/** A civilian spin-off's factor (1 until the tier that gives it is done). */
export function spinoff(sim: Sim, id: SpinoffId): number {
  const done = sim.state.war?.research?.done;
  if (!done?.length) return 1;
  for (const t of TIERS) if (t.spinoff === id && done.includes(t.key)) return SPINOFFS[id].factor;
  return 1;
}

/** Superweapons: the region's rules decide in a shared region, and a city with rivals always may. */
export function superweaponsAllowed(sim: Sim): boolean {
  const s = sim.state;
  if (!s.war) return false;
  const rules = s.region.rules;
  if (rules) return rules.war && rules.supers === true;
  return !!s.options.rivals;
}

/** The research park's lift to the labs: none, with a park in service, or with the launch complex too. */
export function parkFactor(sim: Sim): number {
  if (!hasResearchPark(sim)) return 1;
  return openProject(sim, 'launchsite') ? RESEARCH.launchFactor : RESEARCH.parkFactor;
}

/** Points a lab makes a war-clock hour (0 while it's offline, unpowered or short of staff). */
export function labRate(sim: Sim, c: Civic): number {
  const lab = militaryOf(c)?.lab;
  if (!lab || !civicOnline(c)) return 0;
  const staff = c.staff ?? 0;
  if (staff < WAR.minStaffed) return 0;
  return (
    lab.points *
    Math.min(1, staff) *
    (c.powered ?? 0) *
    Math.min(RESEARCH.fundingMax, sim.fundingEff('defence'))
  );
}

/** The labs' points a war-clock hour, with the research park's lift. */
export function researchRate(sim: Sim): number {
  let pts = 0;
  for (const c of militaryCivics(sim)) pts += labRate(sim, c);
  return pts * parkFactor(sim);
}

const plural = (kind: UnitKind) => UNIT.get(kind)?.plural ?? kind;

/**
 * Why the city can't train or keep this kind now (M37), or null: research not done, its trial not
 * passed, superweapons off by the region's rules, or one already (a superweapon is one of a kind).
 */
export function unitLock(sim: Sim, kind: UnitKind): string | null {
  const def = UNIT.get(kind);
  if (!def) return 'Unknown unit';
  const key = UNIT_TIER.get(kind);
  if (!key) return null;
  const r = sim.state.war?.research;
  if (!r?.done.includes(key)) return `${plural(kind)} need ${TIER.get(key)!.name} research`;
  if (def.super && !superweaponsAllowed(sim)) return 'Your region’s rules turn superweapons off';
  if (!r.proven.includes(kind)) return `${plural(kind)} need a trial at the proving ground first`;
  if (def.super) {
    const w = sim.state.war!;
    const has =
      [...w.units.values()].some((u) => u.kind === kind) ||
      [...w.orders.values()].some((o) => o.kind === kind);
    if (has) return `The city has a ${def.name.toLowerCase()} already`;
  }
  return null;
}

/** Why a military building can't be placed for want of research (M37), or null. */
export function civicLock(sim: Sim, defId: string): string | null {
  const key = CIVIC_TIER.get(defId);
  if (key && !researched(sim, key)) return `Needs ${TIER.get(key)!.name} research`;
  const def = CIVIC.get(defId);
  if (def?.military?.superweapon && !superweaponsAllowed(sim))
    return 'Your region’s rules turn superweapons off';
  if (def?.max !== undefined) {
    let n = 0;
    for (const c of sim.state.civics.values()) if (c.def === defId) n++;
    if (n >= def.max)
      return defId === 'militarylab'
        ? `The city runs ${def.max === 3 ? 'three' : formatInt(def.max)} weapons labs: the most it can use`
        : `The city has ${formatInt(def.max)} already`;
  }
  return null;
}

function research(sim: Sim): Research {
  const w = sim.state.war!;
  return (w.research ??= {
    done: [],
    queue: [],
    points: {},
    paid: [],
    prototypes: [],
    proven: [],
    trials: [],
  });
}

/** Why a tier can't be queued, or null. */
function queueRefusal(sim: Sim, key: TierKey): string | null {
  const s = sim.state;
  if (!s.war) return 'War is off in this city';
  const t = TIER.get(key);
  if (!t) return 'No such research';
  if (!militaryCivics(sim).some((c) => militaryOf(c)!.lab)) return 'Weapons research needs a weapons lab';
  const r = s.war.research;
  if (r?.done.includes(key)) return `${t.name} is done`;
  if (r?.queue.includes(key)) return `${t.name} is queued already`;
  const before = prerequisite(key);
  if (before && !r?.done.includes(before) && !r?.queue.includes(before))
    return `${TIER.get(before)!.name} comes first`;
  if ((r?.queue.length ?? 0) >= RESEARCH.queueMax) return `The research queue holds ${RESEARCH.queueMax}`;
  return null;
}

/** Put a tier in the research queue (paid for when the labs start on it). */
export function queueResearch(sim: Sim, key: TierKey, dryRun: boolean): CommandResult {
  const why = queueRefusal(sim, key);
  if (why) return fail(why);
  if (dryRun) return ok(0);
  research(sim).queue.push(key);
  sim.warChanged();
  return ok(0);
}

/** Take a tier out of the queue: its points stay, and so does what was paid for it. */
export function unqueueResearch(sim: Sim, key: TierKey, dryRun: boolean): CommandResult {
  const r = sim.state.war?.research;
  if (!r?.queue.includes(key)) return fail('That research isn’t queued');
  if (dryRun) return ok(0);
  // A tier queued after it that needs it goes too.
  const out = new Set<TierKey>([key]);
  for (const k of r.queue) {
    const before = prerequisite(k);
    if (before && out.has(before) && !r.done.includes(before)) out.add(k);
  }
  r.queue = r.queue.filter((k) => !out.has(k));
  sim.warChanged();
  return ok(0);
}

/** Tell the labs' reason for waiting once, until it changes. */
function waitFor(sim: Sim, r: Research, why: string | undefined): void {
  if (r.waiting === why) return;
  if (why) r.waiting = why;
  else delete r.waiting;
  if (why) sim.events.push({ kind: 'researchWaiting', id: 0, info: { text: why } });
  sim.warChanged();
}

/** Trial length (war-clock hours) and price of a unit kind's prototype. */
export function trialTerms(kind: UnitKind): { hours: number; cost: number } {
  const def = UNIT.get(kind)!;
  if (def.super) return { hours: TRIAL.superHours, cost: Math.round(def.cost * TRIAL.superShare) };
  return {
    hours: Math.max(TRIAL.minHours, Math.ceil(def.hours / 2)),
    cost: Math.round(def.cost * TRIAL.costShare),
  };
}

/** A tier is done: its units become prototypes, its buildings and operations open. */
function finish(sim: Sim, r: Research, key: TierKey): void {
  const t = TIER.get(key)!;
  r.queue = r.queue.filter((k) => k !== key);
  r.done.push(key);
  delete r.points[key];
  for (const u of t.unlocks?.units ?? []) if (!r.prototypes.includes(u)) r.prototypes.push(u);
  sim.events.push({ kind: 'researchDone', id: 0, info: { key, name: t.name } });
  if (t.spinoff) sim.events.push({ kind: 'spinoff', id: 0, info: { key, name: SPINOFFS[t.spinoff].name } });
  sim.warChanged();
}

/**
 * Research's war-clock hour (M37): the labs' points go into the head of the queue; a tier is paid
 * for when it first reaches the head (the labs wait while the treasury can't pay), and a
 * superweapon tier waits for a research park in service.
 */
export function researchHour(sim: Sim): void {
  const r = sim.state.war?.research;
  if (!r?.queue.length) return;
  const key = r.queue[0]!;
  const t = TIER.get(key);
  if (!t) {
    r.queue.shift();
    return;
  }
  if (t.park && !hasResearchPark(sim)) return waitFor(sim, r, `${t.name} needs a research park in service`);
  if (!r.paid.includes(key)) {
    if (!sim.state.options.sandbox && sim.state.treasury < t.cost)
      return waitFor(sim, r, `Not enough money to start ${t.name}: $${formatInt(t.cost)}`);
    r.paid.push(key);
    accrue(sim, 'weaponsResearch', -t.cost);
  }
  waitFor(sim, r, undefined);
  const rate = researchRate(sim);
  if (rate <= 0) return;
  const pts = Math.round(((r.points[key] ?? 0) + rate) * 1000) / 1000;
  if (pts + 1e-9 >= t.points) finish(sim, r, key);
  else {
    r.points[key] = pts;
    sim.warChanged();
  }
}
