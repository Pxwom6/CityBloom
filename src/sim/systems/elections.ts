import { ELECTIONS, PROMISES, type PromiseId } from '../../data/elections';
import type { CommandResult } from '../commands';
import type { Sim } from '../sim';
import { dateOf, START_TICK_OFFSET, TICKS_PER_MONTH } from '../time';
import { BState } from '../world/buildings';
import { civicOnline } from '../world/civic';
import { ZONE_R } from '../../data/zones';
import { chronicleEvent } from './chronicle';
import { fieldAt } from './pollution';

/**
 * Elections (M17): every four game years the city votes, mostly on approval. In the six months
 * before a vote the mayor may make up to two promises, each measured against where the city stood
 * when it was made; on the day voters count promises kept and broken. Winning brings the region's
 * grant and a year's goodwill; losing never ends the game, but a hostile council blocks tax rises
 * and new loans for a year. Off in sandbox cities, and when the city was founded without them.
 */

export interface ElectionPromise {
  id: PromiseId;
  /** Tick it was made, and the measure(s) it's judged against. */
  tick: number;
  baseline: number[];
}

export interface ElectionResult {
  tick: number;
  share: number;
  won: boolean;
  approval: number;
  promises: { id: PromiseId; kept: boolean }[];
}

export interface ElectionState {
  /** Month (since the city began) of the next vote, or -1 when elections are off. */
  nextMonth: number;
  promises: ElectionPromise[];
  results: ElectionResult[];
  /** A win's goodwill or a loss's council limits, and the tick they end. */
  term: { won: boolean; until: number } | null;
}

/** Elections for a city founded (or loaded) at `tick`: off in sandbox or when switched off. */
export function newElectionState(tick: number, on: boolean): ElectionState {
  const month = dateOf(tick).totalMonths;
  return {
    nextMonth: on ? (Math.floor(month / ELECTIONS.every) + 1) * ELECTIONS.every : -1,
    promises: [],
    results: [],
    term: null,
  };
}

export function electionsOn(sim: Sim): boolean {
  return sim.state.election.nextMonth >= 0;
}

/** Months until the vote (fractional), or Infinity when elections are off. */
export function monthsToVote(sim: Sim): number {
  const e = sim.state.election;
  if (e.nextMonth < 0) return Infinity;
  return e.nextMonth - (sim.state.tick + START_TICK_OFFSET) / TICKS_PER_MONTH;
}

export function campaignOpen(sim: Sim): boolean {
  const m = monthsToVote(sim);
  return m > 0 && m <= ELECTIONS.campaign;
}

/** A term in force (a win's goodwill or a loss's limits). */
export function termNow(sim: Sim): { won: boolean; until: number } | null {
  const t = sim.state.election.term;
  return t && sim.state.tick < t.until ? t : null;
}

/** After a lost election the council blocks tax rises and new loans for a year: until when. */
export function councilUntil(sim: Sim): string | null {
  const t = termNow(sim);
  if (!t || t.won) return null;
  const d = dateOf(t.until);
  return `${MONTHS[d.month]}, Year ${d.year}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Resident-weighted crime and air pollution at homes, and the average commute (seconds). */
function measures(sim: Sim): { crime: number; air: number; commute: number } {
  const s = sim.state;
  let n = 0;
  let crime = 0;
  let air = 0;
  for (const b of s.buildings.values()) {
    if (b.zone !== ZONE_R || b.state !== BState.Active || b.pop <= 0) continue;
    n += b.pop;
    crime += fieldAt(s.crime, b.x, b.z) * b.pop;
    air += fieldAt(s.airPollution, b.x, b.z) * b.pop;
  }
  return { crime: n ? crime / n : 0, air: n ? air / n : 0, commute: sim.avgCommute() };
}

function hospitals(sim: Sim): number {
  let n = 0;
  for (const c of sim.state.civics.values()) if (c.def === 'hospital' && civicOnline(c)) n++;
  return n;
}

function taxRates(sim: Sim): number[] {
  const t = sim.state.economy.taxes;
  return [...t.R, ...t.C, ...t.I];
}

/** What a promise is measured against when it's made. */
function baseline(sim: Sim, id: PromiseId): number[] {
  const m = measures(sim);
  switch (id) {
    case 'crime':
      return [m.crime];
    case 'air':
      return [m.air];
    case 'commute':
      return [m.commute];
    case 'hospital':
      return [hospitals(sim)];
    case 'taxes':
      return taxRates(sim);
    case 'jobs':
      return [];
  }
}

/** Whether a promise is kept as things stand now. */
export function promiseKept(sim: Sim, p: ElectionPromise): boolean {
  const m = measures(sim);
  const b = p.baseline;
  switch (p.id) {
    case 'crime':
      return m.crime <= Math.max(0.001, b[0]! * ELECTIONS.crimeCut);
    case 'air':
      return m.air <= Math.max(0.001, b[0]! * ELECTIONS.airCut);
    case 'commute':
      return m.commute > 0 && m.commute <= b[0]! * ELECTIONS.commuteCut;
    case 'hospital':
      return hospitals(sim) > b[0]!;
    case 'taxes':
      return taxRates(sim).every((r, i) => r <= (b[i] ?? r));
    case 'jobs': {
      const t = sim.state.totals;
      return t.workers > 0 && t.unemployed / t.workers < ELECTIONS.maxUnemployment;
    }
  }
}

/** Vote share if the vote were held now, before the day's swing. */
export function projectedShare(sim: Sim): number {
  const e = sim.state.election;
  let share = 0.5 + (sim.state.totals.approval - ELECTIONS.neutralApproval) * ELECTIONS.perApproval;
  for (const p of e.promises) share += promiseKept(sim, p) ? ELECTIONS.kept : ELECTIONS.broken;
  return Math.min(0.95, Math.max(0.05, share));
}

/** Make or withdraw a promise (during the campaign). */
export function setPromise(sim: Sim, id: PromiseId, on: boolean, dryRun: boolean): CommandResult {
  const e = sim.state.election;
  if (!PROMISES.some((p) => p.id === id)) return { ok: false, reason: 'Unknown promise' };
  if (!electionsOn(sim)) return { ok: false, reason: 'This city has no elections' };
  if (!campaignOpen(sim))
    return { ok: false, reason: `Promises can be made in the ${ELECTIONS.campaign} months before a vote` };
  const has = e.promises.some((p) => p.id === id);
  if (on && has) return { ok: true, cost: 0 };
  if (on && e.promises.length >= ELECTIONS.maxPromises)
    return { ok: false, reason: `At most ${ELECTIONS.maxPromises} promises per election` };
  if (dryRun) return { ok: true, cost: 0 };
  if (on) e.promises.push({ id, tick: sim.state.tick, baseline: baseline(sim, id) });
  else e.promises = e.promises.filter((p) => p.id !== id);
  return { ok: true, cost: 0 };
}

/** As each month closes: open the campaign, or hold the vote. */
export function electionsMonth(sim: Sim): void {
  const s = sim.state;
  const e = s.election;
  if (e.nextMonth < 0) return;
  const month = dateOf(s.tick).totalMonths;
  if (month === e.nextMonth - ELECTIONS.campaign) sim.events.push({ kind: 'campaign', id: e.nextMonth });
  if (month < e.nextMonth) return;
  const promises = e.promises.map((p) => ({ id: p.id, kept: promiseKept(sim, p) }));
  const swing = (sim.rng.events.next() * 2 - 1) * ELECTIONS.swing;
  const share = Math.round(Math.min(0.95, Math.max(0.05, projectedShare(sim) + swing)) * 1000) / 1000;
  const won = share >= 0.5;
  e.results.push({ tick: s.tick, share, won, approval: s.totals.approval, promises });
  e.promises = [];
  e.nextMonth += ELECTIONS.every;
  e.term = { won, until: s.tick + ELECTIONS.term * TICKS_PER_MONTH };
  if (won) sim.earn(Math.round(s.totals.population * ELECTIONS.grantPerResident), 'grants');
  sim.events.push({ kind: won ? 'electionWon' : 'electionLost', id: e.results.length, info: { share } });
  chronicleEvent(sim, 'election', won ? 'won' : 'lost');
}

/** A win's goodwill on approval (0 otherwise). */
export function honeymoon(sim: Sim): number {
  const t = termNow(sim);
  return t?.won ? ELECTIONS.honeymoon : 0;
}
