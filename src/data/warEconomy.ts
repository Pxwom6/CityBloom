/**
 * The war economy (phase 5, M38): stakes in a computer neighbour's industry, loans to allies, aid
 * to an ally's war. Every number the sim side (`src/sim/systems/warEconomy.ts`) uses is here, each
 * with what it means; docs/plans/M38-design.md has the calls behind them and docs/DECISIONS.md "M38"
 * the choices made while building. A "month" is a game day, a "year" twelve of them.
 *
 * Later steps add their numbers beside these: `ARMS` (munitions deals, unit sales), `SANCTION`,
 * `WEARINESS` and `WAR_DIFFICULTY`.
 */
import { DIPLOMATS } from './diplomacy';
import type { NeighbourKind } from './region';
import type { Personality } from './war';

/** Stakes in a computer neighbour's industry. */
export const INVEST = {
  /**
   * What a neighbour's industry is worth, in dollars per resident of the town. Computer neighbours
   * keep no economy of their own, so this is reckoned from their kind and size: it rises and falls
   * with the town, and so does a stake's value.
   */
  perResident: { industrial: 120, suburb: 40, resort: 60 } as Record<NeighbourKind, number>,
  /** What the industry earns each month, as a share of its value: about 15 % a year. */
  yield: 0.012,
  /** Its earnings rise by this share for each step of weapons tech it has (0 to 4). */
  techBonus: 0.05,
  /** Its earnings fall by this share while it's blacked out or its power plant is sabotaged. */
  disrupted: 0.25,
  /** A stake is bought in steps of this many percent of the industry. */
  step: 5,
  /** The most of a town's industry the city may hold, in percent. */
  maxShare: 25,
  /**
   * The price over a stake's value: `max` when the neighbour only just sells (relation `from`),
   * falling in a straight line to nothing from relation `to` up. Friendly neighbours sell at value.
   */
  premium: { max: 0.2, from: -25, to: 60 },
  /** A neighbour sells only to a city it feels better than this about (hostile ones don't). */
  minRelation: -25,
  /** Selling a stake gets this share of its value. */
  sellShare: 0.9,
  /**
   * Which characters seize the city's stake in them when they declare war on it: the treacherous
   * strike when you least expect it, and keep what you paid. A stake is also seized when the city
   * capitulates to the neighbour (or falls to it), whatever its character.
   */
  seizes: {
    aggressive: false,
    cautious: false,
    mercantile: false,
    honourable: false,
    treacherous: true,
  } as Record<Personality, boolean>,
} as const;

/** Loans from the city to an ally (a neighbour it has an alliance or a defensive pact with). */
export const LENDING = {
  /** The sizes on offer. */
  amounts: [50_000, 150_000, 400_000] as readonly number[],
  /**
   * Repaid in equal monthly instalments over this many months (like a bank loan). An ally owes the
   * city one loan at a time, so with the region's three towns at most three loans are out.
   */
  months: 24,
  /**
   * The yearly interest, by how much the ally's character cares about money (`DIPLOMATS` money
   * weight): `minRate` at `lowMoney`, `maxRate` at `highMoney`, in a straight line between.
   */
  rate: { minRate: 0.04, maxRate: 0.09, lowMoney: 0.8, highMoney: 1.4 },
} as const;

/** The yearly interest an ally of this character pays on a loan from the city (to a tenth of a percent). */
export function lendingRate(personality: Personality): number {
  const r = LENDING.rate;
  const f = Math.max(
    0,
    Math.min(1, (DIPLOMATS[personality].money - r.lowMoney) / (r.highMoney - r.lowMoney)),
  );
  return Math.round((r.minRate + (r.maxRate - r.minRate) * f) * 1000) / 1000;
}

/** Funding an ally's war: money a month for an ally fighting at the city's side. */
export const WAR_AID = {
  /** The monthly sums on offer: `step` dollars up to `max` (0 stops). */
  step: 10_000,
  max: 100_000,
  /**
   * At full funding (`max`, paid every hour of the month) the ally closes the gap to its
   * character's forces this many times as fast, and its daily share of the war score counts this
   * many times. Less funding gives a proportionally smaller lift.
   */
  armsFactor: 2,
  scoreFactor: 2,
} as const;
