/**
 * A quick match in a region room (M43): the lobby, the clock, the scores, the verdict and the rematch.
 * A match region is an ordinary region (M32) with a `match` in its record: two to four cities, each
 * founded on the match's seed with the fast start, report their figures every few seconds; the room
 * keeps the clock and decides one result that every page shows. Pure logic over the record: the room
 * (`relay/region.ts`) feeds it messages and the time and sends what it returns.
 *
 * The clock is the room's: a countdown after the host's start, then the timer. Each page runs its city
 * towards the tick the time since the start allows at the match speed (never past it, and stopping at
 * the timer's last tick), so a slow phone catches up rather than falling behind, and the room counts a
 * report only if its tick is within that allowance (M37's fair clock, generalised).
 */
import { MATCH, matchScore, matchValue, type MatchFigures, type MatchSettings } from '../src/data/match';
import type { MatchReport } from '../src/sim/systems/region';
import { SPEED_TICKS_PER_SECOND } from '../src/sim/time';

export type MatchPhase = 'lobby' | 'countdown' | 'playing' | 'final' | 'over';
/** Why a match ended: the timer, a city reaching Race's target, or only one city left in it. */
export type MatchEnd = 'time' | 'race' | 'alone';

/** A city's last counted figures. */
export interface MatchFig extends MatchFigures {
  tick: number;
  /** Race: the tick it first had the target population. */
  reached?: number;
}

export interface MatchPlayer {
  slot: number;
  /** Its city is founded on this round's seed. */
  ready: boolean;
  /** It left the match (or was away when it was decided): it can't win, and is shown as left. */
  out?: true;
  fig?: MatchFig;
  /** Its last report as the match ended: the tick it stopped at and its state hash. */
  final?: { tick: number; hash?: string };
  /** The chart's values (one per `sampleMs` of the match; holes filled at the verdict). */
  samples: (number | null)[];
  /** When it last sent an emote or a line of chat (ms). */
  said?: number;
}

export interface MatchResultRow extends MatchFig {
  slot: number;
  name: string;
  mayor: string;
  color: number;
  score: number;
  hash?: string;
  out?: true;
  /** It sent its last report (with its hash) before the room decided. */
  final: boolean;
}

export interface MatchResult {
  round: number;
  settings: MatchSettings;
  endedBy: MatchEnd;
  /** The winner's slot, or 0 when nobody was left in it. */
  winner: number;
  /** Every city of the round, in finishing order (cities that left last). */
  rows: MatchResultRow[];
  /** The chart: a value every `sampleMs` of the match, per slot. */
  sampleMs: number;
  samples: Record<number, number[]>;
}

export interface MatchState {
  settings: MatchSettings;
  phase: MatchPhase;
  round: number;
  /** The room's clock (ms): when the timer starts and ends, and when the room began waiting for last reports. */
  startAt?: number;
  endsAt?: number;
  finalAt?: number;
  endedBy?: MatchEnd;
  /** A rematch: the countdown starts by itself once every city here has founded its new city. */
  auto?: true;
  players: MatchPlayer[];
  result?: MatchResult;
}

/** The match as a page sees it; times are ms from the moment the view was made (pages' clocks differ). */
export interface MatchView {
  settings: MatchSettings;
  phase: MatchPhase;
  round: number;
  startIn?: number;
  endsIn?: number;
  endedBy?: MatchEnd;
  auto?: true;
  players: { slot: number; ready: boolean; out?: true }[];
  result?: MatchResult;
}

/** One city's figures in a score line (`mscores`). */
export interface MatchRow extends MatchFig {
  slot: number;
}

/** What the room tells a city about itself (the rest of the region view carries the rest). */
export interface MatchCity {
  slot: number;
  name: string;
  mayor: string;
  color: number;
  online: boolean;
}

export function newMatch(settings: MatchSettings): MatchState {
  return { settings, phase: 'lobby', round: 1, players: [] };
}

/** The tick a match city stops at: the timer's real minutes at the match speed. */
export function matchEndTick(s: Pick<MatchSettings, 'minutes'>): number {
  return s.minutes * 60 * SPEED_TICKS_PER_SECOND[MATCH.speed];
}

/** The tick a city may have reached `elapsed` ms into the match (never past the timer's end). */
export function matchTickAt(s: Pick<MatchSettings, 'minutes'>, elapsed: number): number {
  const t = Math.floor((Math.max(0, elapsed) * SPEED_TICKS_PER_SECOND[MATCH.speed]) / 1000);
  return Math.min(matchEndTick(s), t);
}

const sampleMs = (s: MatchSettings) => (s.minutes * 60_000) / MATCH.samples;

export function playerOf(m: MatchState, slot: number): MatchPlayer {
  let p = m.players.find((x) => x.slot === slot);
  if (!p) m.players.push((p = { slot, ready: false, samples: [] }));
  return p;
}

/** Players still in the match (in a lobby, every player here). */
export const inPlay = (m: MatchState) => m.players.filter((p) => !p.out);

export function matchView(m: MatchState, now: number): MatchView {
  return {
    settings: { ...m.settings },
    phase: m.phase,
    round: m.round,
    ...(m.startAt !== undefined ? { startIn: m.startAt - now } : {}),
    ...(m.endsAt !== undefined ? { endsIn: m.endsAt - now } : {}),
    ...(m.endedBy ? { endedBy: m.endedBy } : {}),
    ...(m.auto ? { auto: true as const } : {}),
    players: m.players.map((p) => ({
      slot: p.slot,
      ready: p.ready,
      ...(p.out ? { out: true as const } : {}),
    })),
    ...(m.result ? { result: m.result } : {}),
  };
}

/** The score line every page draws its scoreboard from. */
export function matchRows(m: MatchState): MatchRow[] {
  return m.players.filter((p) => p.fig).map((p) => ({ slot: p.slot, ...p.fig! }));
}

/**
 * Why the host can't start now, or null. Every city here must have founded its city on the match's
 * seed (one still founding holds the start a moment), and two at least.
 */
export function startRefusal(m: MatchState, online: (slot: number) => boolean): string | null {
  if (m.phase !== 'lobby') return 'The match has already started';
  const here = m.players.filter((p) => online(p.slot));
  if (here.some((p) => !p.ready)) return 'A player is still founding their city';
  if (here.length < MATCH.minPlayers) return `A match needs ${MATCH.minPlayers} players at least`;
  return null;
}

/**
 * The countdown starts: players not here (or still founding) are out, and the clock is set. With
 * `auto` (a rematch), the room calls this itself once every city here is ready.
 */
export function startMatch(m: MatchState, now: number, online: (slot: number) => boolean): void {
  for (const p of m.players) if (!online(p.slot) || !p.ready) p.out = true;
  m.phase = 'countdown';
  delete m.auto;
  m.startAt = now + MATCH.countdownMs;
  m.endsAt = m.startAt + m.settings.minutes * 60_000;
}

/**
 * A city's report, read against the clock: counted (its figures and the chart's sample kept) only for
 * this round and within the ticks the time allows (plus a little slack for a slow message). `final`:
 * the report it sends as the match ends. Returns whether the figures were counted.
 */
export function readReport(
  m: MatchState,
  slot: number,
  population: number,
  r: MatchReport,
  now: number,
): boolean {
  const p = m.players.find((x) => x.slot === slot);
  if (!p || p.out || (r.round ?? 0) !== m.round) return false;
  if (m.phase === 'over') return false;
  const elapsed = m.startAt === undefined ? 0 : now - m.startAt;
  const allowed = matchTickAt(m.settings, elapsed) + MATCH.slackTicks;
  if (r.final && (m.phase === 'playing' || m.phase === 'final'))
    p.final = { tick: r.tick, ...(r.hash ? { hash: r.hash } : {}) };
  if (r.tick > allowed || r.tick > matchEndTick(m.settings)) return false;
  // A tick older than what's counted already is a message that arrived late.
  if (p.fig && r.tick < p.fig.tick) return false;
  // Race: the tick it first had the target, as its page saw it (kept once said).
  const reached = p.fig?.reached ?? r.reached;
  p.fig = {
    population,
    treasury: r.treasury,
    assets: r.assets,
    approval: r.approval,
    tick: r.tick,
    ...(reached !== undefined ? { reached } : {}),
  };
  if (m.startAt !== undefined && elapsed >= 0) {
    const k = Math.min(MATCH.samples - 1, Math.floor(elapsed / sampleMs(m.settings)));
    while (p.samples.length < k) p.samples.push(null);
    p.samples[k] = matchValue(m.settings.mode, p.fig, m.settings);
  }
  return true;
}

/** Race: has any city still in reached the target (by a counted report)? */
export function raceWon(m: MatchState): boolean {
  if (m.settings.mode !== 'race' || m.phase !== 'playing') return false;
  return inPlay(m).some(
    (p) => p.fig && (p.fig.reached !== undefined || p.fig.population >= m.settings.target),
  );
}

/** The match stops: pages stop their cities and send their last reports; the room waits for them. */
export function finishMatch(m: MatchState, why: MatchEnd, now: number): void {
  if (m.phase !== 'playing' && m.phase !== 'countdown') return;
  m.phase = 'final';
  m.endedBy = why;
  m.finalAt = now;
}

/** Has every city still in (and here) sent its last report, or has the room waited long enough? */
export function finalDue(m: MatchState, now: number, online: (slot: number) => boolean): boolean {
  if (m.phase !== 'final') return false;
  if (now - (m.finalAt ?? now) >= MATCH.finalWaitMs) return true;
  return inPlay(m).every((p) => p.final || !online(p.slot));
}

/**
 * The verdict: one result, the same for every page. A city away when it's decided is out (it left).
 * Race: the city that reached the target at the earliest tick (more residents, then the lower slot, on
 * a tie), else the most residents; the others: the highest score (then residents, then slot).
 */
export function decideMatch(m: MatchState, cities: MatchCity[]): MatchResult {
  const s = m.settings;
  for (const p of m.players)
    if (!p.out && !cities.find((c) => c.slot === p.slot)?.online && !p.final) p.out = true;
  const fig = (p: MatchPlayer): MatchFig =>
    p.fig ?? { population: 0, treasury: 0, assets: 0, approval: 0, tick: 0 };
  const scoreOf = (p: MatchPlayer) => matchScore(s.mode, fig(p), s);
  const order = (a: MatchPlayer, b: MatchPlayer): number => {
    if (!!a.out !== !!b.out) return a.out ? 1 : -1;
    if (s.mode === 'race') {
      const ra = fig(a).reached;
      const rb = fig(b).reached;
      if (ra !== undefined || rb !== undefined) {
        if (ra === undefined) return 1;
        if (rb === undefined) return -1;
        if (ra !== rb) return ra - rb;
      }
    }
    return scoreOf(b) - scoreOf(a) || fig(b).population - fig(a).population || a.slot - b.slot;
  };
  const players = [...m.players].sort(order);
  const winner = players.find((p) => !p.out)?.slot ?? 0;
  const samples: Record<number, number[]> = {};
  for (const p of players) {
    // Holes carry the value before them forward; the first ones (no report counted yet) the first value.
    const first = p.samples.find((v) => v !== null && v !== undefined) ?? 0;
    const filled: number[] = [];
    let last = first;
    for (let k = 0; k < Math.max(p.samples.length, 1) && k < MATCH.samples; k++) {
      const v = p.samples[k];
      if (v !== null && v !== undefined) last = v;
      filled.push(last);
    }
    samples[p.slot] = filled;
  }
  const result: MatchResult = {
    round: m.round,
    settings: { ...s },
    endedBy: m.endedBy ?? 'time',
    winner,
    rows: players.map((p) => {
      const c = cities.find((x) => x.slot === p.slot);
      const f = fig(p);
      return {
        slot: p.slot,
        name: c?.name ?? 'A city',
        mayor: c?.mayor ?? '',
        color: c?.color ?? 0,
        ...f,
        score: scoreOf(p),
        ...(p.final?.hash ? { hash: p.final.hash } : {}),
        ...(p.out ? { out: true as const } : {}),
        final: !!p.final,
      };
    }),
    sampleMs: sampleMs(s),
    samples,
  };
  m.phase = 'over';
  m.result = result;
  return result;
}

/**
 * A rematch (the host, once a match is over): the same settings (or the host's changes) on a new seed,
 * the next round. Cities that left or aren't here are dropped from the match; the others found their
 * new city and the countdown starts by itself once they all have.
 */
export function rematch(m: MatchState, settings: MatchSettings, online: (slot: number) => boolean): number[] {
  const dropped = m.players.filter((p) => p.out || !online(p.slot)).map((p) => p.slot);
  m.settings = settings;
  m.round++;
  m.phase = 'lobby';
  m.auto = true;
  delete m.startAt;
  delete m.endsAt;
  delete m.finalAt;
  delete m.endedBy;
  delete m.result;
  m.players = m.players
    .filter((p) => !dropped.includes(p.slot))
    .map((p) => ({ slot: p.slot, ready: false, samples: [] }));
  return dropped;
}

/** A rematch starts by itself once every city here has founded its city (two at least). */
export function autoStartDue(m: MatchState, online: (slot: number) => boolean): boolean {
  return m.phase === 'lobby' && !!m.auto && startRefusal(m, online) === null;
}

/** The phase the clock has reached: a countdown becomes play at the start; play stops at the timer. */
export function clockPhase(m: MatchState, now: number): MatchEnd | 'start' | null {
  if (m.phase === 'countdown' && m.startAt !== undefined && now >= m.startAt) return 'start';
  if (m.phase === 'playing' && m.endsAt !== undefined && now >= m.endsAt) return 'time';
  return null;
}
