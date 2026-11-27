/**
 * The weekly challenge (M44): the same for everyone each week, made by a generator seeded by the week
 * so nobody has to write one. A challenge is a scenario (M18) without a starting save: the city is
 * founded fresh on the challenge's seed and map, with its goals, limits and time limit, a twist, and a
 * score so there's something to beat. The owner can pin a hand-made one for a week instead (checked by
 * `cleanChallengeDef` wherever it arrives). Only integer arithmetic and the sim's seeded random numbers,
 * so the page, Node and the Worker build the same challenge from the same week.
 */
import { Rng } from '../sim/rng';
import { formatInt } from '../sim/dmath';
import type { GoalMeasure, ScenarioDef, ScenarioGoal, ScenarioLimit } from './scenarios';
import type { MapPreset } from './world';
import type { GameOptions } from '../sim/state';
import { CHALLENGE_MAPS } from './challengeMaps';

export type ChallengeTemplate = 'boom' | 'happy' | 'books' | 'clean' | 'jobs';
export type ChallengeTwist = 'none' | 'budget' | 'noHighway' | 'disaster' | 'railOnly' | 'smallMap';

export const CHALLENGE_TEMPLATES: ChallengeTemplate[] = ['boom', 'happy', 'books', 'clean', 'jobs'];
export const CHALLENGE_TWISTS: ChallengeTwist[] = [
  'none',
  'budget',
  'noHighway',
  'disaster',
  'railOnly',
  'smallMap',
];
const PRESETS: MapPreset[] = ['river', 'coast', 'lakes', 'highlands'];

/** What the score counts on top of the goals: a measure, and how many points each unit of it is worth (thousandths). */
export interface ChallengeExtra {
  measure: GoalMeasure;
  /** Points for each unit of the measure, in thousandths (100 = a tenth of a point a unit). */
  perMille: number;
  /** At most this many points. */
  cap: number;
  label: string;
}

/** A week's challenge. */
export interface ChallengeDef extends ScenarioDef {
  week: number;
  seed: string;
  preset: MapPreset;
  template: ChallengeTemplate;
  twist: ChallengeTwist;
  /** Money to start with. */
  funds: number;
  extra: ChallengeExtra;
  /** Hand-made by the owner and pinned for its week. */
  pinned?: true;
}

/** The score's parts, all whole numbers. */
export const SCORE = {
  /** All the goals' progress together, at most. */
  goals: 1000,
  /** Winning, and each whole month left when it's won. */
  win: 2000,
  perMonthLeft: 100,
} as const;

/** Starting money: a Standard city's, two thirds of it on a tight budget, more for an early disaster's rebuilding. */
export const CHALLENGE_FUNDS = { normal: 60_000, budget: 45_000, disaster: 70_000 } as const;
/** The months a challenge runs (whole game months). */
export const CHALLENGE_MONTHS = 48;
export const SMALL_MAP = 650;

const TEMPLATE_INFO: Record<ChallengeTemplate, { name: string; blurb: string }> = {
  boom: { name: 'Boom town', blurb: 'Grow as big as you can, fast.' },
  happy: { name: 'Happy town', blurb: 'A town people are glad to live in.' },
  books: { name: 'Balanced books', blurb: 'Money in the bank and a town that pays its way.' },
  clean: { name: 'Clean air', blurb: 'Grow without the smog.' },
  jobs: { name: 'Work for everyone', blurb: 'Jobs for all, and plenty of them.' },
};

export const TWIST_INFO: Record<ChallengeTwist, { name: string; line: string }> = {
  none: { name: 'No twist', line: 'Just you and the map.' },
  budget: {
    name: 'Tight budget',
    line: `Start with $${formatInt(CHALLENGE_FUNDS.budget)}, three quarters of the usual.`,
  },
  noHighway: { name: 'No city highways', line: 'Motorways and ramps can’t be built.' },
  disaster: { name: 'Early disaster', line: 'Something will hit the town early on.' },
  railOnly: { name: 'Rail only', line: 'No buses: trains and trams carry the town.' },
  smallMap: {
    name: 'Small map',
    line: `Build only within ${formatInt(SMALL_MAP)} m of where the highway comes in.`,
  },
};

const goal = (measure: GoalMeasure, label: string, o: Partial<ScenarioGoal>): ScenarioGoal => ({
  measure,
  label,
  ...o,
});

/** The week's challenge, made from the week alone. */
export function challengeFor(week: number): ChallengeDef {
  const rng = Rng.fromSeed(`citybloom:challenge:${week}`);
  const pick = <T>(list: readonly T[]) => list[rng.int(list.length)]!;
  const template = CHALLENGE_TEMPLATES[((week % 5) + 5) % 5]!;
  // Twists rotate too (never the same pairing two weeks running), with one week in six plain.
  const twist = CHALLENGE_TWISTS[(((week * 7 + 3) % 6) + 6) % 6]!;
  // A map the balance mayor grows a town on (`scripts/challengeMaps.ts`), a tight budget's from those
  // it manages on less money too.
  const budgetMaps = CHALLENGE_MAPS.filter((m) => m.budget);
  const maps = twist === 'budget' && budgetMaps.length ? budgetMaps : CHALLENGE_MAPS;
  const map = pick(maps);
  const preset = map.preset;
  const seed = map.seed;
  // Targets vary a little week to week (in steps), lower with a twist that bites.
  const hard = twist === 'budget' || twist === 'disaster' || twist === 'smallMap' ? -1 : 0;
  const s = Math.max(0, rng.int(3) + hard);
  // (Set from the balance mayor's first three years: `scripts/challenges.ts` must win every week.)
  const pop = 750 + 250 * s;
  const goals: ScenarioGoal[] = [];
  let extra: ChallengeExtra;
  switch (template) {
    case 'boom':
      goals.push(goal('population', `${formatInt(pop + 750)} residents`, { min: pop + 750 }));
      extra = { measure: 'population', perMille: 200, cap: 4000, label: 'a point for every 5 residents' };
      break;
    case 'happy':
      goals.push(
        goal('approval', `Approval ${(hard ? 45 : 50) + 2 * s} % or more`, {
          min: (hard ? 45 : 50) + 2 * s,
          hold: 2,
        }),
      );
      goals.push(goal('population', `${formatInt(pop)} residents`, { min: pop }));
      extra = {
        measure: 'approval',
        perMille: 30_000,
        cap: 3000,
        label: '30 points for each point of approval',
      };
      break;
    case 'books':
      goals.push(
        goal('treasury', `$${formatInt(5000 + 2500 * s)} in the bank`, {
          min: 5000 + 2500 * s,
        }),
      );
      goals.push(goal('population', `${formatInt(pop)} residents`, { min: pop }));
      extra = { measure: 'treasury', perMille: 50, cap: 3000, label: 'a point for every $20 in the bank' };
      break;
    case 'clean':
      goals.push(goal('population', `${formatInt(pop + 500)} residents`, { min: pop + 500 }));
      goals.push(goal('pollution', 'Pollution 8 or less', { max: 8, hold: 2 }));
      extra = { measure: 'population', perMille: 200, cap: 4000, label: 'a point for every 5 residents' };
      break;
    case 'jobs':
      goals.push(goal('jobs', `${formatInt(pop + 250)} jobs`, { min: pop + 250 }));
      goals.push(goal('unemployment', 'Unemployment 5 % or less', { max: 5, hold: 2 }));
      extra = { measure: 'jobs', perMille: 300, cap: 4000, label: 'a point for every 3 or so jobs' };
      break;
  }
  const limits: ScenarioLimit[] = [];
  if (twist === 'noHighway')
    limits.push({ kind: 'noRoad', roads: ['motorway', 'ramp'], label: 'No city highways' });
  if (twist === 'railOnly') {
    limits.push({ kind: 'noCivic', defs: ['busdepot'], label: 'No buses' });
    limits.push({ kind: 'noBusStops', label: 'No bus stops' });
  }
  if (twist === 'smallMap') limits.push({ kind: 'area', size: SMALL_MAP, label: 'Only near the highway' });
  const info = TEMPLATE_INFO[template];
  const t = TWIST_INFO[twist];
  return {
    id: `week-${week}`,
    name: `${info.name}: ${t.name.toLowerCase()}`,
    blurb: info.blurb,
    brief: `${info.blurb} ${t.line} You have ${CHALLENGE_MONTHS / 12} years.`,
    save: '',
    months: CHALLENGE_MONTHS,
    stars: [
      { months: 24, label: 'Within two years' },
      { months: 18, label: 'Within eighteen months' },
    ],
    goals,
    limits,
    disasters: false,
    elections: false,
    hints: hintsFor(template, twist),
    week,
    seed,
    preset,
    template,
    twist,
    funds:
      twist === 'budget'
        ? CHALLENGE_FUNDS.budget
        : twist === 'disaster'
          ? CHALLENGE_FUNDS.disaster
          : CHALLENGE_FUNDS.normal,
    extra,
    ...(twist === 'disaster'
      ? { disaster: { month: 10 + rng.int(4), kind: pick(['earthquake', 'tornado'] as const) } }
      : {}),
  };
}

function hintsFor(template: ChallengeTemplate, twist: ChallengeTwist): string[] {
  const h: string[] = [];
  if (template === 'happy') h.push('Parks, clinics and schools lift approval; noise and smog pull it down.');
  if (template === 'books') h.push('Keep services lean at first and let taxes build up.');
  if (template === 'clean')
    h.push('Keep industry away from homes and downwind; wind and solar power are clean.');
  if (template === 'jobs')
    h.push('Zone industry and shops early: jobs need workers, and workers need homes.');
  if (template === 'boom') h.push('Power, water and a steady supply of zoned land keep a town growing.');
  if (twist === 'disaster') h.push('Keep some money back for rebuilding.');
  if (twist === 'smallMap') h.push('Space is tight: build up, not out.');
  if (twist === 'railOnly') h.push('A tram line down the main street does a bus’s job.');
  return h;
}

/** The score a run has earned: goals' progress, the win and the months left, and the extra. */
export function challengeScore(
  def: Pick<ChallengeDef, 'goals' | 'extra' | 'months'>,
  values: number[],
  extraValue: number,
  won: boolean,
  monthsTaken: number,
): number {
  let progress = 0;
  def.goals.forEach((g, i) => {
    const v = values[i] ?? 0;
    let p = 1;
    if (g.min !== undefined) p = g.min > 0 ? Math.min(1, Math.max(0, v) / g.min) : v >= g.min ? 1 : 0;
    else if (g.max !== undefined) p = v <= g.max ? 1 : g.max > 0 && v > 0 ? g.max / v : 0;
    progress += p;
  });
  const goals = def.goals.length ? Math.floor((progress / def.goals.length) * SCORE.goals) : 0;
  const win = won ? SCORE.win + SCORE.perMonthLeft * Math.max(0, def.months - monthsTaken) : 0;
  const extra = Math.min(def.extra.cap, Math.floor((Math.max(0, extraValue) * def.extra.perMille) / 1000));
  return goals + win + extra;
}

/** The most a challenge's score can be (the board refuses more). */
export function challengeMaxScore(def: Pick<ChallengeDef, 'months' | 'extra'>): number {
  return SCORE.goals + SCORE.win + SCORE.perMonthLeft * def.months + def.extra.cap;
}

const MEASURES = new Set<GoalMeasure>([
  'population',
  'approval',
  'jobs',
  'unemployment',
  'treasury',
  'income',
  'spending',
  'pollution',
  'crime',
  'traffic',
  'net',
  'visitors',
  'abandoned',
  'loans',
  'powered',
  'riders',
]);
const TEXT = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
const NUM = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * A challenge from the wire (the owner's pin): rebuilt field by field from what a challenge may hold,
 * or null if anything is wrong. Only measures and limits the generator itself uses.
 */
export function cleanChallengeDef(raw: unknown, week: number): ChallengeDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!TEXT(r.name, 60) || !TEXT(r.blurb, 160) || !TEXT(r.brief, 400)) return null;
  if (typeof r.seed !== 'string' || !/^[a-z0-9]{1,16}$/.test(r.seed)) return null;
  if (!PRESETS.includes(r.preset as MapPreset)) return null;
  if (!NUM(r.months, 6, 60) || !Number.isInteger(r.months)) return null;
  if (!NUM(r.funds, 5000, 500_000)) return null;
  const twist = CHALLENGE_TWISTS.includes(r.twist as ChallengeTwist) ? (r.twist as ChallengeTwist) : 'none';
  const template = CHALLENGE_TEMPLATES.includes(r.template as ChallengeTemplate)
    ? (r.template as ChallengeTemplate)
    : 'boom';
  if (!Array.isArray(r.goals) || r.goals.length < 1 || r.goals.length > 4) return null;
  const goals: ScenarioGoal[] = [];
  for (const g of r.goals as Record<string, unknown>[]) {
    if (!g || !MEASURES.has(g.measure as GoalMeasure) || !TEXT(g.label, 60)) return null;
    if (g.min === undefined && g.max === undefined) return null;
    if (g.min !== undefined && !NUM(g.min, -1e9, 1e9)) return null;
    if (g.max !== undefined && !NUM(g.max, -1e9, 1e9)) return null;
    if (g.hold !== undefined && !(NUM(g.hold, 1, 12) && Number.isInteger(g.hold))) return null;
    goals.push({
      measure: g.measure as GoalMeasure,
      label: g.label as string,
      ...(g.min !== undefined ? { min: g.min as number } : {}),
      ...(g.max !== undefined ? { max: g.max as number } : {}),
      ...(g.hold !== undefined ? { hold: g.hold as number } : {}),
    });
  }
  const e = r.extra as Record<string, unknown> | undefined;
  if (
    !e ||
    !MEASURES.has(e.measure as GoalMeasure) ||
    !NUM(e.perMille, 0, 100_000) ||
    !NUM(e.cap, 0, 10_000) ||
    !TEXT(e.label, 80)
  )
    return null;
  const base = challengeFor(week);
  const limits: ScenarioLimit[] =
    twist === 'noHighway' || twist === 'railOnly' || twist === 'smallMap' ? challengeLimits(twist) : [];
  const d = r.disaster as Record<string, unknown> | undefined;
  const disaster =
    twist === 'disaster' && d && NUM(d.month, 1, 24) && (d.kind === 'earthquake' || d.kind === 'tornado')
      ? { month: Math.floor(d.month as number), kind: d.kind as 'earthquake' | 'tornado' }
      : undefined;
  return {
    ...base,
    id: `week-${week}`,
    name: r.name as string,
    blurb: r.blurb as string,
    brief: r.brief as string,
    seed: r.seed,
    preset: r.preset as MapPreset,
    months: r.months as number,
    funds: Math.round(r.funds as number),
    template,
    twist,
    goals,
    limits,
    extra: {
      measure: e.measure as GoalMeasure,
      perMille: Math.round(e.perMille as number),
      cap: Math.round(e.cap as number),
      label: e.label as string,
    },
    hints: Array.isArray(r.hints)
      ? ((r.hints as unknown[]).filter((x) => TEXT(x, 160)).slice(0, 4) as string[])
      : [],
    ...(disaster ? { disaster } : {}),
    pinned: true,
    week,
  };
}

function challengeLimits(twist: ChallengeTwist): ScenarioLimit[] {
  if (twist === 'noHighway')
    return [{ kind: 'noRoad', roads: ['motorway', 'ramp'], label: 'No city highways' }];
  if (twist === 'railOnly')
    return [
      { kind: 'noCivic', defs: ['busdepot'], label: 'No buses' },
      { kind: 'noBusStops', label: 'No bus stops' },
    ];
  if (twist === 'smallMap') return [{ kind: 'area', size: SMALL_MAP, label: 'Only near the highway' }];
  return [];
}

/** A challenge city's founding: the challenge's map, its money, and no disasters, elections or neighbours of its own. */
export function challengeOptions(def: ChallengeDef, cityName: string): Partial<GameOptions> {
  return {
    seed: def.seed,
    preset: def.preset,
    difficulty: 'normal',
    sandbox: false,
    disasters: false,
    elections: false,
    region: false,
    cityName,
    challenge: def,
  };
}
