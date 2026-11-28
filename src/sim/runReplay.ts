/**
 * A weekly challenge's run (M44): the challenge played, every command and save point with its tick
 * since the city was founded, the tick it ended at, and the city's `hash()` and score there. Anyone can
 * replay it: found the city again from the challenge (its options say everything), apply the entries at
 * their ticks, run to the end, and it must come to the same hash and score. Pure, so the page's worker,
 * the replay viewer and Node all replay it alike; the board's honesty rests on it.
 */
import { challengeOptions, type ChallengeDef } from '../data/challenges';
import { checkCommand } from './commandCheck';
import type { Command } from './commands';
import { Sim } from './sim';
import { challengeScoreNow } from './systems/scenario';
import { TICKS_PER_MONTH } from './time';

export const RUN_VERSION = 1;
/** Every challenge city's name: nothing a player types goes into a run others watch. */
export const CHALLENGE_TOWN = 'Challenge town';
/** The most entries a run may hold (a long, busy run has a few thousand). */
export const RUN_MAX_ENTRIES = 30_000;

/** A command the player gave, or a save that settled the city (both at a tick). */
export type RunEntry = { tick: number; cmd: Command } | { tick: number; settle: true };

export interface ChallengeRun {
  v: number;
  week: number;
  def: ChallengeDef;
  entries: RunEntry[];
  /** The tick the run ended at. */
  end: number;
  hash: string;
  score: number;
}

/** The latest tick a run of this challenge may end at: its months and two more (the last month close). */
export const runMaxTick = (def: Pick<ChallengeDef, 'months'>) => (def.months + 2) * TICKS_PER_MONTH;

/**
 * Why a run can't be replayed (its shape, its entries' order and kinds), or null. Every command must be
 * one a player could give another's city (no cheats, nothing page-only), as the rooms check them.
 */
export function runProblem(run: ChallengeRun): string | null {
  if (run.v !== RUN_VERSION) return 'A run from another version of the game';
  if (!run.def || run.def.week !== run.week) return 'A run of another week';
  if (!Array.isArray(run.entries) || run.entries.length > RUN_MAX_ENTRIES) return 'Too many entries';
  if (!Number.isInteger(run.end) || run.end < 0 || run.end > runMaxTick(run.def))
    return 'An end past the challenge';
  let last = 0;
  for (const e of run.entries) {
    if (!e || !Number.isInteger(e.tick) || e.tick < last || e.tick > run.end) return 'Entries out of order';
    last = e.tick;
    if ('settle' in e) {
      if (e.settle !== true) return 'A bad entry';
      continue;
    }
    const c = checkCommand(e.cmd);
    if ('problem' in c)
      return `A command no player could give (${String((e.cmd as { type?: unknown })?.type)})`;
  }
  return null;
}

export interface ReplayResult {
  ok: boolean;
  hash: string;
  score: number;
  tick: number;
  why?: string;
}

/**
 * Replay a run: the same hash and score as it claims, or why not. `each` is called with the city every
 * tick (the viewer draws from it); `stop` ends it early (a page that's going).
 */
export function replayRun(run: ChallengeRun, each?: (sim: Sim) => void): ReplayResult {
  const problem = runProblem(run);
  if (problem) return { ok: false, hash: '', score: 0, tick: 0, why: problem };
  const sim = Sim.create(challengeOptions(run.def, CHALLENGE_TOWN));
  let i = 0;
  for (;;) {
    while (i < run.entries.length && run.entries[i]!.tick === sim.tick) {
      const e = run.entries[i++]!;
      // (The command as the player's city took it: `runProblem` has checked each one already.)
      if ('settle' in e) sim.save('', true);
      else sim.dispatch(e.cmd);
    }
    each?.(sim);
    if (sim.tick >= run.end) break;
    sim.step();
  }
  const hash = sim.hash();
  const score = challengeScoreNow(sim);
  const ok = hash === run.hash && score === run.score;
  return {
    ok,
    hash,
    score,
    tick: sim.tick,
    ...(ok
      ? {}
      : { why: hash !== run.hash ? 'The replay came to another city' : 'The replay came to another score' }),
  };
}
