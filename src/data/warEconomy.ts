/**
 * The war economy (phase 5, M38): stakes in a computer neighbour's industry, loans to allies, aid
 * to an ally's war. Every number the sim side (`src/sim/systems/warEconomy.ts`) uses is here, each
 * with what it means; docs/plans/M38-design.md has the calls behind them and docs/DECISIONS.md "M38"
 * the choices made while building. A "month" is a game day, a "year" twelve of them.
 *
 * Steps 6 to 8 add `WEARINESS`, `OFFERS` and `WAR_DIFFICULTY` at the end.
 */
import { DIPLOMATS } from './diplomacy';
import type { Difficulty } from './economy';
import type { NeighbourKind } from './region';
import { PERSONALITY, type Personality } from './war';

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

/**
 * Arms trade with allies (M38 step 4): munitions sold from the war stores, and units sold outright.
 * Only computer neighbours the city has an alliance or a defensive pact with buy (M36's `trade` term
 * only lifts an embargo and leaves no pact behind, so there is no trade pact to sell under until
 * friends can sign treaties in M39). An embargo or a sanction on either side ends it.
 */
export const ARMS = {
  /** Dollars an ally pays for a crate of munitions: about twice their local value ($20 in the stores). */
  price: 38,
  /** A deal is made in steps of this many crates a month, up to what the buyer takes. */
  step: 10,
  /** No deal is bigger than this many crates a month, whatever the town's size. */
  max: 300,
  /**
   * What a buyer takes a month, in crates per 1,000 residents, by character: warlike towns want the
   * most, careful and honourable ones the least. Deals go in steps of `step`, so the smallest towns
   * (2,000 residents) take none from the less warlike characters.
   */
  demand: {
    aggressive: 6,
    treacherous: 5,
    mercantile: 4,
    cautious: 3,
    honourable: 3,
  } as Record<Personality, number>,
  /**
   * An ally pays this share of a unit's price (its money cost, not its materials) for a unit at
   * full health, less for a hurt one; the unit leaves the city and the ally's forces rise by the
   * unit's strength (also by its health). The ally's forces then settle back towards what its
   * character keeps, as they do after any gift (`rivalsMonth`).
   */
  unitShare: 0.6,
} as const;

/**
 * Sanctions both ways (M38 step 5). A sanction ends the regional and arms deals between the two
 * and freezes the city's stakes and loans there (nothing new is bought, lent, sold or dealt either).
 * A "day" is a game month (24 game hours), as everywhere in the war rules.
 */
export const SANCTION = {
  /**
   * The city sanctions a neighbour (its choice, lifted when it likes): the neighbour's town grows
   * this much slower each month (added to its monthly growth) and arms at this share of its usual
   * pace, and it minds: its feelings towards the city fall by `relation` when the sanction begins.
   */
  growth: -0.005,
  arming: 0.8,
  relation: -15,
  /**
   * Computer neighbours sanction the city for these causes, each held as long as it is true:
   *  - it broke a pact with anyone (honourable and cautious ones only), for `lapseDays` days;
   *  - the neighbour is allied to one the city is at war with, until the war is over;
   *  - the city's reputation is below `reputation`.
   * A cause that has passed leaves the sanction standing `lapseDays` more days (the war's: none, it
   * is lifted at peace). A neighbour imposes one only on a city it does business with: one that has
   * nothing with it (no regional deal, arms deal, stake, loan or aid) has nothing to cut, but is
   * still refused new dealings while the cause holds.
   */
  // Below a single broken pact (60 − 30): one breach angers the honourable and cautious, a pattern
  // (a second breach, or a breach and a declared war) every neighbour.
  reputation: 25,
  lapseDays: 30,
  punishesBreaking: {
    aggressive: false,
    cautious: true,
    mercantile: false,
    honourable: true,
    treacherous: false,
  } as Record<Personality, boolean>,
} as const;

/**
 * War weariness (M38 step 6): the longer the city is at war the more tired its people are. It grows
 * each hour a war is open with the city (fighting, not paused by a ceasefire), faster in a total war
 * and when the war is going badly, and each raid on the city adds to it. It costs approval, and past
 * `growthFrom` it costs growth. After peace it falls, and the end of a war that tired the city gives a
 * short recovery. Hours are game hours and a "day" is a game month, as everywhere in the war rules;
 * the difficulty scales every rise (`WAR_DIFFICULTY.weariness`).
 */
export const WEARINESS = {
  /**
   * Added each hour of an open war, out of 1: about 0.012 a day, so a plain war of twenty days leaves
   * the city a quarter weary before its raids (at a month a game day, about an hour of play at 1×).
   */
  perHour: 0.0005,
  /** A total war counts this many times as much; so does a war being lost (below `losingBelow`). */
  total: 1.5,
  losing: 1.5,
  /** The war score (−100 to 100) at or below which the city counts as losing a war. */
  losingBelow: -15,
  /** Each raid on the city (a computer neighbour's or a friend's, once it arrives) adds this. */
  perRaid: 0.02,
  /** Falls this much each hour when no war is open: about 0.036 a day, from half to nothing in 14 days. */
  fallPerHour: 0.0015,
  /** Approval at full weariness (added to the city's cheer, in proportion). */
  approval: -0.12,
  /** Past this weariness homes grow less happy ("Tired of war"), by `growth` at full weariness. */
  growthFrom: 0.5,
  growth: -0.05,
  /**
   * Peace, or a war's end, with the city at least `minimum` weary: for `days` days it cheers by
   * `cheer`, easing back in a straight line. A city a war barely touched has nothing to recover from.
   */
  recovery: { days: 10, cheer: 0.05, minimum: 0.1 },
} as const;

/**
 * What the difficulty changes in a war (M38 step 8) with rivals on. Normal is exactly the war as
 * milestones 34 to 37 made it: every figure here is 1 (or 0) there, so it leaves the numbers alone.
 * (The forces' own upkeep already follows the difficulty through `DIFFICULTY.upkeep`, which
 * `upkeepScale` applies to roads, services and forces alike: nothing is added to it here.)
 */
export const WAR_DIFFICULTY: Record<
  Difficulty,
  {
    /** Rivals keep this share of the forces and defences their character calls for. */
    arming: number;
    /** Rivals' raids come this much as often. */
    raids: number;
    /** Added to every character's aggression (how readily it raids and declares, how little it wants peace). */
    aggression: number;
    /** What computer neighbours demand of the city in money (tribute) is multiplied by this. */
    terms: number;
    /** Weariness rises this much as fast. */
    weariness: number;
  }
> = {
  easy: { arming: 0.7, raids: 0.6, aggression: 0, terms: 0.7, weariness: 0.7 },
  normal: { arming: 1, raids: 1, aggression: 0, terms: 1, weariness: 1 },
  hard: { arming: 1.3, raids: 1.4, aggression: 0.1, terms: 1.4, weariness: 1.3 },
};

/**
 * Computer neighbours' offers to the city (M38 step 7): at most one a month, each candidate making
 * one with a chance of `chance` times its character's `PERSONALITY.trade`, from dice of their own
 * (`${seed}:econ:${month}`). Each stays open `openDays` days. The terms are reckoned from what the
 * sim knows of the neighbour and the city, and the offer can be taken or turned down.
 */
export const OFFERS = {
  chance: 0.3,
  openDays: 3,
  /** A neighbour that feels no better than this about the city offers nothing (as it sells no stake). */
  minRelation: INVEST.minRelation,
  /** An ally offers to buy munitions: this share of what its town takes (`armsCapacity`), by dice. */
  arms: { shares: [0.5, 0.75, 1] as readonly number[], minStock: 20 },
  /**
   * Investing in the city: a lump sum now for a share (percent) of its industrial tax for `months`
   * months. Only characters that `pays` (the share of the tax it will get in all that it pays now: it
   * wants a profit); never while the city is at war or the neighbour is at war with it. The city never
   * sells more than `maxShare` percent of its industrial tax in all, and nothing under `minTax` a month
   * is worth the trouble. The sum is never more than `meansMonths` months of the neighbour's own taxes.
   */
  invest: {
    shares: [10, 15, 20] as readonly number[],
    months: 24,
    pays: { aggressive: 0, cautious: 0.65, mercantile: 0.75, honourable: 0, treacherous: 0 } as Record<
      Personality,
      number
    >,
    maxShare: 30,
    minTax: 1_500,
    meansMonths: 12,
  },
  /**
   * Lending to the city when it's short of cash: the bank holds under `shortMonths` months of last
   * month's spending (and under `floor`). Repaid over `months` months like a bank loan, at a yearly
   * rate from the lender's character: `base` less `perTrade` for each point of its trade weight, plus
   * `perMoney` for each point its money weight is over 1 (the mercantile are cheapest). Never in
   * sandbox, where money isn't short. Never more than `meansMonths` months of the neighbour's taxes,
   * nor more than `taxMonths` months of the city's own (a lender lends against the borrower's means:
   * without it a town of a few hundred could borrow a quarter of a million in its first month).
   */
  loan: {
    amounts: [25_000, 50_000, 100_000, 250_000] as readonly number[],
    months: 24,
    shortMonths: 3,
    floor: 50_000,
    base: 0.1,
    perTrade: 0.05,
    perMoney: 0.02,
    meansMonths: 12,
    taxMonths: 10,
  },
} as const;

/** The yearly interest a neighbour of this character charges the city on a loan (to a tenth of a percent). */
export function offerRate(personality: Personality): number {
  const l = OFFERS.loan;
  const r =
    l.base - l.perTrade * PERSONALITY[personality].trade + l.perMoney * (DIPLOMATS[personality].money - 1);
  return Math.round(r * 1000) / 1000;
}
