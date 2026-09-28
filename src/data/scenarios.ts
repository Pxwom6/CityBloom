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
  {
    id: 'gridlock',
    name: 'Gridlock',
    blurb: 'Every commuter in town crawls down one dirt track. Get them moving.',
    brief:
      'Twin Fords grew up on two sides of a field: homes to the west, every job to the east, and a ' +
      'single dirt track between them. At rush hour it takes most of an hour to cross. Get the ' +
      'average commute under three minutes for three months running, without losing the town.',
    save: 'gridlock.citybloom',
    months: 12,
    stars: [
      { months: 5, label: 'Within 5 months' },
      { months: 3, label: 'Within 3 months' },
    ],
    goals: [
      { measure: 'traffic', max: 3, hold: 3, label: 'Average commute under 3 minutes, 3 months running' },
      { measure: 'population', min: 2_000, label: '2,000 residents or more' },
    ],
    limits: [],
    disasters: false,
    elections: false,
    hints: [
      'The traffic map shows where the jam is; click a road to see how full it is.',
      'A wider road carries more cars, and a second route splits them.',
    ],
  },
  {
    id: 'smokestack',
    name: 'Smokestack Valley',
    blurb: 'Clear the smoke from a mill town without shutting its mills.',
    brief:
      'Cinderford grew up around its mills and three coal plants, all on the south side of town, and ' +
      'the wind blows from the south. On a still day you can taste it. Bring air pollution where ' +
      'people live under 4.5 % for three months running, and keep at least 3,000 jobs.',
    save: 'smokestack.citybloom',
    months: 24,
    stars: [
      { months: 15, label: 'Within 15 months' },
      { months: 11, label: 'Within 11 months' },
    ],
    goals: [
      {
        measure: 'pollution',
        max: 4.5,
        hold: 3,
        label: 'Air pollution at homes under 4.5 %, 3 months running',
      },
      { measure: 'jobs', min: 3_000, label: '3,000 jobs or more' },
    ],
    limits: [],
    disasters: false,
    elections: false,
    hints: [
      'The air pollution map shows where the smoke goes; the wind carries it north over the houses.',
      'Wind turbines are clean power. Build them before you close a coal plant, or the lights go out.',
      'Schooled workers let mills retool to cleaner processes.',
    ],
  },
  {
    id: 'flood',
    name: 'After the Flood',
    blurb: 'The lake has gone back down, and taken the waterworks with it.',
    brief:
      'Yesterday the lake came over its banks and through the south of Mereside. The water has ' +
      'drained, but the pumps, the treatment works and the outflows are gone, and without clean water ' +
      'people will not stay. Get the taps running again and grow the town to 24,000 within a year.',
    save: 'flood.citybloom',
    months: 12,
    stars: [
      { months: 8, label: 'Within 8 months' },
      { months: 5, label: 'Within 5 months' },
    ],
    goals: [{ measure: 'population', min: 24_000, hold: 2, label: '24,000 residents, 2 months running' }],
    limits: [],
    disasters: false,
    elections: false,
    hints: [
      'Homes without water empty within days: pumps and a way to deal with sewage come first.',
      'The water map shows clean ground for pumps; keep them away from sewage and industry.',
    ],
  },
  {
    id: 'resort',
    name: 'Seaside Resort',
    blurb: 'Turn a coastal town into a place people travel to see.',
    brief:
      'Saltmarsh has sand, sea and sunsets, and nobody comes. The council wants a resort, not more ' +
      'factories: draw 2,000 visitors a day and keep residents happy with it, 65 % approval for two ' +
      'months running.',
    save: 'resort.citybloom',
    months: 24,
    stars: [
      { months: 16, label: 'Within 16 months' },
      { months: 12, label: 'Within a year' },
    ],
    goals: [
      { measure: 'visitors', min: 2_000, hold: 2, label: '2,000 visitors a day, 2 months running' },
      { measure: 'approval', min: 65, hold: 2, label: 'Approval of 65 %, 2 months running' },
    ],
    limits: [{ kind: 'noZone', zone: 'I', label: 'New industry zoning is not allowed' }],
    disasters: false,
    elections: false,
    hints: [
      'Landmarks draw visitors; hotels keep them overnight, when they spend the most.',
      'The tourism campaign policy brings more, as does funding the tourism office; good approval makes the town more inviting.',
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
