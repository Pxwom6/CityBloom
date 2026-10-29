/**
 * Diplomacy and the stakes of war (phase 5, M36), DESIGN.md §3.30. A city at war can declare a
 * war on a computer neighbour (a warning, then the war opens), and is declared on in turn; battles
 * in a declared war move its score, and a side whose score collapses capitulates; treaties of terms
 * (ceasefire, peace, reparations, tribute, demilitarised zones, occupied districts, pacts,
 * embargoes) are proposed, countered and signed; a total war is won by holding the other side's
 * seat of power until the city falls, and a fallen city plays on as a vassal until it rebels.
 * Computer neighbours weigh, answer and propose by their character, their feelings and the city's
 * reputation. Everything here lives in `WarState.diplomacy`, which appears with the first
 * declaration, proposal or stance: peace, and a war city that never uses it, are unchanged.
 */
import { freshIncident, grieved } from './intel';
import {
  cleanTerm,
  DIPLOMACY,
  DIPLOMATS,
  QUARTERS,
  TERM_KINDS,
  TERM_NAMES,
  termProblem,
  WAR_REASONS,
  type DeclaredScale,
  type Party,
  type Term,
  type TermKind,
} from '../../data/diplomacy';
import { RAIDS } from '../../data/battle';
import { INVEST, WAR_AID } from '../../data/warEconomy';
import { PERSONALITY, type WarScale } from '../../data/war';
import { CIVIC } from '../../data/civic';
import { MAP_SIZE } from '../../data/world';
import { fail, ok, type CommandErr, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import { Rng, type RngState } from '../rng';
import type { Sim } from '../sim';
import { dateOf, START_TICK_OFFSET, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../time';
import { accrue, districtReports } from './economy';
import { turnBack } from './expeditions';
import { cityStrength, type BattleReport } from './raids';
import type { Neighbour } from './region';
import { raidThreat } from './war';
import { aidEffect, endArmsDeals, forgetEconomy, sanctionsOnBreak, seizeStakes } from './warEconomy';
import type { Outcome } from '../battle/types';

/** A declared war with one neighbour. */
export interface War {
  id: number;
  with: number;
  name: string;
  scale: DeclaredScale;
  /** Who declared it. */
  by: Party;
  reason: string;
  /** Ticks: declared, and when it opens (the warning's end). */
  declared: number;
  opens: number;
  /** Told the city it has opened. */
  opened?: true;
  /** −100 to 100, from this city's side. */
  score: number;
  battles: number;
  /** Total war: one side holds the other's seat of power (its military HQ), since this tick. */
  hold?: { by: Party; since: number };
  /** A side capitulated; the winner sets terms by `until` (then the defaults stand). */
  capitulated?: { by: Party; until: number };
  /** A vassal's rising against its overlord. */
  rebellion?: true;
}

/** A term in force, from a signed treaty. */
export interface Pact {
  id: number;
  with: number;
  term: Term;
  /** Tick it took effect (tribute: the start of the first month it's paid for). */
  since: number;
  /** Tick it ends (ceasefire, demilitarised zone, non-aggression), if it does. */
  until?: number;
  /** Tribute: months still to pay, and paid so far. */
  left?: number;
  paid?: number;
  /** An occupied district: its taxes a month (fixed when occupied) and its name. */
  amount?: number;
  label?: string;
  imposed?: true;
}

export interface Proposal {
  id: number;
  with: number;
  from: Party;
  terms: Term[];
  made: number;
  expires: number;
  /** The proposal this one answers with other terms. */
  counters?: number;
  /** A computer neighbour answers a proposal from the city at this tick. */
  answerAt?: number;
}

export interface DiplomacyEntry {
  tick: number;
  with: number;
  text: string;
}

export interface Diplomacy {
  /** 0–100: how far other cities trust the city's word. */
  reputation: number;
  wars: War[];
  pacts: Pact[];
  proposals: Proposal[];
  /** What happened, newest last. */
  log: DiplomacyEntry[];
  /** The city is a vassal of this neighbour (it fell, or it hasn't yet won its freedom). */
  vassal?: { overlord: number; since: number };
  /** The city fell, for the page's choice (play on as a vassal, or start again). */
  fell?: { by: number; name: string; at: number };
  /** A neutral stance, and the tick leaving it counts from. */
  neutral?: { since: number };
  leaving?: number;
  /** When the last war with each neighbour ended (ticks). */
  ended?: Record<number, number>;
  /** Diplomacy's own dice, apart from the war's. */
  rng: RngState;
}

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
const LOG_KEEP = 40;
/** Pacts a strike or a declaration breaks. */
const BINDING: readonly TermKind[] = ['ceasefire', 'nonAggression', 'alliance', 'defensivePact'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const money = (v: number) => `$${formatInt(Math.round(v))}`;

function neighbourOf(sim: Sim, id: number): Neighbour | undefined {
  return sim.state.region.neighbours.find((n) => n.id === id);
}

/** The largest war the city may fight: the region's rules, or total war in a city founded with rivals. */
export function warScaleAllowed(sim: Sim): WarScale | null {
  const s = sim.state;
  if (!s.war) return null;
  const rules = s.region.rules;
  if (rules) return rules.war ? rules.scale : null;
  return s.options.rivals ? 'total' : null;
}

/** The city's diplomacy, made on first use (never in a dry run). */
function dip(sim: Sim): Diplomacy {
  const w = sim.state.war!;
  return (w.diplomacy ??= {
    reputation: DIPLOMACY.reputation.start,
    wars: [],
    pacts: [],
    proposals: [],
    log: [],
    rng: Rng.fromSeed(`${sim.state.options.seed}:diplomacy`).getState(),
  });
}

/** Something happened: logged, and a notice (`tone` good or bad for the city, else news). */
export function note(
  sim: Sim,
  withId: number,
  what: string,
  text: string,
  tone?: 'good' | 'bad',
  extra?: Record<string, number | string>,
): void {
  const d = dip(sim);
  d.log.push({ tick: sim.state.tick, with: withId, text });
  if (d.log.length > LOG_KEEP) d.log.splice(0, d.log.length - LOG_KEEP);
  sim.events.push({
    kind: 'diplomacy',
    id: withId,
    info: { what, text, ...(tone ? { tone } : {}), ...(extra ?? {}) },
  });
  sim.warChanged();
}

/**
 * An incident with a computer neighbour (M37: a blackout, a spy caught): its feelings and its allies'
 * change, and the log and a notice say what happened.
 */
export function incident(
  sim: Sim,
  n: Neighbour,
  relation: number,
  allies: number,
  what: string,
  text: string,
  tone?: 'good' | 'bad',
): void {
  if (n.rival) n.rival.relation = clamp(n.rival.relation + relation, -100, 100);
  if (allies)
    for (const a of alliesOf(sim, n)) a.rival!.relation = clamp(a.rival!.relation + allies, -100, 100);
  note(sim, n.id, what, text, tone);
}

/** The city's reputation moves (M37: a spy of the city's caught). */
export function reputationChange(sim: Sim, delta: number): void {
  const d = dip(sim);
  d.reputation = clamp(d.reputation + delta, 0, 100);
  sim.warChanged();
}

/**
 * A computer neighbour ends its pacts of these kinds with the city (M37: honourable and cautious
 * ones, over a spy caught): not a breach of the city's, so its word counts as before.
 */
export function endPactsWith(sim: Sim, n: Neighbour, kinds: TermKind[], text: string): void {
  const d = dip(sim);
  const had = d.pacts.filter((p) => p.with === n.id && kinds.includes(p.term.k));
  if (!had.length) return;
  d.pacts = d.pacts.filter((p) => !had.includes(p));
  note(sim, n.id, 'pactsEnded', text, 'bad');
}

/** Spies in a declared war (M37): a sabotage that worked, or a spy caught, moves the score. */
export function scoreIntel(sim: Sim, withId: number, delta: number): void {
  // Only while the two are fighting: a ceasefire holds the score.
  const war = fightingWith(sim, withId);
  if (!war || sim.state.tick < war.opens || war.capitulated) return;
  war.score = clamp(round1(war.score + delta), -100, 100);
  checkCapitulation(sim, war);
  sim.warChanged();
}

export function warWith(sim: Sim, id: number): War | undefined {
  return sim.state.war?.diplomacy?.wars.find((x) => x.with === id);
}

export function pactsWith(sim: Sim, id: number, kind?: TermKind): Pact[] {
  const d = sim.state.war?.diplomacy;
  if (!d) return [];
  return d.pacts.filter((p) => p.with === id && (!kind || p.term.k === kind));
}

/** Pacts with this neighbour that a strike or a declaration would break. */
export function bindingPacts(sim: Sim, id: number): Pact[] {
  return pactsWith(sim, id).filter((p) => BINDING.includes(p.term.k));
}

/** An open war with this neighbour, not paused by a ceasefire or a capitulation. */
export function fightingWith(sim: Sim, id: number): War | undefined {
  const war = warWith(sim, id);
  if (!war || sim.state.tick < war.opens || war.capitulated) return undefined;
  return pactsWith(sim, id, 'ceasefire').length ? undefined : war;
}

/** A computer neighbour's taxes a month (its means, for money terms). */
export function neighbourTaxes(n: Neighbour): number {
  return Math.round(n.population * DIPLOMACY.neighbourTaxPerResident);
}

/** The city's taxes a month: last month's, or this month's so far in its first. */
export function monthlyTaxes(sim: Sim): number {
  const e = sim.state.economy;
  const lines = e.history.at(-1)?.lines ?? e.month;
  let t = 0;
  for (const [k, v] of Object.entries(lines)) if (k.startsWith('tax')) t += v;
  return Math.max(0, Math.round(t));
}

/** Computer neighbours allied with this one. */
function alliesOf(sim: Sim, n: Neighbour): Neighbour[] {
  const ids = n.rival?.allies ?? [];
  return sim.state.region.neighbours.filter((x) => ids.includes(x.id) && x.rival && !x.player);
}

/** A neighbour's strength in all: forces and defences. */
function rivalStrength(n: Neighbour): number {
  return (n.rival?.forces ?? 0) + (n.rival?.defences ?? 0);
}

// ----- Declaring war -----

/** Why the city can't declare war on this neighbour (a refusal that says when a pact is in the way). */
export function declareRefusal(
  sim: Sim,
  to: number,
  scale: DeclaredScale,
  reason: string,
  breakPact: boolean,
): CommandErr | null {
  const s = sim.state;
  if (!s.war) return fail('War is off in this city');
  const allowed = warScaleAllowed(sim);
  if (!allowed) return fail('Your region’s rules don’t allow war');
  if (allowed === 'skirmish') return fail('Your region’s rules allow skirmishes only');
  if (scale === 'total' && allowed !== 'total') return fail('Your region’s rules don’t allow total war');
  if (reason.length > DIPLOMACY.reasonMax) return fail('That reason is too long');
  const n = neighbourOf(sim, to);
  if (!n) return fail('No such neighbour');
  if (n.player) return fail('War with a friend is declared in a shared region at war (M39)');
  if (!n.rival) return fail(`${n.name} isn’t a rival`);
  const d = s.war.diplomacy;
  if (d?.wars.some((x) => x.with === to)) return fail(`The city is at war with ${n.name} already`);
  if (n.rival.vassal) return fail(`${n.name} is your vassal`);
  if (d?.vassal) {
    if (d.vassal.overlord !== to)
      return fail('A vassal can’t go to war, except to rise against its overlord');
    if (scale !== 'total') return fail('A rising against an overlord is a total war');
    const need = rivalStrength(n) * DIPLOMACY.vassal.rebelRatio;
    if (cityStrength(sim) < need)
      return fail(`To rise against ${n.name} the city needs ${formatInt(Math.ceil(need))} strength`);
  }
  if (d?.neutral) return fail('A neutral city doesn’t go to war');
  if (d?.leaving !== undefined && s.tick < d.leaving)
    return fail(`Leaving neutrality counts in ${Math.ceil((d.leaving - s.tick) / H)} hours`);
  const ended = d?.ended?.[to];
  if (ended !== undefined && s.tick - ended < DIPLOMACY.cooldownMonths * M)
    return fail(
      `The last war with ${n.name} ended too recently (${Math.ceil((ended + DIPLOMACY.cooldownMonths * M - s.tick) / H)} hours to wait)`,
    );
  const bound = bindingPacts(sim, to);
  if (bound.length && !breakPact)
    return fail(`That breaks your ${TERM_NAMES[bound[0]!.term.k].toLowerCase()} with ${n.name}`, {
      info: { breaks: true },
    });
  return null;
}

export function declareWar(
  sim: Sim,
  to: number,
  scale: DeclaredScale,
  reason: string,
  breakPact: boolean,
  dryRun: boolean,
): CommandResult {
  const why = declareRefusal(sim, to, scale, reason.trim(), breakPact);
  if (why) return why;
  if (dryRun) return ok(0);
  const n = neighbourOf(sim, to)!;
  const d = dip(sim);
  const rebellion = d.vassal?.overlord === to;
  const bound = bindingPacts(sim, to);
  if (bound.length) breakPacts(sim, n, bound);
  startWarWith(sim, n, scale, 'us', reason.trim() || 'No reason given', rebellion);
  return ok(0);
}

/** A war begins (declared by either side): it opens after the warning. */
function startWarWith(
  sim: Sim,
  n: Neighbour,
  scale: DeclaredScale,
  by: Party,
  reason: string,
  rebellion = false,
): War {
  const s = sim.state;
  const d = dip(sim);
  const r = n.rival!;
  if (by === 'us') {
    // Struck first by its raid, or (M37) its spy caught here lately: a declaration costs no reputation.
    const struckUs =
      s.tick - (s.war!.raided?.by[n.id] ?? -Infinity) < RAIDS.retaliate * M || grieved(sim, n.id);
    if (!struckUs && !rebellion) d.reputation = clamp(d.reputation + DIPLOMACY.reputation.declare, 0, 100);
    r.relation = clamp(r.relation + DIPLOMACY.declareRelation, -100, 100);
    for (const a of alliesOf(sim, n))
      a.rival!.relation = clamp(a.rival!.relation + DIPLOMACY.allyDeclareRelation, -100, 100);
  }
  const war: War = {
    id: s.nextId++,
    with: n.id,
    name: n.name,
    scale,
    by,
    reason: reason.slice(0, DIPLOMACY.reasonMax),
    declared: s.tick,
    opens: s.tick + DIPLOMACY.warningHours * H,
    score: 0,
    battles: 0,
    ...(rebellion ? { rebellion: true as const } : {}),
  };
  d.wars.push(war);
  // What was on the table lapses: a war starts afresh.
  d.proposals = d.proposals.filter((p) => p.with !== n.id);
  const what = scale === 'total' ? 'total war' : 'war';
  if (by === 'us')
    note(
      sim,
      n.id,
      rebellion ? 'rebellion' : 'declared',
      rebellion
        ? `The city rises against ${n.name}: a total war opens in ${DIPLOMACY.warningHours} hours`
        : `The city declares ${what} on ${n.name}: it opens in ${DIPLOMACY.warningHours} hours`,
    );
  else {
    note(
      sim,
      n.id,
      'declaredOn',
      `${n.name} declares ${what} on the city: “${war.reason}”. It opens in ${DIPLOMACY.warningHours} hours`,
      'bad',
    );
    // A treacherous neighbour strikes first and keeps the city's stake in its industry (M38).
    if (INVEST.seizes[r.personality]) seizeStakes(sim, n, 'as it declares war on the city');
    // Attacked, a neutral city is neutral no more: it may answer at once.
    if (d.neutral || d.leaving !== undefined) {
      delete d.neutral;
      delete d.leaving;
      note(sim, 0, 'notNeutral', 'Attacked, the city is neutral no more');
    }
  }
  // A neighbour attacked: its allies true to their word come to its side.
  if (by === 'us')
    for (const a of alliesOf(sim, n))
      if (PERSONALITY[a.rival!.personality].keepsPacts >= 0.8) joinAgainst(sim, a, n);
  return war;
}

/** A computer neighbour comes into a war against the city on another's side. */
function joinAgainst(sim: Sim, a: Neighbour, friend: Neighbour): void {
  if (warWith(sim, a.id) || a.rival?.vassal || sim.state.war?.diplomacy?.vassal?.overlord === a.id) return;
  // True to its word to both sides: a neighbour with a pact with the city stays out.
  if (bindingPacts(sim, a.id).length) return;
  if (!warScaleAllowed(sim) || warScaleAllowed(sim) === 'skirmish') return;
  startWarWith(sim, a, 'war', 'them', `We stand by ${friend.name}`);
}

/** The city breaks pacts: its reputation, the victim's feelings and its allies'. */
function breakPacts(sim: Sim, n: Neighbour, pacts: Pact[]): void {
  const d = dip(sim);
  d.reputation = clamp(d.reputation + DIPLOMACY.reputation.breakPact, 0, 100);
  d.pacts = d.pacts.filter((p) => !pacts.includes(p));
  if (n.rival) n.rival.relation = clamp(n.rival.relation + DIPLOMACY.declareRelation, -100, 100);
  const names = [...new Set(pacts.map((p) => TERM_NAMES[p.term.k].toLowerCase()))].join(' and ');
  note(sim, n.id, 'broken', `The city broke its ${names} with ${n.name}: its word counts for less`);
  for (const a of alliesOf(sim, n)) {
    a.rival!.relation = clamp(a.rival!.relation + DIPLOMACY.alliesRelation, -100, 100);
    const had = d.pacts.filter((p) => p.with === a.id && p.term.k !== 'occupy');
    if (had.length) {
      d.pacts = d.pacts.filter((p) => !had.includes(p));
      note(sim, a.id, 'pactsEnded', `${a.name}, ${n.name}’s ally, ends its pacts with the city`);
    }
    if (PERSONALITY[a.rival!.personality].keepsPacts >= 0.5) joinAgainst(sim, a, n);
  }
  // Honourable and cautious neighbours the city does business with sanction it at once (M38).
  sanctionsOnBreak(sim);
}

// ----- The war score -----

/**
 * A battle in a declared war (M36): the winner gains by how decisive it was, each side loses by the
 * buildings it lost, and a seat of power knocked down in a total war starts a hold, which a battle
 * won by its defender breaks.
 */
export function scoreBattle(
  sim: Sim,
  withId: number,
  b: {
    /** The city attacked (an expedition). */
    ours: boolean;
    outcome: Outcome | null;
    /** 0–1: objectives down (an attacker's win), or attackers knocked out (a defender's). */
    decisive: number;
    /** Buildings knocked down or wrecked on each side ($). */
    theirWorth: number;
    ourWorth: number;
    /** The defender's seat of power fell. */
    seatDown: boolean;
    /** The defender was away (a friend's battle kept for them): no hold starts. */
    away?: boolean;
  },
): void {
  const war = warWith(sim, withId);
  if (!war || sim.state.tick < war.opens || war.capitulated) return;
  const nb = neighbourOf(sim, withId);
  if (!nb?.rival || nb.player) return;
  const S = DIPLOMACY.score;
  const weWon = b.ours ? b.outcome === 'raided' : b.outcome !== 'raided';
  const pts = S.battleMin + (S.battleMax - S.battleMin) * clamp(b.decisive, 0, 1);
  const delta = (weWon ? pts : -pts) + b.theirWorth / S.damagePer - b.ourWorth / S.damagePer;
  war.score = clamp(round1(war.score + delta), -100, 100);
  war.battles++;
  const n = neighbourOf(sim, withId);
  if (war.hold && (war.hold.by === 'us') !== weWon) {
    const by = war.hold.by;
    delete war.hold;
    note(
      sim,
      withId,
      'holdBroken',
      by === 'us'
        ? `${war.name} wins a battle and takes back its seat of power`
        : `The city wins a battle and takes back its HQ from ${war.name}`,
      by === 'us' ? 'bad' : 'good',
    );
  }
  if (war.scale === 'total' && b.seatDown && !war.hold && !b.away) {
    const by: Party = b.ours ? 'us' : 'them';
    war.hold = { by, since: sim.state.tick };
    note(
      sim,
      withId,
      'hold',
      by === 'us'
        ? `The city’s forces hold ${war.name}’s seat of power: in ${DIPLOMACY.conquestHours} hours ${war.name} falls`
        : `${war.name} holds the city’s HQ: win a battle within ${DIPLOMACY.conquestHours} hours or the city falls`,
      by === 'us' ? 'good' : 'bad',
    );
  }
  if (n) checkCapitulation(sim, war);
  sim.warChanged();
}

/** What a home battle's report means for the score. */
export function scoreHomeBattle(
  sim: Sim,
  from: number,
  report: BattleReport,
  aimed: number,
  down: number,
  hurt = false,
): void {
  if (!warWith(sim, from)) return;
  // Nothing to strike (the target wasn't there), or no contact at all (no unit of either side
  // hurt, nothing hit): no battle to score.
  const contact =
    hurt ||
    report.theirLost > 0 ||
    Object.values(report.lost).some((v) => (v ?? 0) > 0) ||
    (report.worth ?? 0) > 0 ||
    report.burning.length > 0 ||
    report.civics.length > 0;
  if (aimed === 0 || (report.outcome === 'withdrew' && !contact)) return;
  const won = report.outcome !== 'raided';
  const decisive = won
    ? report.theirTotal
      ? report.theirLost / report.theirTotal
      : 1
    : aimed
      ? down / aimed
      : 0;
  const seatDown =
    report.target === 'cityhall' && report.civics.some((c) => c.wrecked && !!CIVIC.get(c.def)?.military?.hq);
  scoreBattle(sim, from, {
    ours: false,
    outcome: report.outcome,
    decisive,
    theirWorth: 0,
    ourWorth: report.worth ?? 0,
    seatDown,
  });
}

/** What an expedition's report means for the score. */
export function scoreAwayBattle(
  sim: Sim,
  to: number,
  report: BattleReport,
  sent: number,
  hurt = false,
): void {
  if (!warWith(sim, to) || !report.away) return;
  const won = report.outcome === 'raided';
  const lost = Object.values(report.lost).reduce((a, v) => a + (v ?? 0), 0);
  const o = report.away.objectives;
  // Nothing there to strike, or no contact at all (no unit of either side hurt, nothing hit): no
  // battle to score.
  const contact =
    hurt ||
    lost > 0 ||
    report.theirLost > 0 ||
    report.away.destroyed > 0 ||
    report.away.damaged > 0 ||
    o.down > 0;
  if (o.aimed === 0 || (report.outcome === 'withdrew' && !contact)) return;
  scoreBattle(sim, to, {
    ours: true,
    outcome: report.outcome,
    decisive: won ? (o.aimed ? o.down / o.aimed : 0) : sent ? lost / sent : 1,
    theirWorth: report.away.destroyed * DIPLOMACY.score.awayBuilding,
    ourWorth: 0,
    seatDown: report.target === 'cityhall' && won && o.down > 0,
  });
}

function checkCapitulation(sim: Sim, war: War): void {
  // A seat of power held is settled by the hold, not the score.
  if (war.capitulated || war.hold) return;
  if (war.score <= DIPLOMACY.score.capitulate) capitulate(sim, war, 'us');
  else if (war.score >= -DIPLOMACY.score.capitulate) capitulate(sim, war, 'them');
}

/** A side gives up: no more battles; the winner's terms stand without the loser's consent. */
function capitulate(sim: Sim, war: War, by: Party): void {
  const s = sim.state;
  const n = neighbourOf(sim, war.with);
  if (!n?.rival || n.player) return;
  war.capitulated = { by, until: s.tick + DIPLOMACY.termsDays * M };
  stopFighting(sim, n.id);
  if (by === 'us') {
    note(sim, n.id, 'capitulated', `The city capitulates to ${n.name}`, 'bad');
    // The winner keeps the city's stake in its industry (M38).
    seizeStakes(sim, n, 'when the city capitulates');
    sign(sim, n, imposedTerms(sim, n), true);
  } else
    note(
      sim,
      n.id,
      'theyCapitulate',
      `${n.name} capitulates: set your terms within ${DIPLOMACY.termsDays} days, or the usual terms stand`,
      'good',
    );
}

/** Raids from this neighbour turn back, and the city's forces on their way there come home. */
function stopFighting(sim: Sim, id: number): void {
  const w = sim.state.war!;
  if (w.incoming) {
    w.incoming = w.incoming.filter((r) => r.from !== id);
    if (!w.incoming.length) delete w.incoming;
  }
  for (const e of w.expeditions ?? []) if (e.to === id && e.state === 'out') turnBack(sim, e);
}

/** A computer neighbour's terms for a city that capitulated to it. */
/** (A rising that failed leaves the city a vassal: independence is never among them.) */
function imposedTerms(sim: Sim, n: Neighbour): Term[] {
  const s = sim.state;
  const r = n.rival!;
  const D = DIPLOMACY.defaults;
  const taxes = monthlyTaxes(sim);
  const terms: Term[] = [{ k: 'peace' }];
  const amount = Math.max(500, Math.round((taxes * D.tributeShare) / 100) * 100);
  terms.push({ k: 'tribute', payer: 'us', amount, months: D.tributeMonths });
  if ((r.personality === 'aggressive' || r.personality === 'treacherous') && s.districts.size) {
    const taken = new Set(
      sim.state.war?.diplomacy?.pacts
        .filter((p) => p.term.k === 'occupy')
        .map((p) => (p.term as { district: number }).district),
    );
    const best = districtReports(sim)
      .filter((x) => x.id && s.districts.has(x.id) && !taken.has(x.id))
      .sort((a, b) => b.taxes - a.taxes || a.id - b.id)[0];
    if (best) terms.push({ k: 'occupy', side: 'us', district: best.id });
  } else if (r.personality === 'cautious') terms.push({ k: 'dmz', side: 'us', months: 12 });
  // A vassal of the city whose rising won goes free.
  if (r.vassal) terms.push({ k: 'independence' });
  return terms;
}

/** The terms that stand when a capitulated computer neighbour's winner sets none. */
function defaultTerms(sim: Sim, n: Neighbour, war: War): Term[] {
  const terms: Term[] = [{ k: 'peace' }];
  const amount = Math.round((neighbourTaxes(n) * DIPLOMACY.defaults.reparationsMonths) / 100) * 100;
  if (amount > 0) terms.push({ k: 'reparations', payer: 'them', amount });
  // Only the city's own rising, won, sets it free; a vassal's beaten rising leaves it a vassal.
  if (war.rebellion && sim.state.war?.diplomacy?.vassal?.overlord === n.id) terms.push({ k: 'independence' });
  return terms;
}

// ----- Treaties -----

/** The same term from the other side of the table (a friend's copy, or a mirror for checks). */
export function mirrorTerm(t: Term): Term {
  const flip = (p: Party): Party => (p === 'us' ? 'them' : 'us');
  if (t.k === 'reparations' || t.k === 'tribute') return { ...t, payer: flip(t.payer) };
  if (t.k === 'dmz' || t.k === 'occupy' || t.k === 'release') return { ...t, side: flip(t.side) };
  return { ...t };
}

/** Why these terms can't be put to this neighbour now (from the city, or from it), or null. */
export function termsRefusal(sim: Sim, to: number, terms: Term[]): string | null {
  const s = sim.state;
  if (!s.war) return 'War is off in this city';
  const n = neighbourOf(sim, to);
  if (!n) return 'No such neighbour';
  if (n.player) return 'Treaties with friends come with war among friends (M39)';
  if (!n.rival) return `${n.name} isn’t a rival`;
  if (!terms.length) return 'A treaty needs terms';
  if (terms.length > DIPLOMACY.maxTerms) return `A treaty has ${DIPLOMACY.maxTerms} terms at most`;
  const d = s.war.diplomacy;
  const war = warWith(sim, to);
  const kinds = terms.map((t) => t.k);
  for (const k of TERM_KINDS)
    if (k !== 'occupy' && k !== 'release' && kinds.filter((x) => x === k).length > 1)
      return `${TERM_NAMES[k]} is listed twice`;
  const has = (k: TermKind) => pactsWith(sim, to, k);
  const theirTaxes = neighbourTaxes(n);
  const ourTaxes = monthlyTaxes(sim);
  const L = DIPLOMACY.limits;
  const peace = kinds.includes('peace');
  for (const t of terms) {
    switch (t.k) {
      case 'ceasefire':
        if (!war) return `The city isn’t at war with ${n.name}`;
        if (peace) return 'Peace and a ceasefire together make no sense';
        break;
      case 'peace':
        if (!war) return `The city isn’t at war with ${n.name}`;
        break;
      case 'reparations': {
        const cap = (t.payer === 'us' ? ourTaxes : theirTaxes) * L.reparationsMonths;
        if (t.amount > Math.max(10_000, cap))
          return `Reparations are at most ${money(Math.max(10_000, cap))}`;
        break;
      }
      case 'tribute': {
        const cap = (t.payer === 'us' ? ourTaxes : theirTaxes) * L.tributeShare;
        if (t.amount > Math.max(1_000, cap))
          return `Tribute is at most ${money(Math.max(1_000, cap))} a month`;
        break;
      }
      case 'dmz':
        if (has('dmz').some((p) => (p.term as { side: Party }).side === t.side))
          return 'That demilitarised zone is in force already';
        break;
      case 'occupy':
        if (t.side === 'us') {
          if (!s.districts.has(t.district)) return 'No such district';
        } else if (t.district > 3) return `${n.name} has three districts to occupy`;
        // A district of the city's is occupied by one neighbour at most.
        if (
          has('occupy').some((p) => sameDistrict(p.term, t)) ||
          (t.side === 'us' &&
            d?.pacts.some(
              (p) => p.term.k === 'occupy' && p.term.side === 'us' && p.term.district === t.district,
            ))
        )
          return 'That district is occupied already';
        break;
      case 'release':
        if (!has('occupy').some((p) => sameDistrict(p.term, t))) return 'That district isn’t occupied';
        break;
      case 'nonAggression':
        if (has('nonAggression').length) return `A non-aggression pact with ${n.name} is in force already`;
        if (war && !peace) return 'A non-aggression pact needs peace first';
        break;
      case 'alliance':
      case 'defensivePact':
        if (has(t.k).length) return `${TERM_NAMES[t.k]} with ${n.name} is in force already`;
        if (war && !peace) return `${TERM_NAMES[t.k]} needs peace first`;
        break;
      case 'embargo':
        if (has('embargo').length) return `${n.name} is under embargo already`;
        if (kinds.includes('trade')) return 'An embargo and trade together make no sense';
        break;
      case 'trade':
        if (!has('embargo').length) return `There’s no embargo with ${n.name}`;
        break;
      case 'independence':
        if (d?.vassal?.overlord !== to && !n.rival.vassal) return 'Neither city is the other’s vassal';
        break;
    }
  }
  return null;
}

function sameDistrict(a: Term, b: Term): boolean {
  return (
    (a.k === 'occupy' || a.k === 'release') &&
    (b.k === 'occupy' || b.k === 'release') &&
    a.side === b.side &&
    a.district === b.district
  );
}

/** Terms put into effect. */
function sign(sim: Sim, n: Neighbour, terms: Term[], imposed: boolean): void {
  const s = sim.state;
  const d = dip(sim);
  const pact = (term: Term, extra: Partial<Pact> = {}) =>
    d.pacts.push({
      id: s.nextId++,
      with: n.id,
      term,
      since: s.tick,
      ...extra,
      ...(imposed ? { imposed: true } : {}),
    });
  const nextMonth = (dateOf(s.tick).totalMonths + 1) * M - START_TICK_OFFSET;
  // Terms imposed on the city (it capitulated) are bad news; any others, good.
  const lost = imposed && warWith(sim, n.id)?.capitulated?.by === 'us';
  const said: string[] = [];
  for (const t of terms) {
    said.push(termText(sim, n, t));
    switch (t.k) {
      case 'peace':
        endWar(sim, n.id);
        break;
      case 'ceasefire':
        pact(t, { until: s.tick + t.hours * H });
        stopFighting(sim, n.id);
        break;
      case 'reparations':
        accrue(
          sim,
          t.payer === 'us' ? 'reparationsOut' : 'reparationsIn',
          t.payer === 'us' ? -t.amount : t.amount,
        );
        break;
      case 'tribute':
        pact(t, { since: nextMonth, left: t.months, paid: 0 });
        break;
      case 'dmz':
        pact(t, { until: s.tick + t.months * M });
        if (t.side === 'us') sim.warChanged();
        break;
      case 'occupy': {
        if (t.side === 'us') {
          const rep = districtReports(sim).find((x) => x.id === t.district);
          pact(t, {
            since: nextMonth,
            amount: Math.max(100, Math.round(rep?.taxes ?? 0)),
            label: s.districts.get(t.district)?.name ?? 'A district',
          });
        } else
          pact(t, {
            since: nextMonth,
            amount: Math.max(100, Math.round((neighbourTaxes(n) * 0.15) / 10) * 10),
            label: quarterName(n, t.district),
          });
        break;
      }
      case 'release':
        d.pacts = d.pacts.filter((p) => !(p.with === n.id && sameDistrict(p.term, t)));
        break;
      case 'nonAggression':
        pact(t, { until: s.tick + t.months * M });
        break;
      case 'alliance':
      case 'defensivePact':
        pact(t);
        break;
      case 'embargo':
        pact(t);
        s.region.deals = s.region.deals.filter((x) => x.neighbour !== n.id);
        endArmsDeals(sim, n, 'an embargo is signed');
        break;
      case 'trade':
        d.pacts = d.pacts.filter((p) => !(p.with === n.id && p.term.k === 'embargo'));
        break;
      case 'independence':
        if (d.vassal?.overlord === n.id) {
          delete d.vassal;
          delete d.fell;
        }
        if (n.rival?.vassal) delete n.rival.vassal;
        break;
    }
  }
  d.proposals = d.proposals.filter((p) => p.with !== n.id);
  // Peace with an overlord the city stays a vassal of ends its allies' wars on the city too.
  if (terms.some((t) => t.k === 'peace') && d.vassal?.overlord === n.id)
    for (const a of alliesOf(sim, n)) if (warWith(sim, a.id)) endWar(sim, a.id);
  if (!imposed && n.rival) n.rival.relation = clamp(n.rival.relation + 10, -100, 100);
  note(
    sim,
    n.id,
    'signed',
    `${imposed ? 'Terms imposed' : 'A treaty signed'} with ${n.name}: ${said.join('; ')}`,
    lost ? 'bad' : 'good',
  );
}

/** A war ends: the cooldown starts, and pacts that were its pauses go. */
function endWar(sim: Sim, id: number): void {
  const d = dip(sim);
  if (!d.wars.some((x) => x.with === id)) return;
  d.wars = d.wars.filter((x) => x.with !== id);
  d.pacts = d.pacts.filter((p) => !(p.with === id && p.term.k === 'ceasefire'));
  d.ended = { ...(d.ended ?? {}), [id]: sim.state.tick };
  stopFighting(sim, id);
}

/** A computer neighbour's quarter (1–3) by name. */
function quarterName(n: Neighbour, k: number): string {
  return `${n.name}’s ${QUARTERS[k] ?? 'outer'} quarter`;
}

/** A term in words, for notices and the war room. */
export function termText(sim: Sim, n: Neighbour, t: Term): string {
  const who = (p: Party) => (p === 'us' ? 'the city' : n.name);
  switch (t.k) {
    case 'ceasefire':
      return `a ceasefire for ${t.hours} hours`;
    case 'peace':
      return 'peace';
    case 'reparations':
      return `${who(t.payer)} pays ${money(t.amount)} in reparations`;
    case 'tribute':
      return `${who(t.payer)} pays ${money(t.amount)} a month for ${t.months} months`;
    case 'dmz':
      return `no forces within ${DIPLOMACY.dmz} m of the border on ${t.side === 'us' ? 'the city’s' : `${n.name}’s`} side for ${t.months} months`;
    case 'occupy':
      return t.side === 'us'
        ? `${n.name} occupies ${sim.state.districts.get(t.district)?.name ?? 'a district'}`
        : `the city occupies ${quarterName(n, t.district)}`;
    case 'release':
      return t.side === 'us'
        ? `${n.name} hands back ${sim.state.districts.get(t.district)?.name ?? 'a district'}`
        : `the city hands back ${quarterName(n, t.district)}`;
    case 'nonAggression':
      return `a non-aggression pact for ${t.months} months`;
    case 'alliance':
      return 'an alliance';
    case 'defensivePact':
      return 'a defensive pact';
    case 'embargo':
      return 'an embargo on trade';
    case 'trade':
      return 'trade resumes';
    case 'independence':
      return sim.state.war?.diplomacy?.vassal?.overlord === n.id
        ? 'the city goes free'
        : `${n.name} goes free`;
  }
}

/** Put terms to a neighbour (or, as the winner of a capitulation, set them). */
export function propose(
  sim: Sim,
  to: number,
  raw: Term[],
  counters: number | undefined,
  dryRun: boolean,
): CommandResult {
  const terms: Term[] = [];
  for (const t of raw) {
    const c = cleanTerm(t);
    if (!c) return fail(termProblem(t) ?? 'A term doesn’t make sense');
    terms.push(c);
  }
  const why = termsRefusal(sim, to, terms);
  if (why) return fail(why);
  const s = sim.state;
  const d = s.war!.diplomacy;
  if (d?.proposals.some((p) => p.with === to && p.from === 'us'))
    return fail('Wait for an answer to the last proposal');
  if (
    counters !== undefined &&
    !d?.proposals.some((p) => p.id === counters && p.with === to && p.from === 'them')
  )
    return fail('That proposal is gone');
  if (terms.some((t) => t.k === 'reparations' && t.payer === 'us' && t.amount > s.treasury))
    return fail('The city can’t pay that much now');
  if (dryRun) return ok(0);
  const n = neighbourOf(sim, to)!;
  const war = warWith(sim, to);
  if (war?.capitulated?.by === 'them') {
    // The winner sets the terms: peace always among them, and its freedom after a rising.
    if (!terms.some((t) => t.k === 'peace')) terms.unshift({ k: 'peace' });
    if (
      war.rebellion &&
      s.war!.diplomacy?.vassal?.overlord === to &&
      !terms.some((t) => t.k === 'independence')
    )
      terms.push({ k: 'independence' });
    sign(
      sim,
      n,
      terms.filter((t) => t.k !== 'ceasefire'),
      true,
    );
    return ok(0);
  }
  const dd = dip(sim);
  if (counters !== undefined) dd.proposals = dd.proposals.filter((p) => p.id !== counters);
  const p: Proposal = {
    id: s.nextId++,
    with: to,
    from: 'us',
    terms,
    made: s.tick,
    expires: s.tick + DIPLOMACY.proposalHours * H,
    answerAt: s.tick + 2 * H,
    ...(counters !== undefined ? { counters } : {}),
  };
  dd.proposals.push(p);
  sim.warChanged();
  return ok(0, { created: [p.id] });
}

/** The city answers a neighbour's proposal. */
export function answerProposal(sim: Sim, id: number, accept: boolean, dryRun: boolean): CommandResult {
  const d = sim.state.war?.diplomacy;
  const p = d?.proposals.find((x) => x.id === id);
  if (!d || !p || p.from !== 'them') return fail('That proposal is gone');
  if (accept) {
    const why = termsRefusal(sim, p.with, p.terms);
    if (why) return fail(why);
    if (p.terms.some((t) => t.k === 'reparations' && t.payer === 'us' && t.amount > sim.state.treasury))
      return fail('The city can’t pay that much now');
  }
  if (dryRun) return ok(0);
  const n = neighbourOf(sim, p.with)!;
  d.proposals = d.proposals.filter((x) => x !== p);
  if (accept) sign(sim, n, p.terms, false);
  else {
    if (n.rival) n.rival.relation = clamp(n.rival.relation - 2, -100, 100);
    note(sim, n.id, 'rejected', `The city turns down ${n.name}’s proposal`);
  }
  return ok(0);
}

export function withdrawProposal(sim: Sim, id: number, dryRun: boolean): CommandResult {
  const d = sim.state.war?.diplomacy;
  const p = d?.proposals.find((x) => x.id === id);
  if (!d || !p || p.from !== 'us') return fail('That proposal is gone');
  if (dryRun) return ok(0);
  d.proposals = d.proposals.filter((x) => x !== p);
  sim.warChanged();
  return ok(0);
}

/** Does ending this pact break the city's word? */
export function endingBreaks(sim: Sim, p: Pact): boolean {
  switch (p.term.k) {
    case 'ceasefire':
    case 'nonAggression':
    case 'embargo':
      return true;
    case 'tribute':
    case 'dmz':
      return (p.term.k === 'tribute' ? p.term.payer : p.term.side) === 'us';
    case 'alliance':
    case 'defensivePact':
      // Leaving an ally that is fighting at the city's side.
      return helpers(sim).some((h) => h.ally.id === p.with);
    default:
      return false;
  }
}

/** The city ends a pact: freely, or breaking its word (asked first). */
export function endPact(sim: Sim, id: number, breakPact: boolean, dryRun: boolean): CommandResult {
  const d = sim.state.war?.diplomacy;
  const p = d?.pacts.find((x) => x.id === id);
  if (!d || !p) return fail('No such pact');
  if (p.term.k === 'occupy' && p.term.side === 'us')
    return fail('Buy the district back, or win it back in a treaty');
  const n = neighbourOf(sim, p.with);
  if (!n) return fail('No such neighbour');
  const breaks = endingBreaks(sim, p);
  if (breaks && !breakPact)
    return fail(`Ending the ${TERM_NAMES[p.term.k].toLowerCase()} breaks the city’s word to ${n.name}`, {
      info: { breaks: true },
    });
  if (dryRun) return ok(0);
  if (breaks) breakPacts(sim, n, [p]);
  else {
    d.pacts = d.pacts.filter((x) => x !== p);
    if (n.rival)
      n.rival.relation = clamp(
        n.rival.relation + (p.term.k === 'tribute' || p.term.k === 'occupy' ? 10 : -10),
        -100,
        100,
      );
    note(sim, n.id, 'ended', `The city ends its ${TERM_NAMES[p.term.k].toLowerCase()} with ${n.name}`);
  }
  return ok(0);
}

/** Buy back an occupied district: two years of its taxes. */
export function buyBack(sim: Sim, id: number, dryRun: boolean): CommandResult {
  const d = sim.state.war?.diplomacy;
  const p = d?.pacts.find((x) => x.id === id);
  if (!d || !p || p.term.k !== 'occupy' || p.term.side !== 'us') return fail('No such occupied district');
  const cost = (p.amount ?? 0) * DIPLOMACY.buyBackMonths;
  if (sim.state.treasury < cost) return fail(`Buying it back costs ${money(cost)}`);
  if (dryRun) return ok(cost);
  accrue(sim, 'buyBack', -cost);
  d.pacts = d.pacts.filter((x) => x !== p);
  note(sim, p.with, 'boughtBack', `The city buys back ${p.label ?? 'its district'} for ${money(cost)}`);
  return ok(cost);
}

/** Go neutral, or leave neutrality (which takes a month to count). */
export function setNeutral(sim: Sim, on: boolean, dryRun: boolean): CommandResult {
  const s = sim.state;
  const w = s.war;
  if (!w) return fail('War is off in this city');
  const d = w.diplomacy;
  if (on) {
    if (d?.neutral) return fail('The city is neutral already');
    if (d?.wars.length) return fail('Make peace first: a city at war can’t be neutral');
    if (d?.vassal) return fail('A vassal can’t be neutral');
    if (w.expeditions?.some((e) => e.state !== 'back')) return fail('Call the forces home first');
    const struck = Math.max(-Infinity, ...Object.values(w.struck ?? {}));
    if (s.tick - struck < DIPLOMACY.neutral.afterStrikeMonths * M)
      return fail('The city struck a neighbour too recently to be neutral');
  } else if (!d?.neutral) return fail('The city isn’t neutral');
  if (dryRun) return ok(0);
  const dd = dip(sim);
  if (on) {
    dd.neutral = { since: s.tick };
    delete dd.leaving;
    dd.proposals = dd.proposals.filter(
      (p) => !p.terms.some((t) => t.k === 'alliance' || t.k === 'defensivePact'),
    );
    note(sim, 0, 'neutral', 'The city declares itself neutral: no wars, no raids of its own');
  } else {
    delete dd.neutral;
    dd.leaving = s.tick + DIPLOMACY.neutral.leaveMonths * M;
    note(sim, 0, 'notNeutral', 'The city leaves neutrality: in a month it may strike again');
  }
  return ok(0);
}

/** Neighbours fighting on the city's side in its wars: allies, and defensive partners against an aggressor. */
export function helpers(sim: Sim): { ally: Neighbour; war: War }[] {
  const d = sim.state.war?.diplomacy;
  if (!d) return [];
  const out: { ally: Neighbour; war: War }[] = [];
  for (const war of d.wars) {
    if (!fightingWith(sim, war.with)) continue;
    const enemy = neighbourOf(sim, war.with);
    for (const p of d.pacts) {
      if (p.with === war.with) continue;
      if (p.term.k !== 'alliance' && !(p.term.k === 'defensivePact' && war.by === 'them')) continue;
      const ally = neighbourOf(sim, p.with);
      if (!ally?.rival || warWith(sim, ally.id) || (enemy && ally.rival.allies?.includes(enemy.id))) continue;
      if (!out.some((x) => x.ally === ally && x.war === war)) out.push({ ally, war });
    }
  }
  return out;
}

// ----- Computer neighbours -----

/** How much a computer neighbour likes these terms (from its side; 0 or more, it would sign). */
export function weigh(sim: Sim, n: Neighbour, terms: Term[]): number {
  const r = n.rival!;
  const p = PERSONALITY[r.personality];
  const dp = DIPLOMATS[r.personality];
  const d = sim.state.war?.diplomacy;
  const war = warWith(sim, n.id);
  const score = war?.score ?? 0;
  const means = Math.max(1_000, neighbourTaxes(n)) * 6;
  const worth = (amount: number) => (30 * amount) / means;
  let v = 0;
  for (const t of terms) {
    switch (t.k) {
      case 'peace':
        v += (score / 2) * dp.peace + (1 - p.aggression) * 10 - 5;
        break;
      case 'ceasefire':
        v += (score / 4) * dp.peace + (1 - p.aggression) * 6;
        break;
      case 'reparations':
        v += (t.payer === 'us' ? 1 : -1.5) * dp.money * worth(t.amount);
        break;
      case 'tribute':
        v += (t.payer === 'us' ? 0.8 : -1.2) * dp.money * worth(t.amount * t.months);
        break;
      case 'dmz':
        v += t.side === 'them' ? -15 * dp.pride : 10;
        break;
      case 'occupy':
        v += t.side === 'them' ? -40 * dp.pride : 20 + 15 * p.aggression;
        break;
      case 'release':
        v += t.side === 'them' ? 30 : -25 * dp.pride;
        break;
      case 'nonAggression':
        v += r.relation / 5 + 10 * dp.pacts - 15 * p.aggression;
        break;
      case 'alliance':
        v += r.relation >= 40 ? (r.relation - 40) / 2 + 10 * dp.allies : -60;
        break;
      case 'defensivePact':
        v += r.relation >= 25 ? (r.relation - 25) / 2 + 8 * dp.allies : -50;
        break;
      case 'embargo':
        v -= 30 * dp.trade;
        break;
      case 'trade':
        v += 20 * dp.trade;
        break;
      case 'independence':
        v +=
          d?.vassal?.overlord === n.id
            ? -50 * dp.pride + (cityStrength(sim) >= rivalStrength(n) ? 30 : 0)
            : 60;
        break;
    }
  }
  return (
    v + ((d?.reputation ?? DIPLOMACY.reputation.start) - DIPLOMACY.reputation.start) / 4 + r.relation / 10
  );
}

/** Terms a computer neighbour would sign instead, or null when nothing near would do. */
function counterTerms(sim: Sim, n: Neighbour, terms: Term[]): Term[] | null {
  const tries: Term[][] = [];
  const scaled = (f: number, who: Party) =>
    terms.map((t) =>
      (t.k === 'reparations' || t.k === 'tribute') && t.payer === who
        ? { ...t, amount: Math.max(100, Math.round((t.amount * f) / 100) * 100) }
        : t,
    );
  if (terms.some((t) => (t.k === 'reparations' || t.k === 'tribute') && t.payer === 'us'))
    for (const f of [1.25, 1.5, 2, 3]) tries.push(scaled(f, 'us'));
  if (terms.some((t) => (t.k === 'reparations' || t.k === 'tribute') && t.payer === 'them'))
    for (const f of [0.75, 0.5, 0.25]) tries.push(scaled(f, 'them'));
  if (terms.length > 1) {
    // Without the term it likes least.
    let worst = -1;
    let low = Infinity;
    terms.forEach((t, k) => {
      if (t.k === 'peace' || t.k === 'ceasefire') return;
      const v = weigh(sim, n, [t]);
      if (v < low) {
        low = v;
        worst = k;
      }
    });
    if (worst >= 0) tries.push(terms.filter((_, k) => k !== worst));
  }
  if (!terms.some((t) => t.k === 'tribute') && warWith(sim, n.id)) {
    const amount = Math.max(500, Math.round((monthlyTaxes(sim) * 0.1) / 100) * 100);
    tries.push([...terms, { k: 'tribute', payer: 'us', amount, months: 12 }]);
  }
  for (const t of tries) if (!termsRefusal(sim, n.id, t) && weigh(sim, n, t) >= 0) return t;
  return null;
}

/** A computer neighbour answers the city's proposal. */
function answerFromComputer(sim: Sim, p: Proposal, rng: Rng): void {
  const d = dip(sim);
  const n = neighbourOf(sim, p.with);
  d.proposals = d.proposals.filter((x) => x !== p);
  if (!n?.rival) return;
  if (termsRefusal(sim, n.id, p.terms)) {
    note(sim, n.id, 'lapsed', `The proposal to ${n.name} no longer makes sense`);
    return;
  }
  const v = weigh(sim, n, p.terms) + rng.range(-4, 4);
  if (v >= 0) {
    sign(sim, n, p.terms, false);
    return;
  }
  const counter = v >= -25 ? counterTerms(sim, n, p.terms) : null;
  if (counter) {
    putToCity(sim, n, counter, p.id);
    note(sim, n.id, 'countered', `${n.name} answers the city’s proposal with terms of its own`);
  } else note(sim, n.id, 'refused', `${n.name} turns down the city’s proposal`);
}

/** A computer neighbour puts terms to the city. */
function putToCity(sim: Sim, n: Neighbour, terms: Term[], counters?: number): void {
  const s = sim.state;
  const d = dip(sim);
  d.proposals = d.proposals.filter((p) => !(p.with === n.id && p.from === 'them'));
  d.proposals.push({
    id: s.nextId++,
    with: n.id,
    from: 'them',
    terms,
    made: s.tick,
    expires: s.tick + DIPLOMACY.proposalHours * H,
    ...(counters !== undefined ? { counters } : {}),
  });
  sim.events.push({
    kind: 'diplomacy',
    id: n.id,
    info: { what: 'proposal', text: `${n.name} proposes a treaty` },
  });
  sim.warChanged();
}

/** Test mode: a computer neighbour puts these terms to the city (the `proposal` cheat). */
export function proposalCheat(sim: Sim, to: number, raw: Term[], dryRun: boolean): CommandResult {
  const n = neighbourOf(sim, to);
  if (!n?.rival || n.player) return fail('No such rival');
  const terms = raw.map((t) => cleanTerm(t));
  const bad = raw.find((t) => !cleanTerm(t));
  if (bad) return fail(termProblem(bad) ?? 'A term doesn’t make sense');
  const why = termsRefusal(sim, to, terms as Term[]);
  if (why) return fail(why);
  if (dryRun) return ok(0);
  putToCity(sim, n, terms as Term[]);
  return ok(0);
}

/** Test mode: the city falls to this neighbour at once, as if it had held the HQ (the `fall` cheat). */
export function fallCheat(sim: Sim, to: number, dryRun: boolean): CommandResult {
  const n = neighbourOf(sim, to);
  if (!n?.rival || n.player) return fail('No such rival');
  if (!sim.state.war) return fail('War is off in this city');
  if (dryRun) return ok(0);
  const war = warWith(sim, to) ?? startWarWith(sim, n, 'total', 'them', 'A test of arms');
  war.hold = { by: 'them', since: sim.state.tick - DIPLOMACY.conquestHours * H };
  conquer(sim, war);
  return ok(0);
}

// ----- Each hour and each month -----

/** Each hour, in the war hour: wars open, holds run, proposals are answered and lapse. */
export function diplomacyHour(sim: Sim): void {
  const d = sim.state.war?.diplomacy;
  if (!d) return;
  const s = sim.state;
  for (const war of [...d.wars]) {
    // Ended earlier in this pass (a fall ends every other war): nothing more to do with it.
    if (!d.wars.includes(war)) continue;
    if (!war.opened && s.tick >= war.opens) {
      war.opened = true;
      note(sim, war.with, 'opened', `The war with ${war.name} has begun`);
    }
    if (war.hold && pactsWith(sim, war.with, 'ceasefire').length) {
      // A ceasefire freezes the front: the hold neither runs on nor counts.
      war.hold.since += H;
    } else if (war.hold) {
      war.score = clamp(
        round1(war.score + DIPLOMACY.score.holdPerHour * (war.hold.by === 'us' ? 1 : -1)),
        -100,
        100,
      );
      if (s.tick - war.hold.since >= DIPLOMACY.conquestHours * H) conquer(sim, war);
    } else if (war.capitulated?.by === 'them' && s.tick >= war.capitulated.until) {
      const n = neighbourOf(sim, war.with);
      if (n?.rival && !n.player) sign(sim, n, defaultTerms(sim, n, war), true);
    } else if (war.opened) checkCapitulation(sim, war); // a score a broken hold left past the bar
  }
  for (const p of [...d.pacts])
    if (p.until !== undefined && s.tick >= p.until) {
      d.pacts = d.pacts.filter((x) => x !== p);
      const n = neighbourOf(sim, p.with);
      if (n)
        note(
          sim,
          n.id,
          'pactEnded',
          `The ${TERM_NAMES[p.term.k].toLowerCase()} with ${n.name} has run its course`,
        );
    }
  const rng = new Rng(d.rng);
  for (const p of [...d.proposals]) {
    if (!d.proposals.includes(p)) continue;
    if (p.from === 'us' && p.answerAt !== undefined && s.tick >= p.answerAt) answerFromComputer(sim, p, rng);
    else if (s.tick >= p.expires) {
      d.proposals = d.proposals.filter((x) => x !== p);
      sim.warChanged();
    }
  }
  d.rng = rng.getState();
}

/** A seat of power held long enough: the city falls. */
function conquer(sim: Sim, war: War): void {
  const s = sim.state;
  const d = dip(sim);
  const n = neighbourOf(sim, war.with);
  const by = war.hold!.by;
  d.wars = d.wars.filter((x) => x !== war);
  d.ended = { ...(d.ended ?? {}), [war.with]: s.tick };
  d.proposals = d.proposals.filter((p) => p.with !== war.with);
  stopFighting(sim, war.with);
  if (!n?.rival) return;
  // The fallen side's pacts with the winner end, and so do its claims on it (tribute it was owed,
  // districts it held, a demilitarised zone it imposed, an embargo).
  const loser: Party = by === 'us' ? 'them' : 'us';
  const owed = (t: Term) =>
    (t.k === 'tribute' && t.payer !== loser) ||
    ((t.k === 'occupy' || t.k === 'dmz') && t.side !== loser) ||
    t.k === 'embargo';
  d.pacts = d.pacts.filter((p) => !(p.with === n.id && (BINDING.includes(p.term.k) || owed(p.term))));
  if (by === 'us') {
    n.rival.vassal = { since: s.tick };
    n.rival.forces = round1(n.rival.forces * DIPLOMACY.vassal.forcesLeft);
    if (d.vassal?.overlord === n.id) delete d.vassal;
    delete d.fell;
    note(
      sim,
      n.id,
      'conquered',
      `${n.name} falls to the city: it is the city’s vassal now and pays a fifth of its taxes`,
      'good',
    );
  } else {
    d.vassal = { overlord: n.id, since: s.tick };
    d.fell = { by: n.id, name: n.name, at: s.tick };
    // The city's stake in the conqueror's industry is the conqueror's now (M38).
    seizeStakes(sim, n, 'as the city falls');
    delete n.rival.vassal;
    delete d.neutral;
    delete d.leaving;
    // Under its overlord's peace: every other war of the city's ends with its fall (a vassal sends
    // no forces, so it couldn't fight them).
    for (const other of [...d.wars]) endWar(sim, other.with);
    note(
      sim,
      n.id,
      'fell',
      `The city falls to ${n.name}: it is ${n.name}’s vassal and pays it a fifth of its taxes`,
      'bad',
    );
  }
}

/**
 * Each month (a game day), after the books close: tribute months counted, reputation mends,
 * computer neighbours propose, declare and rebel, allies fight at the city's side.
 */
export function diplomacyMonth(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  const s = sim.state;
  const d = w.diplomacy;
  if (d) {
    for (const p of [...d.pacts]) {
      if (p.term.k !== 'tribute' || p.since >= s.tick) continue;
      p.paid = (p.paid ?? 0) + 1;
      p.left = (p.left ?? 1) - 1;
      if (p.left <= 0) {
        d.pacts = d.pacts.filter((x) => x !== p);
        const n = neighbourOf(sim, p.with);
        note(
          sim,
          p.with,
          'tributeDone',
          p.term.payer === 'us'
            ? `The city has paid its tribute to ${n?.name ?? 'its neighbour'} in full`
            : `${n?.name ?? 'A neighbour'} has paid its tribute in full`,
        );
      }
    }
    if (d.reputation < DIPLOMACY.reputation.start)
      d.reputation = Math.min(DIPLOMACY.reputation.start, d.reputation + DIPLOMACY.reputation.mendPerMonth);
    // Each ally fighting at the city's side wears the enemy down.
    for (const { ally, war } of helpers(sim)) {
      if (!d.wars.includes(war)) continue;
      // An ally the city funded last month (M38) counts for up to twice as much.
      const lift = aidEffect(sim, ally.id);
      const gain = lift
        ? DIPLOMACY.score.allyPerDay * (1 + (WAR_AID.scoreFactor - 1) * lift)
        : DIPLOMACY.score.allyPerDay;
      war.score = clamp(round1(war.score + gain), -100, 100);
      const enemy = neighbourOf(sim, war.with);
      if (enemy?.rival) enemy.rival.forces = round1(enemy.rival.forces * 0.97);
      checkCapitulation(sim, war);
    }
  }
  computerMoves(sim);
}

/** Computer neighbours' own moves, once a day: proposals, declarations, risings. */
function computerMoves(sim: Sim): void {
  const s = sim.state;
  const w = s.war!;
  const allowed = warScaleAllowed(sim);
  // The neighbours' dice carry on from day to day (a war city's diplomacy starts with its first).
  if (!s.region.neighbours.some((n) => n.rival && !n.player)) return;
  const rng = new Rng(dip(sim).rng);
  const strength = Math.max(1, cityStrength(sim));
  const threat = raidThreat(sim);
  const neutral = !!w.diplomacy?.neutral;
  let declared = false;
  for (const n of s.region.neighbours) {
    const r = n.rival;
    if (!r || n.player) continue;
    const p = PERSONALITY[r.personality];
    const d = w.diplomacy;
    const war = warWith(sim, n.id);
    const pending = d?.proposals.some((x) => x.with === n.id && x.from === 'them');
    // A vassal of the city rises once its forces are strong enough (a rising takes an army). It
    // stays a vassal until the rising wins: by a hold, by the city's capitulation, or by treaty.
    if (r.vassal && !war) {
      // Not again within the cooldown after a rising ended (in peace, the vassal still a vassal).
      const ended = w.diplomacy?.ended?.[n.id];
      if (ended !== undefined && s.tick - ended < DIPLOMACY.cooldownMonths * M) continue;
      if (
        r.forces >= strength * DIPLOMACY.vassal.rebelRatio &&
        rng.chance(0.25) &&
        allowed &&
        allowed !== 'skirmish'
      )
        startWarWith(sim, n, allowed === 'total' ? 'total' : 'war', 'them', 'We will not kneel', true);
      continue;
    }
    if (war) {
      if (pending || s.tick < war.opens || war.capitulated) continue;
      const ours = monthlyTaxes(sim);
      // A rising wants its freedom: winning, it offers peace with independence, and nothing less.
      if (r.vassal) {
        if (war.score <= -30 && rng.chance(0.4)) putToCity(sim, n, [{ k: 'peace' }, { k: 'independence' }]);
        continue;
      }
      if (war.score >= 30 && rng.chance(0.5)) {
        const amount = Math.round((neighbourTaxes(n) * Math.min(6, war.score / 15)) / 100) * 100;
        putToCity(
          sim,
          n,
          amount > 0 ? [{ k: 'peace' }, { k: 'reparations', payer: 'them', amount }] : [{ k: 'peace' }],
        );
      } else if (war.score <= -30 && rng.chance(0.4)) {
        const amount = Math.max(500, Math.round((ours * 0.1) / 100) * 100);
        putToCity(sim, n, [{ k: 'peace' }, { k: 'tribute', payer: 'us', amount, months: 24 }]);
      } else if (war.score >= 15 && rng.chance(0.25)) putToCity(sim, n, [{ k: 'ceasefire', hours: 72 }]);
      continue;
    }
    if (!pending && !w.diplomacy?.vassal) {
      const pacts = pactsWith(sim, n.id);
      const has = (k: TermKind) => pacts.some((x) => x.term.k === k);
      if (
        (r.personality === 'honourable' || r.personality === 'cautious') &&
        r.relation >= 30 &&
        !has('nonAggression') &&
        rng.chance(0.15)
      )
        putToCity(sim, n, [{ k: 'nonAggression', months: 24 }]);
      else if (r.personality === 'mercantile' && has('embargo') && rng.chance(0.3))
        putToCity(sim, n, [{ k: 'trade' }]);
      else if (pacts.some((x) => x.term.k === 'occupy' && x.term.side === 'them') && rng.chance(0.1)) {
        const occ = pacts.find((x) => x.term.k === 'occupy' && x.term.side === 'them')!;
        const t = occ.term as { district: number };
        putToCity(sim, n, [
          { k: 'release', side: 'them', district: t.district },
          { k: 'reparations', payer: 'them', amount: (occ.amount ?? 0) * DIPLOMACY.buyBackMonths },
        ]);
      }
    }
    // Aggressive and treacherous neighbours declare war on a city they outgun and dislike.
    if (declared || neutral || !allowed || allowed === 'skirmish' || !threat.open || w.diplomacy?.vassal)
      continue;
    // A spy of the city's caught there within a day (M37): it declares at even strength, twice as likely.
    const caught = freshIncident(sim, n.id);
    if (p.aggression < 0.5 || r.relation > RAIDS.hostile || r.forces < (caught ? 1 : 1.5) * strength)
      continue;
    const ended = w.diplomacy?.ended?.[n.id];
    if (ended !== undefined && s.tick - ended < DIPLOMACY.cooldownMonths * M) continue;
    const bound = bindingPacts(sim, n.id);
    if (bound.length && !(r.personality === 'treacherous' && rng.chance((1 - p.keepsPacts) * 0.3))) continue;
    if (!rng.chance(p.aggression * 0.15 * (caught ? 2 : 1))) continue;
    if (bound.length) {
      const dd = dip(sim);
      dd.pacts = dd.pacts.filter((x) => !bound.includes(x));
      note(sim, n.id, 'theyBroke', `${n.name} breaks its word to the city`);
    }
    const reasons = WAR_REASONS[r.personality];
    const scale: DeclaredScale = allowed === 'total' && r.forces >= 2.5 * strength ? 'total' : 'war';
    const reason = reasons[rng.int(reasons.length)]!;
    startWarWith(sim, n, scale, 'them', caught ? 'We caught your spies in our town' : reason);
    declared = true;
  }
  dip(sim).rng = rng.getState();
}

// ----- Money and stances that other systems read -----

/** Monthly ledger lines from treaties, occupations and vassals (`taxes`: the city's this month). */
export function diplomacyRates(sim: Sim, taxes: number): Record<string, number> {
  const s = sim.state;
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => {
    if (v) out[k] = (out[k] ?? 0) + v;
  };
  const d = s.war?.diplomacy;
  for (const p of d?.pacts ?? []) {
    if (p.since > s.tick) continue;
    if (p.term.k === 'tribute')
      add(
        p.term.payer === 'us' ? 'tributeOut' : 'tributeIn',
        p.term.payer === 'us' ? -p.term.amount : p.term.amount,
      );
    else if (p.term.k === 'occupy')
      add(
        p.term.side === 'us' ? 'occupationOut' : 'occupationIn',
        p.term.side === 'us' ? -(p.amount ?? 0) : (p.amount ?? 0),
      );
  }
  // A vassal rising against its overlord pays nothing while the rising is on.
  if (d?.vassal && !d.wars.some((w) => w.with === d.vassal!.overlord))
    add('overlord', -taxes * DIPLOMACY.vassal.taxShare);
  for (const n of s.region.neighbours)
    if (n.rival?.vassal && !n.player && !d?.wars.some((w) => w.with === n.id))
      add('vassals', neighbourTaxes(n) * DIPLOMACY.vassal.taxShare);
  return out;
}

/**
 * How a computer neighbour may raid the city now (M36), or null when it won't: at war it raids
 * more often (and in a total war may go for the HQ); a pact, a capitulation or vassalage stops it;
 * a neutral city is raided a quarter as often (treacherous neighbours care nothing for that).
 */
export function raidStance(
  sim: Sim,
  n: Neighbour,
): { factor: number; gapEach: number; seat: boolean; war: boolean } | null {
  const d = sim.state.war?.diplomacy;
  const each = { factor: 1, gapEach: RAIDS.gapEach, seat: false, war: false };
  if (!d) return each;
  // A war (a rising among them) comes first; otherwise vassals and overlords keep the peace.
  const war = warWith(sim, n.id);
  if (war) {
    if (sim.state.tick < war.opens || war.capitulated || bindingPacts(sim, n.id).length) return null;
    return {
      factor: DIPLOMACY.war.raidFactor,
      gapEach: DIPLOMACY.war.gapEachMonths,
      seat: war.scale === 'total',
      war: true,
    };
  }
  if (n.rival?.vassal || d.vassal?.overlord === n.id) return null;
  if (bindingPacts(sim, n.id).length) return null;
  if (d.neutral && n.rival?.personality !== 'treacherous')
    return { ...each, factor: DIPLOMACY.neutral.raidShare };
  return each;
}

/** Any declared war open now (raids come closer together). */
export function anyWarOpen(sim: Sim): boolean {
  return !!sim.state.war?.diplomacy?.wars.some((x) => sim.state.tick >= x.opens && !x.capitulated);
}

/** Why the city can't strike this neighbour now (diplomacy's part of sending a force), or null. */
export function strikeRefusal(sim: Sim, to: number, target: string, breakPact: boolean): CommandErr | null {
  const s = sim.state;
  const d = s.war?.diplomacy;
  const n = neighbourOf(sim, to);
  if (!n) return fail('No such neighbour');
  if (d?.neutral) return fail('A neutral city doesn’t send forces');
  // A friend's city (M36): as the region room would decide it (it has the last word).
  const verdict = n.player?.raid;
  if (verdict === 'neutral') return fail(`${n.name} is neutral`);
  if (verdict === 'new') return fail(`${n.name} is too young or small to raid, unless it strikes first`);
  if (verdict === 'spent')
    return fail(`${n.name} has taken the region’s three raids for today: no more until midnight (UTC)`);
  if (verdict === 'absent')
    return fail(`${n.name}’s player isn’t here, and this region keeps nothing for them`);
  if (d?.leaving !== undefined && s.tick < d.leaving)
    return fail(`Leaving neutrality counts in ${Math.ceil((d.leaving - s.tick) / H)} hours`);
  const war = warWith(sim, to);
  if (n.rival?.vassal && !war) return fail(`${n.name} is your vassal`);
  // A vassal fights only in its rising (against its overlord, and those who came to its side).
  if (d?.vassal && !war) return fail('A vassal sends no forces, except to rise against its overlord');
  if (war && s.tick < war.opens)
    return fail(`The war with ${n.name} opens in ${Math.ceil((war.opens - s.tick) / H)} hours`);
  if (war?.capitulated?.by === 'them') return fail(`${n.name} has capitulated: set your terms`);
  if (war?.capitulated?.by === 'us') return fail(`The city capitulated to ${n.name}`);
  if (target === 'cityhall' && !(war && fightingWith(sim, to)))
    return fail('A skirmish can’t strike the seat of power: that takes a declared war');
  const bound = bindingPacts(sim, to);
  if (bound.length && !breakPact)
    return fail(`That breaks your ${TERM_NAMES[bound[0]!.term.k].toLowerCase()} with ${n.name}`, {
      info: { breaks: true },
    });
  return null;
}

/** A force sent under a pact breaks it (asked first). */
export function strikeBreaks(sim: Sim, to: number): void {
  const bound = bindingPacts(sim, to);
  const n = neighbourOf(sim, to);
  if (bound.length && n) breakPacts(sim, n, bound);
}

/**
 * A friend's city takes a computer neighbour's place in a shared region (M36): whatever the city
 * had with that neighbour ends with it (wars, pacts, proposals, vassalage), and it's no one's ally.
 */
export function forgetNeighbour(sim: Sim, id: number): void {
  const s = sim.state;
  forgetEconomy(sim, id);
  for (const n of s.region.neighbours)
    if (n.rival?.allies?.includes(id)) n.rival.allies = n.rival.allies.filter((x) => x !== id);
  const d = s.war?.diplomacy;
  if (!d) return;
  if (d.wars.some((w) => w.with === id)) endWar(sim, id);
  d.pacts = d.pacts.filter((p) => p.with !== id);
  d.proposals = d.proposals.filter((p) => p.with !== id);
  if (d.vassal?.overlord === id) delete d.vassal;
  if (d.fell?.by === id) delete d.fell;
  sim.warChanged();
}

/** Is trade with this neighbour under embargo? */
export function embargoed(sim: Sim, id: number): boolean {
  return pactsWith(sim, id, 'embargo').length > 0;
}

/** Military buildings that stand down in a demilitarised zone on the city's side. */
export function standsDown(sim: Sim, x: number, z: number): boolean {
  return standDownReason(sim, x, z) !== null;
}

/** Why a military building here stands down (a demilitarised zone on the city's side), or null. */
export function standDownReason(sim: Sim, x: number, z: number): string | null {
  const d = sim.state.war?.diplomacy;
  if (!d) return null;
  for (const p of d.pacts) {
    if (p.term.k !== 'dmz' || p.term.side !== 'us') continue;
    const n = neighbourOf(sim, p.with);
    if (n && borderDistance(n.side, x, z) <= DIPLOMACY.dmz)
      return `Stands down: the treaty with ${n.name} keeps the city’s forces ${DIPLOMACY.dmz} m from its border`;
  }
  return null;
}

function borderDistance(side: string, x: number, z: number): number {
  if (side === 'north') return z;
  if (side === 'south') return MAP_SIZE - z;
  if (side === 'east') return MAP_SIZE - x;
  return x;
}

/** A computer neighbour's DMZ halves the defences it may keep. */
export function theirDmz(sim: Sim, id: number): boolean {
  return pactsWith(sim, id, 'dmz').some((p) => p.term.k === 'dmz' && p.term.side === 'them');
}

// ----- For the war room -----

export interface DiplomacySummary {
  reputation: number;
  /** The largest war the city may declare, or null. */
  allowed: WarScale | null;
  neutral: boolean;
  /** Tick leaving neutrality counts from, while it's pending. */
  leaving: number | null;
  vassal: { overlord: number; name: string; since: number; need: number; strength: number } | null;
  fell: { by: number; name: string; at: number } | null;
  wars: {
    id: number;
    with: number;
    name: string;
    scale: DeclaredScale;
    by: Party;
    reason: string;
    declared: number;
    opens: number;
    score: number;
    battles: number;
    hold: { by: Party; since: number; falls: number } | null;
    capitulated: { by: Party; until: number } | null;
    rebellion: boolean;
    ceasefire: number | null;
    helpers: string[];
  }[];
  pacts: {
    id: number;
    with: number;
    name: string;
    term: Term;
    text: string;
    since: number;
    until: number | null;
    left: number | null;
    paid: number | null;
    amount: number | null;
    label: string | null;
    breaks: boolean;
    buyBack: number | null;
    imposed: boolean;
  }[];
  proposals: {
    id: number;
    with: number;
    name: string;
    from: Party;
    terms: Term[];
    texts: string[];
    made: number;
    expires: number;
    counters: number | null;
    answerAt: number | null;
  }[];
  neighbours: {
    id: number;
    name: string;
    personality: string;
    relation: number;
    strength: number;
    allies: string[];
    vassal: boolean;
    taxes: number;
    /** Why the city can't declare war on it now, or null. */
    declare: string | null;
    /** It may be declared on only by breaking a pact. */
    breaks: boolean;
  }[];
  log: DiplomacyEntry[];
  /** The city's taxes a month (money terms are measured against them). */
  taxes: number;
  strength: number;
}

export function diplomacySummary(sim: Sim): DiplomacySummary | null {
  const s = sim.state;
  if (!s.war) return null;
  const d = s.war.diplomacy;
  const name = (id: number) => neighbourOf(sim, id)?.name ?? 'A neighbour';
  const allowed = warScaleAllowed(sim);
  const strength = Math.round(cityStrength(sim) * 10) / 10;
  const help = helpers(sim);
  const overlord = d?.vassal ? neighbourOf(sim, d.vassal.overlord) : undefined;
  return {
    reputation: Math.round(d?.reputation ?? DIPLOMACY.reputation.start),
    allowed,
    neutral: !!d?.neutral,
    leaving: d?.leaving !== undefined && s.tick < d.leaving ? d.leaving : null,
    vassal: d?.vassal
      ? {
          overlord: d.vassal.overlord,
          name: name(d.vassal.overlord),
          since: d.vassal.since,
          need: Math.ceil((overlord ? rivalStrength(overlord) : 0) * DIPLOMACY.vassal.rebelRatio),
          strength,
        }
      : null,
    fell: d?.fell ? { ...d.fell } : null,
    wars: (d?.wars ?? []).map((w) => ({
      id: w.id,
      with: w.with,
      name: w.name,
      scale: w.scale,
      by: w.by,
      reason: w.reason,
      declared: w.declared,
      opens: w.opens,
      score: w.score,
      battles: w.battles,
      hold: w.hold ? { ...w.hold, falls: w.hold.since + DIPLOMACY.conquestHours * H } : null,
      capitulated: w.capitulated ? { ...w.capitulated } : null,
      rebellion: !!w.rebellion,
      ceasefire: pactsWith(sim, w.with, 'ceasefire')[0]?.until ?? null,
      helpers: help.filter((h) => h.war === w).map((h) => h.ally.name),
    })),
    pacts: (d?.pacts ?? []).map((p) => {
      const n = neighbourOf(sim, p.with);
      return {
        id: p.id,
        with: p.with,
        name: name(p.with),
        term: { ...p.term },
        text: n ? termText(sim, n, p.term) : TERM_NAMES[p.term.k],
        since: p.since,
        until: p.until ?? null,
        left: p.left ?? null,
        paid: p.paid ?? null,
        amount: p.amount ?? null,
        label: p.label ?? null,
        breaks: endingBreaks(sim, p),
        buyBack:
          p.term.k === 'occupy' && p.term.side === 'us' ? (p.amount ?? 0) * DIPLOMACY.buyBackMonths : null,
        imposed: !!p.imposed,
      };
    }),
    proposals: (d?.proposals ?? []).map((p) => {
      const n = neighbourOf(sim, p.with);
      return {
        id: p.id,
        with: p.with,
        name: name(p.with),
        from: p.from,
        terms: p.terms.map((t) => ({ ...t })),
        texts: n ? p.terms.map((t) => termText(sim, n, t)) : [],
        made: p.made,
        expires: p.expires,
        counters: p.counters ?? null,
        answerAt: p.answerAt ?? null,
      };
    }),
    neighbours: s.region.neighbours
      .filter((n) => n.rival && !n.player)
      .map((n) => {
        const why = declareRefusal(sim, n.id, allowed === 'total' ? 'total' : 'war', '', false);
        return {
          id: n.id,
          name: n.name,
          personality: n.rival!.personality,
          relation: Math.round(n.rival!.relation),
          strength: Math.round(rivalStrength(n) * 10) / 10,
          allies: alliesOf(sim, n).map((a) => a.name),
          vassal: !!n.rival!.vassal,
          taxes: neighbourTaxes(n),
          declare: why?.reason ?? null,
          breaks: !!why?.info?.breaks,
        };
      }),
    log: [...(d?.log ?? [])].reverse(),
    taxes: monthlyTaxes(sim),
    strength,
  };
}
