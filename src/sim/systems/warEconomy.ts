/**
 * The war economy (phase 5, M38), docs/plans/M38-design.md calls 2 to 5. A city at war with rivals
 * can put its money to work with the computer neighbours:
 *
 *  - stakes in a neighbour's industry, bought in steps and paying dividends every month, frozen
 *    while the city fights that neighbour (or either side sanctions the other) and seized when the
 *    city capitulates to it or a treacherous neighbour declares war;
 *  - loans to an ally (a neighbour it has an alliance or a defensive pact with), repaid with
 *    interest;
 *  - aid to an ally fighting at the city's side, which arms faster and counts for more in the war
 *    score.
 *
 * Everything lives in `WarState.economy`, which appears with the first stake, loan or aid: a
 * peaceful city, and a war city that never uses it, are unchanged. Money goes through `book` and
 * `accrue` like every other line; the rates are in `monthlyRates` (`warEconomyRates`).
 */
import { annuity } from '../../data/economy';
import { INVEST, LENDING, WAR_AID, lendingRate } from '../../data/warEconomy';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import type { Sim } from '../sim';
import { HOURS_PER_DAY, TICKS_PER_MONTH } from '../time';
import { accrue, book } from './economy';
import { anyWarOpen, fightingWith, helpers, note, pactsWith, warWith } from './diplomacy';
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
 * it ends. Stakes are paid back what was paid for them, loans what is still owed, aid stops.
 */
export function forgetEconomy(sim: Sim, id: number): void {
  const e = sim.state.war?.economy;
  if (!e) return;
  const stake = e.stakes[id];
  if (stake) {
    delete e.stakes[id];
    book(sim, 'stakeSold', stake.paid);
  }
  for (const loan of e.loans.filter((l) => l.with === id)) {
    e.loans = e.loans.filter((l) => l !== loan);
    book(sim, 'allyRepaid', Math.round(loan.balance));
  }
  delete e.aid[id];
  sim.warChanged();
}

// ----- Allies: loans and aid -----

/** A neighbour the city has an alliance or a defensive pact with (the pact stands). */
export function allied(sim: Sim, id: number): boolean {
  return pactsWith(sim, id, 'alliance').length > 0 || pactsWith(sim, id, 'defensivePact').length > 0;
}

/** Is this ally fighting at the city's side in a war now? */
export function helping(sim: Sim, id: number): boolean {
  return helpers(sim).some((h) => h.ally.id === id);
}

/** What the loan to this ally charges a year (by its character). */
export function loanRate(n: Neighbour): number {
  return lendingRate(n.rival!.personality);
}

/** The city can't lend this amount to this neighbour now, and why; null when it can. */
export function lendRefusal(sim: Sim, id: number, amount: number): string | null {
  const s = sim.state;
  if (!s.war) return 'War is off in this city';
  if (!LENDING.amounts.includes(amount)) return 'No such loan';
  const n = s.region.neighbours.find((x) => x.id === id);
  if (!n) return 'No such neighbour';
  if (n.player) return 'Loans to a friend come with treaties among friends (M39)';
  if (!n.rival) return `${n.name} isn’t a rival`;
  if (!allied(sim, id))
    return `${n.name} isn’t the city’s ally: loans go to a neighbour it has an alliance or a defensive pact with`;
  if (n.rival.vassal) return `${n.name} is the city’s vassal`;
  const frozen = frozenReason(sim, id, n.name, 'loan');
  if (frozen) return frozen;
  const owed = s.war.economy?.loans.find((l) => l.with === id);
  if (owed) return `${n.name} still owes the city ${money(owed.balance)}`;
  if (!s.options.sandbox && s.treasury < amount)
    return `Lending ${money(amount)} needs that much in the bank`;
  return null;
}

/** Lend an ally money, repaid with interest over two years (M38 call 4). */
export function lendAlly(sim: Sim, id: number, amount: number, dryRun: boolean): CommandResult {
  const why = lendRefusal(sim, id, amount);
  if (why) return fail(why);
  const n = computerNeighbour(sim, id)!;
  const rate = loanRate(n);
  const payment = annuity(amount, rate, LENDING.months);
  if (dryRun) return ok(amount, { info: { payment: Math.round(payment), rate } });
  const loan: AllyLoan = {
    id: sim.state.nextId++,
    with: id,
    principal: amount,
    annualRate: rate,
    months: LENDING.months,
    payment,
    balance: amount,
    takenTick: sim.state.tick,
  };
  economy(sim).loans.push(loan);
  book(sim, 'allyLent', -amount);
  sim.warChanged();
  return ok(amount, { created: [loan.id], info: { payment: Math.round(payment), rate } });
}

/** The city can't fund this ally's war at this sum now, and why; null when it can (0 stops). */
export function fundRefusal(sim: Sim, id: number, perMonth: number): string | null {
  const s = sim.state;
  if (!s.war) return 'War is off in this city';
  const n = s.region.neighbours.find((x) => x.id === id);
  if (!n) return 'No such neighbour';
  const aid = s.war.economy?.aid[id];
  if (perMonth === 0) return aid && aid.perMonth > 0 ? null : `The city isn’t funding ${n.name}’s war`;
  if (
    !Number.isInteger(perMonth) ||
    perMonth < WAR_AID.step ||
    perMonth > WAR_AID.max ||
    perMonth % WAR_AID.step !== 0
  )
    return `Aid is ${money(WAR_AID.step)} to ${money(WAR_AID.max)} a month, in steps of ${money(WAR_AID.step)}`;
  if (n.player) return 'Aid to a friend’s war comes with treaties among friends (M39)';
  if (!n.rival) return `${n.name} isn’t a rival`;
  if (!allied(sim, id))
    return `${n.name} isn’t the city’s ally: aid goes to a neighbour it has an alliance or a defensive pact with`;
  if (!anyWarOpen(sim)) return 'The city isn’t at war: there is no war to fund';
  if (!helping(sim, id)) return `${n.name} isn’t fighting at the city’s side in any war`;
  if (sanctionsBetween(sim, id)) return `Sanctions between the city and ${n.name} stand in the way`;
  return null;
}

/**
 * Fund an ally's war (M38 call 5): `perMonth` dollars a month for as long as it fights at the city's
 * side. It arms faster and counts for more in the war score; 0 stops the aid, which costs nothing.
 */
export function fundAlly(sim: Sim, id: number, perMonth: number, dryRun: boolean): CommandResult {
  const why = fundRefusal(sim, id, perMonth);
  if (why) return fail(why);
  if (dryRun) return ok(0);
  const e = economy(sim);
  const had = e.aid[id];
  // A stopped order stays until the month's lift is counted (the money paid so far still counts).
  if (had) had.perMonth = perMonth;
  else e.aid[id] = { perMonth, funded: 0, effect: 0 };
  sim.warChanged();
  return ok(0);
}

/** How much the aid sent to this neighbour last month lifted it, 0 to 1 (0 with none). */
export function aidEffect(sim: Sim, id: number): number {
  return sim.state.war?.economy?.aid[id]?.effect ?? 0;
}

// ----- Each hour and each month -----

/** Why a loan can no longer run, or null: the pact is over, or the borrower is the city's own now. */
function loanVoid(sim: Sim, loan: AllyLoan): string | null {
  const n = computerNeighbour(sim, loan.with);
  if (!n) return 'the town is gone';
  if (n.rival!.vassal) return `${n.name} has fallen to the city, so it is the city’s own`;
  if (!allied(sim, loan.with)) return `its pact with ${n.name} is over`;
  return null;
}

/** Monthly ledger lines from stakes, loans to allies and aid, at current conditions (for `monthlyRates`). */
export function warEconomyRates(sim: Sim): Record<string, number> {
  const e = sim.state.war?.economy;
  const out: Record<string, number> = {};
  if (!e) return out;
  const add = (k: string, v: number) => {
    if (v) out[k] = (out[k] ?? 0) + v;
  };
  for (const id of ids(e.stakes)) {
    const n = computerNeighbour(sim, id);
    if (n) add('dividends', stakeDividend(sim, n, e.stakes[id]!));
  }
  for (const loan of e.loans) {
    const n = computerNeighbour(sim, loan.with);
    if (!n || loanVoid(sim, loan) || frozenReason(sim, loan.with, n.name, 'loan')) continue;
    const interest = Math.min(loan.balance * (loan.annualRate / 12), loan.payment);
    add('allyInterest', interest);
    add('allyRepaid', Math.min(loan.balance, loan.payment - interest));
  }
  for (const id of ids(e.aid))
    if (e.aid[id]!.perMonth > 0 && helping(sim, id)) add('warAid', -e.aid[id]!.perMonth);
  return out;
}

/**
 * The war economy's hour, in the war hour after the money of the hour: allies' instalments (interest
 * first, then principal, like a loan) unless frozen, loans written off when the pact ends, aid
 * counted while the ally fights at the city's side.
 */
export function warEconomyHour(sim: Sim): void {
  const e = sim.state.war?.economy;
  if (!e) return;
  for (const loan of [...e.loans]) {
    const gone = loanVoid(sim, loan);
    const n = computerNeighbour(sim, loan.with);
    if (gone || !n) {
      e.loans = e.loans.filter((l) => l !== loan);
      note(
        sim,
        loan.with,
        'writtenOff',
        `The city writes off the ${money(loan.balance)} still owed by ${n?.name ?? 'a lost ally'}: ${gone ?? 'the town is gone'}`,
        'bad',
      );
      continue;
    }
    if (frozenReason(sim, loan.with, n.name, 'loan')) continue;
    const interest = (loan.balance * (loan.annualRate / 12)) / HOURS_PER_DAY;
    const pay = Math.min(loan.payment / HOURS_PER_DAY, loan.balance + interest);
    const principal = pay - interest;
    accrue(sim, 'allyInterest', interest);
    accrue(sim, 'allyRepaid', principal);
    loan.balance -= principal;
    if (loan.balance <= 0.5) {
      // Settle the last cents exactly so nothing is lost or created.
      accrue(sim, 'allyRepaid', loan.balance);
      e.loans = e.loans.filter((l) => l !== loan);
      note(sim, loan.with, 'loanRepaid', `${n.name} has repaid the city’s loan in full`, 'good');
    }
  }
  for (const id of ids(e.aid)) {
    const aid = e.aid[id]!;
    const n = computerNeighbour(sim, id);
    if (!n || n.rival!.vassal || !allied(sim, id)) {
      delete e.aid[id];
      if (n) note(sim, id, 'aidEnded', `The city’s aid to ${n.name} ends with their pact`);
      continue;
    }
    // Paid by the hour (the ledger's `warAid`), and counted as funding for the month's lift.
    if (aid.perMonth > 0 && helping(sim, id))
      aid.funded = Math.min(1, aid.funded + aid.perMonth / WAR_AID.max / HOURS_PER_DAY);
  }
}

/**
 * At the month's start, before the neighbours arm and the war score moves: last month's funding
 * becomes this month's lift. An order that was stopped stays one more month so its lift is read,
 * and goes at the next start (when it earned nothing).
 */
export function warEconomyMonth(sim: Sim): void {
  const e = sim.state.war?.economy;
  if (!e) return;
  for (const id of ids(e.aid)) {
    const aid = e.aid[id]!;
    aid.effect = Math.round(clamp(aid.funded, 0, 1) * 1000) / 1000;
    aid.funded = 0;
    if (aid.perMonth === 0 && aid.effect === 0) delete e.aid[id];
  }
  // Stakes follow the towns' growth: the page's figures change.
  if (ids(e.stakes).length || e.loans.length || ids(e.aid).length) sim.warChanged();
}

// ----- For the war room -----

export interface WarEconomySummary {
  /** Monthly lines at current conditions: dividends, allies' interest and repayments, aid sent (negative). */
  rates: { dividends: number; allyInterest: number; allyRepaid: number; warAid: number };
  /** What the city's stakes are worth now, and what its allies owe it. */
  worth: number;
  owed: number;
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
    /** An alliance or a defensive pact stands; why the smallest loan can't be made; the loan outstanding. */
    allied: boolean;
    rate: number;
    lend: string | null;
    loan: {
      id: number;
      principal: number;
      balance: number;
      payment: number;
      annualRate: number;
      monthsLeft: number;
      frozen: boolean;
    } | null;
    /** Fighting at the city's side now; aid sent a month (0 when none); the lift last month's gave; why aid can't be sent. */
    helping: boolean;
    aid: number;
    effect: number;
    fund: string | null;
  }[];
}

export function warEconomySummary(sim: Sim): WarEconomySummary | null {
  const s = sim.state;
  if (!s.war) return null;
  const e = s.war.economy;
  const rates = warEconomyRates(sim);
  const months = (tick: number) => Math.floor((s.tick - tick) / TICKS_PER_MONTH);
  let worth = 0;
  let owed = 0;
  const neighbours = s.region.neighbours
    .filter((n) => n.rival && !n.player)
    .map((n) => {
      const stake = e?.stakes[n.id];
      const loan = e?.loans.find((l) => l.with === n.id);
      const aid = e?.aid[n.id];
      const w = stake ? stakeWorth(n, stake.share) : 0;
      worth += w;
      owed += loan ? loan.balance : 0;
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
        allied: allied(sim, n.id),
        rate: loanRate(n),
        lend: lendRefusal(sim, n.id, LENDING.amounts[0]!),
        loan: loan
          ? {
              id: loan.id,
              principal: loan.principal,
              balance: Math.round(loan.balance),
              payment: Math.round(loan.payment),
              annualRate: loan.annualRate,
              monthsLeft: Math.max(0, loan.months - months(loan.takenTick)),
              frozen: !!frozenReason(sim, n.id, n.name, 'loan'),
            }
          : null,
        helping: helping(sim, n.id),
        aid: aid?.perMonth ?? 0,
        effect: aid?.effect ?? 0,
        fund: fundRefusal(sim, n.id, WAR_AID.step),
      };
    });
  return {
    rates: {
      dividends: Math.round(rates.dividends ?? 0),
      allyInterest: Math.round(rates.allyInterest ?? 0),
      allyRepaid: Math.round(rates.allyRepaid ?? 0),
      warAid: Math.round(rates.warAid ?? 0),
    },
    worth,
    owed: Math.round(owed),
    neighbours,
  };
}
