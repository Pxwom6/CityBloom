/**
 * Quick match (M43): short games between two to four friends, each in their own small city on the
 * same seed, side by side in a shared mini-region. The numbers, the modes and how a city scores, read
 * the same by the region room (which decides) and the pages (which show it). Every number is logged
 * in DECISIONS "M43"; the fast start's are tuned by balance mayors playing matches against each other.
 */
import { formatInt } from '../sim/dmath';
import type { MapPreset } from './world';

export type MatchMode = 'race' | 'rich' | 'happy' | 'mixed';
export const MATCH_MODES: MatchMode[] = ['race', 'rich', 'happy', 'mixed'];

export const MATCH_MODE_INFO: Record<MatchMode, { name: string; blurb: string }> = {
  race: { name: 'Race', blurb: 'First to the target population wins.' },
  rich: {
    name: 'Rich list',
    blurb: 'The most money, counting what the city’s buildings are worth, when time is up.',
  },
  happy: {
    name: 'Happy town',
    blurb: 'The happiest city when time is up, if it has the minimum population.',
  },
  mixed: { name: 'Mixed', blurb: 'A score from population, happiness and money.' },
};

/** The maps a match can be played on (the host picks; every city gets the same one). */
export const MATCH_PRESETS: MapPreset[] = ['river', 'coast', 'lakes', 'highlands'];

export const MATCH = {
  /** The timer's choices (real minutes). Test builds may also ask for one minute. */
  minutes: [15, 20, 30] as const,
  testMinutes: 1,
  /** The game speed every city plays at (the fastest), fixed for the match. */
  speed: 3 as const,
  /** Race: the population to reach; Happy town: the population a city needs to count. */
  raceTarget: 10_000,
  raceTargets: [5_000, 10_000, 15_000] as const,
  happyMinPop: 2_000,
  /** Players in a match. */
  minPlayers: 2,
  maxPlayers: 4,
  /** Between the host's Start and the clock starting (ms). */
  countdownMs: 5_000,
  /**
   * After the end, how long the room waits for the last reports of the cities still here before
   * deciding (ms): a slow device catching up to the timer's last tick takes a few seconds.
   */
  finalWaitMs: 30_000,
  /** How often a match city reports (ms), sends its picture (ms) and a save to look round (ms). */
  reportMs: 5_000,
  thumbMs: 60_000,
  saveMs: 120_000,
  /** Game ticks a city may run ahead of the match's clock and still be counted (a slow message). */
  slackTicks: 240,
  /** Score samples kept per city for the results chart. */
  samples: 60,
  /** The fixed emotes, and the least time between two from one player (ms). */
  emotes: ['👍', '👏', '😮', '😂', '🎉', '😬'] as const,
  emoteEveryMs: 2_000,
  /**
   * The fast start: starting money, growth (spawning, moving in, building speed and how much is built
   * at once) and the unlock path (each unlock at this share of its population), so a city gets
   * somewhere in 20 minutes at the fastest speed (28,800 ticks, 20 game months).
   */
  fastStart: { funds: 200_000, growth: 2, unlock: 0.5 },
};

/** The fast start a match city is founded with (GameOptions.match): read by the sim. */
export interface MatchStart {
  funds: number;
  growth: number;
  unlock: number;
}

/** What the host sets (and the room keeps). */
export interface MatchSettings {
  mode: MatchMode;
  /** Real minutes. */
  minutes: number;
  /** Race's target population. */
  target: number;
  /** Happy town's minimum population. */
  minPop: number;
  /** The map every city is founded on. */
  seed: string;
  preset: MapPreset;
  /** Free text between players (off unless the host allows; emotes always). */
  chat: boolean;
}

export function defaultMatch(seed: string): MatchSettings {
  return {
    mode: 'race',
    minutes: 20,
    target: MATCH.raceTarget,
    minPop: MATCH.happyMinPop,
    seed,
    preset: 'river',
    chat: false,
  };
}

/** A seed for a new match: six letters and digits from the page's random numbers (not the sim's). */
export function matchSeed(random: () => number): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = 'm';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(random() * abc.length)];
  return s;
}

/** Settings from the wire or a URL, cleaned (null if they aren't a match's). `test` allows one minute. */
export function cleanMatchSettings(raw: unknown, test = false): MatchSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mode = MATCH_MODES.includes(r.mode as MatchMode) ? (r.mode as MatchMode) : null;
  const okMinutes = (m: unknown) =>
    typeof m === 'number' &&
    ((MATCH.minutes as readonly number[]).includes(m) || (test && m === MATCH.testMinutes));
  const preset = MATCH_PRESETS.includes(r.preset as MapPreset) ? (r.preset as MapPreset) : null;
  const seed = typeof r.seed === 'string' && /^[a-z0-9]{3,12}$/.test(r.seed) ? r.seed : null;
  if (!mode || !okMinutes(r.minutes) || !preset || !seed) return null;
  const target = (MATCH.raceTargets as readonly number[]).includes(r.target as number)
    ? (r.target as number)
    : MATCH.raceTarget;
  return {
    mode,
    minutes: r.minutes as number,
    target,
    minPop: MATCH.happyMinPop,
    seed,
    preset,
    chat: r.chat === true,
  };
}

/** A city's figures as its match report gives them. */
export interface MatchFigures {
  population: number;
  /** Money in the bank. */
  treasury: number;
  /** What its civic buildings are worth (half what they cost), less what it still owes on loans. */
  assets: number;
  /** Approval, 0–100. */
  approval: number;
}

/** A city's money for the Rich list: the treasury and what its buildings are worth, less its loans. */
export function matchMoney(f: MatchFigures): number {
  return f.treasury + f.assets;
}

/**
 * The score a city has in a mode (higher is better). Race: population; Rich list: money; Happy
 * town: approval, or nothing below the minimum population (with population as a small tiebreak
 * underneath); Mixed: a thousand residents, a point of approval and ten thousand dollars each count
 * one point, approval only for a city past the minimum (an empty town is "happy").
 */
export function matchScore(mode: MatchMode, f: MatchFigures, s: Pick<MatchSettings, 'minPop'>): number {
  const pop = Math.max(0, f.population);
  switch (mode) {
    case 'race':
      return pop;
    case 'rich':
      return Math.round(matchMoney(f));
    case 'happy':
      return pop >= s.minPop ? f.approval * 1_000_000 + Math.min(pop, 999_999) : 0;
    case 'mixed':
      return Math.round(
        (pop / 1000) * 10 + (pop >= s.minPop ? f.approval : 0) * 10 + (matchMoney(f) / 10_000) * 10,
      );
  }
}

/**
 * What the results chart draws for a city in a mode: Race its population, Rich list its money, Happy
 * town its approval (nothing below the minimum population), Mixed its points.
 */
export function matchValue(mode: MatchMode, f: MatchFigures, s: Pick<MatchSettings, 'minPop'>): number {
  switch (mode) {
    case 'race':
      return Math.max(0, f.population);
    case 'rich':
      return Math.round(matchMoney(f));
    case 'happy':
      return f.population >= s.minPop ? f.approval : 0;
    case 'mixed':
      return matchScore('mixed', f, s) / 10;
  }
}

/** A score as a player reads it ("12,450 residents", "$412,000", "78 % happy", "286 points"). */
export function matchScoreText(mode: MatchMode, f: MatchFigures, s: Pick<MatchSettings, 'minPop'>): string {
  const n = formatInt;
  switch (mode) {
    case 'race':
      return `${n(f.population)} residents`;
    case 'rich': {
      const m = Math.round(matchMoney(f));
      return `${m < 0 ? '−' : ''}$${n(Math.abs(m))}`;
    }
    case 'happy':
      return f.population >= s.minPop
        ? `${Math.round(f.approval)} % happy`
        : `${n(f.population)} of ${n(s.minPop)} residents`;
    case 'mixed':
      return `${n(matchScore('mixed', f, s) / 10)} points`;
  }
}

/** A score in a few characters, for the scoreboard's chips ("12,450", "$412k", "78 %", "286 pts"). */
export function matchScoreShort(mode: MatchMode, f: MatchFigures, s: Pick<MatchSettings, 'minPop'>): string {
  const n = formatInt;
  switch (mode) {
    case 'race':
      return n(f.population);
    case 'rich': {
      const m = Math.round(matchMoney(f));
      const a = Math.abs(m);
      const tenths = Math.floor(a / 100_000);
      const v =
        a >= 1_000_000
          ? `${n(Math.floor(tenths / 10))}.${tenths % 10}M`
          : a >= 10_000
            ? `${n(Math.floor(a / 1000))}k`
            : n(a);
      return `${m < 0 ? '−' : ''}$${v}`;
    }
    case 'happy':
      return f.population >= s.minPop ? `${Math.round(f.approval)} %` : `${n(f.population)}/${n(s.minPop)}`;
    case 'mixed':
      return `${n(matchScore('mixed', f, s) / 10)} pts`;
  }
}
