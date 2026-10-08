/** Money: tax bases, upkeep, funding departments, loans, bankruptcy. DESIGN.md §3.5. */
export type ZoneKey = 'R' | 'C' | 'I';

/** Monthly taxable income per resident (R) or per worker (C/I) by wealth / industry tier, at 100 %. */
export const TAX_BASE: Record<ZoneKey, [number, number, number]> = {
  R: [24, 44, 80],
  C: [60, 100, 160],
  I: [50, 90, 140],
};
export const TAX_MIN = 0;
export const TAX_MAX = 20;
export const TAX_DEFAULT = 9;

export type Dept =
  | 'roads'
  | 'power'
  | 'water'
  | 'sewage'
  | 'garbage'
  | 'fire'
  | 'police'
  | 'health'
  | 'education'
  | 'parks'
  | 'transit'
  | 'tourism'
  | 'trade';
export const DEPTS: { id: Dept; name: string; effect: string }[] = [
  { id: 'roads', name: 'Road maintenance', effect: 'Below 100 %, roads wear and traffic slows.' },
  { id: 'power', name: 'Power', effect: 'Scales power plant output.' },
  { id: 'water', name: 'Water', effect: 'Scales pumping capacity.' },
  { id: 'sewage', name: 'Sewage', effect: 'Scales treatment capacity.' },
  { id: 'garbage', name: 'Garbage', effect: 'Scales collection trucks and capacity.' },
  { id: 'fire', name: 'Fire', effect: 'Scales fire coverage and engines.' },
  { id: 'police', name: 'Police', effect: 'Scales police coverage and patrols.' },
  { id: 'health', name: 'Health', effect: 'Scales clinic and hospital coverage and beds.' },
  { id: 'education', name: 'Education', effect: 'Scales school coverage and seats.' },
  { id: 'parks', name: 'Parks', effect: 'Scales how much parks lift their surroundings.' },
  { id: 'transit', name: 'Transit', effect: 'Scales bus frequency.' },
  { id: 'tourism', name: 'Tourism', effect: 'Scales how many visitors landmarks draw and hotels host.' },
  { id: 'trade', name: 'Trade and research', effect: 'Scales freight, mining, oil and research income.' },
];
export const FUNDING_MIN = 0;
export const FUNDING_MAX = 150;

/** Effectiveness from funding share f (1 = 100 %): full value up to 100 %, diminishing after. */
export function fundingEffect(f: number): number {
  return f <= 1 ? f : 1 + 0.5 * (f - 1);
}

/** Monthly payment of a loan repaid in equal instalments (shown on the loan buttons, P24). */
export function annuity(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}

export const LOAN_OPTIONS: {
  amount: number;
  annualRate: number;
  months: number;
  unlockPopulation: number;
}[] = [
  { amount: 25_000, annualRate: 0.05, months: 60, unlockPopulation: 0 },
  { amount: 50_000, annualRate: 0.06, months: 60, unlockPopulation: 0 },
  { amount: 100_000, annualRate: 0.075, months: 72, unlockPopulation: 800 },
  { amount: 250_000, annualRate: 0.085, months: 96, unlockPopulation: 10_000 },
];
export const MAX_LOANS = 3;

export type Difficulty = 'easy' | 'normal' | 'hard';

/** What each difficulty changes: starting money and the running costs of roads and buildings. */
export const DIFFICULTY: Record<Difficulty, { name: string; funds: number; upkeep: number; blurb: string }> =
  {
    easy: { name: 'Relaxed', funds: 100_000, upkeep: 0.8, blurb: 'More money to start and cheaper upkeep.' },
    normal: { name: 'Standard', funds: 60_000, upkeep: 1, blurb: 'The intended balance.' },
    hard: {
      name: 'Tough',
      funds: 35_000,
      upkeep: 1.25,
      blurb: 'Little money and dearer upkeep: plan carefully.',
    },
  };
export const SANDBOX_FUNDS = 999_999_999;

/**
 * Big-city running costs (Phase 2 review): past `from` residents, wages, land and overheads rise
 * with the city, so every department and the roads cost `1 + (population - from) / per` times as
 * much (×1.5 at 43,500, ×2 at 57,000, ×3 at 84,000). Towns never see it. Without it a built-out
 * city netted about $2.40 a resident a month at 6 % taxes (break-even near 2 %) with nothing left
 * to spend on; with it, a built-out city at 6 % runs close to even and the tax rate is the lever
 * both ways.
 */
export const BIG_CITY = { from: 30_000, per: 27_000 };

/** How much more a city of this many residents pays to run than a town (1 below `BIG_CITY.from`). */
export function bigCityFactor(population: number): number {
  return 1 + Math.max(0, population - BIG_CITY.from) / BIG_CITY.per;
}

export const BANKRUPTCY = {
  /** Hours the treasury may stay negative before the city is declared bankrupt (2 months). */
  graceHours: 48,
};

export const LEDGER_HISTORY_MONTHS = 24;

/** Ledger categories and their labels (anything else is labelled from its key). */
export const LEDGER_LABELS: Record<string, string> = {
  taxR0: 'Residential tax (low wealth)',
  taxR1: 'Residential tax (medium wealth)',
  taxR2: 'Residential tax (high wealth)',
  taxC0: 'Commercial tax (low wealth)',
  taxC1: 'Commercial tax (medium wealth)',
  taxC2: 'Commercial tax (high wealth)',
  taxI0: 'Industrial tax (heavy)',
  taxI1: 'Industrial tax (manufacturing)',
  taxI2: 'Industrial tax (high-tech)',
  trade: 'Trade and exports',
  loans: 'Loans received',
  refunds: 'Refunds',
  cheats: 'Grants (debug)',
  roads: 'Road construction',
  construction: 'Building construction',
  roadUpkeep: 'Road maintenance',
  // The roads department's own upkeep is its depots' (P19): "Road maintenance upkeep" read as the line above.
  'upkeep:roads': 'Public works depots',
  loanInterest: 'Loan interest',
  loanPrincipal: 'Loan repayments',
  policies: 'Policies',
  repairs: 'Disaster repairs',
  tourism: 'Tourism',
  resources: 'Ore and oil sales',
  technology: 'Research licences',
  projects: 'Big projects',
  grants: 'Regional grant (election)',
  imports: 'Bought from neighbours',
  exports: 'Sold to neighbours',
  landscaping: 'Landscaping',
};

export function ledgerLabel(key: string): string {
  if (LEDGER_LABELS[key]) return LEDGER_LABELS[key]!;
  if (key.startsWith('upkeep:')) {
    const d = DEPTS.find((x) => x.id === key.slice(7));
    return `${d?.name ?? key.slice(7)} upkeep`;
  }
  return key;
}
