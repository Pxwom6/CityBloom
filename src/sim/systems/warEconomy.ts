/**
 * The war economy (phase 5, M38), docs/plans/M38-design.md calls 2 and 3. A city at war with rivals
 * can put its money to work with the computer neighbours:
 *
 *  - stakes in a neighbour's industry, bought in steps and paying dividends every month, frozen
 *    while the city fights that neighbour (or either side sanctions the other) and seized when the
 *    city capitulates to it or a treacherous neighbour declares war;
 *
 * Everything lives in `WarState.economy`, which appears with the first stake, loan or aid: a
 * peaceful city, and a war city that never uses it, are unchanged. Money goes through `book` and
 * `accrue` like every other line; the rates are in `monthlyRates` (`warEconomyRates`).
 */
import { INVEST } from '../../data/warEconomy';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import type { Sim } from '../sim';
import { book } from './economy';
import { fightingWith, note, warWith } from './diplomacy';
import { powerSabotaged } from './intel';
import type { Neighbour } from './region';
import { rivalBlackedOut } from './supers';

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

const money = (v: number) => `$${formatInt(Math.round(v))}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ids = (o: Record<number, unknown>): number[] => Object.keys(o).map(Number);

/** The war economy, made on first use (never in a dry run). */
function economy(sim: Sim): WarEconomy {
  return (sim.state.war!.economy ??= { stakes: {}, loans: [], aid: {} });
}

/** A computer neighbour by id (friends' cities are not invested in until M39). */
function computerNeighbour(sim: Sim, id: number): Neighbour | undefined {
  const n = sim.state.region.neighbours.find((x) => x.id === id);
  return n?.rival && !n.player ? n : undefined;
}

// ----- Industry, stakes and what they're worth -----

/** What a computer neighbour's industry is worth (dollars): its town's size times its kind's figure. */
export function industryValue(n: Neighbour): number {
  return Math.round(n.population * INVEST.perResident[n.kind]);
}

/** What the whole industry earns a month: better with weapons tech, worse in a blackout or with its power out. */
export function industryEarnings(sim: Sim, n: Neighbour): number {
  let e = industryValue(n) * INVEST.yield * (1 + INVEST.techBonus * (n.rival?.tech ?? 0));
  if (rivalBlackedOut(sim, n) || powerSabotaged(sim, n)) e *= 1 - INVEST.disrupted;
  return e;
}

/** What `share` percent of a neighbour's industry is worth now. */
export function stakeWorth(n: Neighbour, share: number): number {
  return Math.round((industryValue(n) * share) / 100);
}

/** The share over value a neighbour asks for a stake: most when it only just sells, nothing when it likes the city. */
export function stakePremium(n: Neighbour): number {
  const p = INVEST.premium;
  return p.max * clamp((p.to - (n.rival?.relation ?? 0)) / (p.to - p.from), 0, 1);
}

/** What `share` percent costs now. */
export function stakePrice(n: Neighbour, share: number): number {
  return Math.round(stakeWorth(n, share) * (1 + stakePremium(n)));
}

/** What selling a stake of `share` percent brings now. */
export function stakeSale(n: Neighbour, share: number): number {
  return Math.round(stakeWorth(n, share) * INVEST.sellShare);
}

/**
 * Do sanctions stand between the city and this neighbour, from either side? The hook M38's
 * sanctions (step 5) fill in: stakes and loans freeze, and nothing new is bought or lent, while it
 * is true. There are none yet.
 */
export function sanctionsBetween(_sim: Sim, _id: number): boolean {
  return false;
}

/**
 * Why the city's money in this neighbour (a stake, a loan) is frozen, or null: the city is fighting
 * it (an open war, not paused by a ceasefire or ended by a capitulation), or sanctions stand between
 * them. Peace thaws it.
 */
export function frozenReason(sim: Sim, id: number, name: string, what = 'stake'): string | null {
  if (fightingWith(sim, id))
    return `The city is fighting ${name}: its ${what} there is frozen until the fighting stops`;
  if (sanctionsBetween(sim, id)) return `Sanctions between the city and ${name} freeze its ${what} there`;
  return null;
}

/** Dividends a month from the city's stake in a neighbour now (0 when frozen). */
export function stakeDividend(sim: Sim, n: Neighbour, stake: Stake): number {
  if (frozenReason(sim, n.id, n.name)) return 0;
  return (industryEarnings(sim, n) * stake.share) / 100;
}

/** The stake of `share` percent can't be bought now, and why; null when it can. */
export function buyRefusal(sim: Sim, id: number, share: number): string | null {
  const s = sim.state;
  if (!s.war) return 'War is off in this city';
  if (!Number.isInteger(share) || share < INVEST.step || share % INVEST.step !== 0 || share > INVEST.maxShare)
    return `A stake is bought in steps of ${INVEST.step}%, up to ${INVEST.maxShare}%`;
  const n = s.region.neighbours.find((x) => x.id === id);
  if (!n) return 'No such neighbour';
  if (n.player) return 'Stakes in a friend’s city come with treaties among friends (M39)';
  if (!n.rival) return `${n.name} isn’t a rival`;
  if (warWith(sim, id)) return `The city is at war with ${n.name}: it sells no stakes in its industry`;
  if (sanctionsBetween(sim, id)) return `Sanctions between the city and ${n.name} stand in the way`;
  if (n.rival.relation <= INVEST.minRelation)
    return `${n.name} won’t sell a stake to a city it distrusts: its feelings must be above ${INVEST.minRelation}`;
  const held = s.war.economy?.stakes[id]?.share ?? 0;
  if (held + share > INVEST.maxShare)
    return held
      ? `The city holds ${held}% of ${n.name}’s industry: ${INVEST.maxShare}% at most`
      : `${INVEST.maxShare}% of a town’s industry at most`;
  const price = stakePrice(n, share);
  if (!s.options.sandbox && s.treasury < price)
    return `A ${share}% stake in ${n.name}’s industry costs ${money(price)}`;
  return null;
}

/** Buy `share` percent more of a computer neighbour's industry (M38 call 3). */
export function buyStake(sim: Sim, id: number, share: number, dryRun: boolean): CommandResult {
  const why = buyRefusal(sim, id, share);
  if (why) return fail(why);
  const n = computerNeighbour(sim, id)!;
  const price = stakePrice(n, share);
  if (dryRun) return ok(price);
  const e = economy(sim);
  const had = e.stakes[id];
  e.stakes[id] = {
    share: (had?.share ?? 0) + share,
    paid: (had?.paid ?? 0) + price,
    since: had?.since ?? sim.state.tick,
  };
  book(sim, 'stakeBought', -price);
  sim.warChanged();
  return ok(price, { info: { share: e.stakes[id]!.share, price } });
}

/** The stake can't be sold now, and why; null when it can. */
export function sellRefusal(sim: Sim, id: number): string | null {
  const s = sim.state;
  if (!s.war) return 'War is off in this city';
  const stake = s.war.economy?.stakes[id];
  const n = s.region.neighbours.find((x) => x.id === id);
  if (!stake) return n ? `The city holds no stake in ${n.name}’s industry` : 'No such neighbour';
  if (!n) return 'No such neighbour';
  return frozenReason(sim, id, n.name);
}

/** Sell the whole stake in a neighbour's industry back for 90 % of its value. */
export function sellStake(sim: Sim, id: number, dryRun: boolean): CommandResult {
  const why = sellRefusal(sim, id);
  if (why) return fail(why);
  const e = sim.state.war!.economy!;
  const stake = e.stakes[id]!;
  const n = sim.state.region.neighbours.find((x) => x.id === id)!;
  const proceeds = stakeSale(n, stake.share);
  if (dryRun) return ok(-proceeds);
  delete e.stakes[id];
  book(sim, 'stakeSold', proceeds);
  sim.warChanged();
  return ok(-proceeds, { info: { proceeds } });
}

/**
 * The neighbour takes the city's stake in its industry (the city capitulated to it or fell to it; a
 * treacherous one declared war): no money back.
 */
export function seizeStakes(sim: Sim, n: Neighbour, when: string): void {
  const e = sim.state.war?.economy;
  const stake = e?.stakes[n.id];
  if (!e || !stake) return;
  const worth = stakeWorth(n, stake.share);
  delete e.stakes[n.id];
  note(
    sim,
    n.id,
    'seized',
    `${n.name} seizes the city’s ${stake.share}% stake in its industry (worth ${money(worth)}) ${when}`,
    'bad',
  );
}

/**
 * A computer neighbour is replaced by a friend's city in a shared region: whatever the city had in
 * it ends. A stake is paid back what was paid for it.
 */
export function forgetEconomy(sim: Sim, id: number): void {
  const e = sim.state.war?.economy;
  const stake = e?.stakes[id];
  if (!e || !stake) return;
  delete e.stakes[id];
  book(sim, 'stakeSold', stake.paid);
  sim.warChanged();
}

// ----- Each month -----

/** Monthly ledger lines from stakes at current conditions (for `monthlyRates`). */
export function warEconomyRates(sim: Sim): Record<string, number> {
  const e = sim.state.war?.economy;
  const out: Record<string, number> = {};
  if (!e) return out;
  for (const id of ids(e.stakes)) {
    const n = computerNeighbour(sim, id);
    if (n) {
      const v = stakeDividend(sim, n, e.stakes[id]!);
      if (v) out.dividends = (out.dividends ?? 0) + v;
    }
  }
  return out;
}

/**
 * At the month's start: the neighbours' towns have grown or shrunk, so the stakes' worth and the page's
 * figures change.
 */
export function warEconomyMonth(sim: Sim): void {
  const e = sim.state.war?.economy;
  if (e && ids(e.stakes).length) sim.warChanged();
}

// ----- For the war room -----

export interface WarEconomySummary {
  /** Monthly lines at current conditions: dividends from the stakes. */
  rates: { dividends: number };
  /** What the city's stakes are worth now. */
  worth: number;
  /** One row for each computer neighbour. */
  neighbours: {
    id: number;
    name: string;
    kind: string;
    personality: string;
    relation: number;
    population: number;
    /** The industry's value and monthly earnings now. */
    industry: number;
    earnings: number;
    /** The city's stake: percent held, dollars paid, worth now, dividends a month now, why frozen. */
    held: number;
    paid: number;
    worth: number;
    dividend: number;
    frozen: string | null;
    /** One step (`INVEST.step` %) costs this now, and why it can't be bought; selling brings this, and why it can't. */
    price: number;
    buy: string | null;
    sale: number;
    sell: string | null;
  }[];
}

export function warEconomySummary(sim: Sim): WarEconomySummary | null {
  const s = sim.state;
  if (!s.war) return null;
  const e = s.war.economy;
  const rates = warEconomyRates(sim);
  let worth = 0;
  const neighbours = s.region.neighbours
    .filter((n) => n.rival && !n.player)
    .map((n) => {
      const stake = e?.stakes[n.id];
      const w = stake ? stakeWorth(n, stake.share) : 0;
      worth += w;
      return {
        id: n.id,
        name: n.name,
        kind: n.kind,
        personality: n.rival!.personality,
        relation: Math.round(n.rival!.relation),
        population: n.population,
        industry: industryValue(n),
        earnings: Math.round(industryEarnings(sim, n)),
        held: stake?.share ?? 0,
        paid: stake?.paid ?? 0,
        worth: w,
        dividend: stake ? Math.round(stakeDividend(sim, n, stake)) : 0,
        frozen: stake ? frozenReason(sim, n.id, n.name) : null,
        price: stakePrice(n, INVEST.step),
        buy: buyRefusal(sim, n.id, INVEST.step),
        sale: stake ? stakeSale(n, stake.share) : 0,
        sell: stake ? sellRefusal(sim, n.id) : null,
      };
    });
  return { rates: { dividends: Math.round(rates.dividends ?? 0) }, worth, neighbours };
}
