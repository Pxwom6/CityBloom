/**
 * Elections (M17): every four game years the city votes, mostly on approval. Before each vote the
 * mayor may make up to two promises, which voters judge on the day. All balancing numbers here.
 */

export const ELECTIONS = {
  /** Months between votes (4 game years). */
  every: 48,
  /** The campaign (promises can be made) opens this many months before the vote. */
  campaign: 6,
  maxPromises: 2,
  /** Vote share: 50 % at this approval, moving this much per point of approval. */
  neutralApproval: 0.55,
  perApproval: 1.2,
  /** Share won or lost by a promise kept or broken. */
  kept: 0.04,
  broken: -0.06,
  /** Seeded swing on the day, ±. */
  swing: 0.02,
  /** Months a win's perk or a loss's limits last. */
  term: 12,
  /** Win: the region's grant ($ per resident) and a year's honeymoon on approval. */
  grantPerResident: 4,
  honeymoon: 0.03,
  /** A promise's thresholds: crime and air down by a fifth, commutes by a tenth, unemployment under 5 %. */
  crimeCut: 0.8,
  airCut: 0.8,
  commuteCut: 0.9,
  maxUnemployment: 0.05,
};

export type PromiseId = 'crime' | 'hospital' | 'commute' | 'air' | 'jobs' | 'taxes';

export interface PromiseDef {
  id: PromiseId;
  /** As the mayor says it. */
  text: string;
  /** How voters judge it, for the player. */
  test: string;
}

export const PROMISES: PromiseDef[] = [
  {
    id: 'crime',
    text: 'Cut crime by a fifth',
    test: 'Crime where people live is at least 20 % lower on election day than when promised.',
  },
  {
    id: 'hospital',
    text: 'Open a new hospital',
    test: 'A hospital opened after the promise and is running on election day.',
  },
  {
    id: 'commute',
    text: 'Shorter commutes',
    test: 'The average commute is at least 10 % shorter than when promised.',
  },
  {
    id: 'air',
    text: 'Cleaner air',
    test: 'Air pollution where people live is at least 20 % lower than when promised.',
  },
  {
    id: 'jobs',
    text: 'A job for everyone who wants one',
    test: 'Unemployment is under 5 % on election day.',
  },
  { id: 'taxes', text: 'No tax rises', test: 'No tax rate is higher on election day than when promised.' },
];
