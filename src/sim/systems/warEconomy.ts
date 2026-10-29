/**
 * The war economy (phase 5, M38), docs/plans/M38-design.md calls 2 to 5: stakes in a computer
 * neighbour's industry, loans to allies, and aid to an ally's war. Everything lives in
 * `WarState.economy`, which appears with the first stake, loan or aid: a peaceful city, and a war
 * city that never uses it, are unchanged. Numbers are in `src/data/warEconomy.ts`.
 */

/** The city's stake in a computer neighbour's industry. */
export interface Stake {
  /** Percent of the industry the city holds (a multiple of `INVEST.step`, `INVEST.maxShare` at most). */
  share: number;
  /** Dollars paid for it in all. */
  paid: number;
  /** Tick of the first purchase. */
  since: number;
}

/** A loan from the city to an ally, repaid in monthly instalments like a bank loan. */
export interface AllyLoan {
  id: number;
  /** The borrowing neighbour. */
  with: number;
  principal: number;
  annualRate: number;
  months: number;
  /** Monthly instalment (annuity). */
  payment: number;
  /** Outstanding principal. */
  balance: number;
  takenTick: number;
}

/** Money sent each month to an ally fighting at the city's side. */
export interface Aid {
  /** Dollars a month (0 once stopped; the record stays until the lift it earned has been read). */
  perMonth: number;
  /** Funding this month so far as a share of a month at `WAR_AID.max` (0 to 1). */
  funded: number;
  /** The lift last month's funding gave, 0 to 1: read when neighbours arm and the war score moves. */
  effect: number;
}

export interface WarEconomy {
  /** By neighbour id. */
  stakes: Record<number, Stake>;
  loans: AllyLoan[];
  /** By neighbour id. */
  aid: Record<number, Aid>;
}
