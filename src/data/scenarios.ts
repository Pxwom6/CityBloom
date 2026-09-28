/**
 * Scenarios (M18): a fixed map and starting city (a save in `public/scenarios/`), goals that must
 * all hold at once as a month closes, limits on what the mayor may do, and a time limit. Winning
 * gives one star, and each of the two star rules met on the day adds another.
 */

/** What a goal measures. The first ten are the city history's monthly figures (M16). */
export type GoalMeasure =
  | 'population'
  | 'approval'
  | 'jobs'
  | 'unemployment'
  | 'treasury'
  | 'income'
  | 'spending'
  | 'pollution'
  | 'crime'
  | 'traffic'
  /** Income minus spending in the month just closed. */
  | 'net'
  | 'visitors'
  | 'abandoned'
  /** Loans still owed. */
  | 'loans'
  /** 1 once the big project `def` is open. */
  | 'project'
  /** 1 once an election has been won since the scenario began. */
  | 'election';

export interface ScenarioGoal {
  measure: GoalMeasure;
  /** Met at or above `min`, at or below `max`. */
  min?: number;
  max?: number;
  /** For `project`: which one. */
  def?: string;
  /** Month closes in a row the goal must hold (default 1). */
  hold?: number;
  /** As the goals panel says it. */
  label: string;
}

export type ScenarioLimit =
  | { kind: 'noCivic'; defs: string[]; label: string }
  | { kind: 'noLoans'; label: string }
  | { kind: 'noZone'; zone: 'R' | 'C' | 'I'; label: string }
  | { kind: 'maxTax'; rate: number; label: string };

/** A star for winning within so many months, or with a bonus goal met on the day. */
export interface StarRule {
  months?: number;
  goal?: ScenarioGoal;
  label: string;
}

export interface ScenarioDef {
  id: string;
  name: string;
  /** One line for the card. */
  blurb: string;
  /** The situation, for the brief. */
  brief: string;
  /** The starting city, in `public/scenarios/`. */
  save: string;
  /** Months to win in. */
  months: number;
  /** The second and third stars. */
  stars: [StarRule, StarRule];
  goals: ScenarioGoal[];
  limits: ScenarioLimit[];
  disasters: boolean;
  elections: boolean;
  /** Advice on the brief card. */
  hints: string[];
  /** Losing the next election loses the scenario. */
  mustWinElection?: boolean;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'cleanslate',
    name: 'Clean Slate',
    blurb: 'Grow a young river town into a city of 10,000 without burning coal or gas.',
    brief:
      'Fernlea runs on a handful of wind turbines, and its people mean to keep it that way. The valley ' +
      'has room for a city: grow it to 10,000 residents on clean power alone.',
    save: 'cleanslate.citybloom',
    months: 72,
    stars: [
      { months: 48, label: 'Within 4 years' },
      { months: 36, label: 'Within 3 years' },
    ],
    goals: [{ measure: 'population', min: 10_000, label: '10,000 residents' }],
    limits: [{ kind: 'noCivic', defs: ['coal', 'gas'], label: 'Coal and gas plants are not allowed' }],
    disasters: false,
    elections: false,
    hints: [
      'Wind turbines are cheap; solar farms open at 5,000 residents and give far more.',
      'Keep power, water and sewage ahead of demand, and add services as the town grows.',
    ],
  },
  {
    id: 'brink',
    name: 'Back from the Brink',
    blurb: 'Pay off a spendthrift mayor’s loans and put money back in the bank.',
    brief:
      'Marlow’s last mayor cut taxes to 3 %, borrowed to the limit, spent it all on hospitals, schools ' +
      'and plazas, and paid every department over the odds. The treasury is empty and three loans ' +
      'are owed. Pay them off, put $250,000 in the bank, and keep the town behind you.',
    save: 'brink.citybloom',
    months: 36,
    stars: [
      { months: 18, label: 'Within 18 months' },
      { months: 12, label: 'Within a year' },
    ],
    goals: [
      { measure: 'loans', max: 0, label: 'Every loan repaid' },
      { measure: 'treasury', min: 250_000, label: '$250,000 in the bank' },
      { measure: 'approval', min: 60, label: 'Approval of 60 % or more' },
    ],
    limits: [{ kind: 'noLoans', label: 'New loans are not allowed' }],
    disasters: false,
    elections: false,
    hints: [
      'Taxes of 9–10 % are normal; residents notice each point above that.',
      'Funding over 100 % costs more than it gives back. The budget shows every line.',
      'Repay a loan early from the budget’s Loans tab once the treasury can cover it.',
    ],
  },
  {
    id: 'vote',
    name: 'Vote of Confidence',
    blurb: 'Win back a town that has had enough of you before it votes.',
    brief:
      'Taxes in Hollin are the highest in the region and its schools and clinics are short of money. ' +
      'Approval has fallen to a quarter and the vote is a year away. Win the election.',
    save: 'vote.citybloom',
    months: 16,
    stars: [
      {
        goal: { measure: 'approval', min: 65, label: 'Approval of 65 %' },
        label: 'Approval of 65 % on the day',
      },
      {
        goal: { measure: 'approval', min: 75, label: 'Approval of 75 %' },
        label: 'Approval of 75 % on the day',
      },
    ],
    goals: [{ measure: 'election', min: 1, label: 'Win the election' }],
    limits: [],
    disasters: false,
    elections: true,
    mustWinElection: true,
    hints: [
      'Voters follow approval above all: taxes, services and jobs move it.',
      'In the six months before the vote, make up to two promises you can keep (city panel, Election).',
    ],
  },
  {
    id: 'stadium',
    name: 'Big Game',
    blurb: 'Give a city of 20,000 its stadium, without borrowing a cent.',
    brief:
      'Castlebridge has passed 20,000 residents and wants a ground of its own. Build the city ' +
      'stadium and open it within two years, paying for every stage as it comes, with no loans.',
    save: 'stadium.citybloom',
    months: 24,
    stars: [
      { months: 16, label: 'Open within 16 months' },
      { months: 12, label: 'Open within a year' },
    ],
    goals: [{ measure: 'project', def: 'stadium', min: 1, label: 'The city stadium open' }],
    limits: [{ kind: 'noLoans', label: 'Loans are not allowed' }],
    disasters: false,
    elections: false,
    hints: [
      'Big projects pay for each stage as it starts; if the treasury is short, the site waits.',
      'The stadium takes ten months to build once work starts. Save for the first stage, then keep the money coming.',
    ],
  },
];

export const SCENARIO = new Map(SCENARIOS.map((s) => [s.id, s]));

/** Whether a goal's value meets it. */
export function goalMet(g: ScenarioGoal, value: number): boolean {
  return (g.min === undefined || value >= g.min) && (g.max === undefined || value <= g.max);
}

/** Whether a star rule is met by a win after `months` months (`value` reads a bonus goal). */
export function starMet(r: StarRule, months: number, value: (g: ScenarioGoal) => number): boolean {
  return (r.months === undefined || months <= r.months) && (!r.goal || goalMet(r.goal, value(r.goal)));
}
