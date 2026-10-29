/**
 * Computer neighbours' offers to the city (phase 5, M38 step 7, docs/plans/M38-design.md call 9).
 * Each month, perhaps one neighbour puts an offer to the city, by its character: an ally to buy
 * munitions, a mercantile or cautious neighbour to invest in the city's industry, a lender to lend
 * the city money when it is short of cash. The city answers with `answerOffer`; an offer stays open
 * for `OFFERS.openDays` days, then lapses. What is agreed runs on as the other war-economy lines do:
 * an arms deal as step 4's, an investment as a share of the city's industrial taxes paid out by the
 * hour for the term, a loan from a neighbour repaid like a bank loan.
 *
 * The dice are their own (`${seed}:econ:${month}`), so a neighbour's offers never move any other
 * stream. Everything lives in `WarEconomy` (`offers`, `investors`, `debts`) and appears with the
 * first offer: a city at peace, and a war city nobody offers anything to, are unchanged. Money goes
 * through `book` and `accrue`, and every refusal says why in plain words.
 */
import { annuity } from '../../data/economy';
import { ARMS, OFFERS, offerRate } from '../../data/warEconomy';
import { PERSONALITY } from '../../data/war';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { HOURS_PER_DAY, TICKS_PER_MONTH, dateOf } from '../time';
import { anyWarOpen, monthlyTaxes, neighbourTaxes, note, warWith } from './diplomacy';
import { accrue, book } from './economy';
import type { Neighbour } from './region';
import {
  armsBuyerRefusal,
  armsCapacity,
  armsDealRefusal,
  economy,
  makeArmsDeal,
  tradeStopped,
} from './warEconomy';

/** What a neighbour can offer. */
export type OfferKind = 'arms' | 'invest' | 'loan';
export const OFFER_KINDS: readonly OfferKind[] = ['arms', 'invest', 'loan'];

/** The terms of an offer, by kind. */
export type OfferTerms =
  /** To buy `crates` of munitions a month, at the arms price. */
  | { kind: 'arms'; crates: number }
  /** To pay `amount` dollars now for `share` percent of the city's industrial taxes for `months` months. */
  | { kind: 'invest'; amount: number; share: number; months: number }
  /** To lend `amount` dollars at a yearly `rate`, repaid over `months` months. */
  | { kind: 'loan'; amount: number; rate: number; months: number };

/** An offer waiting for the city's answer. */
export type Offer = { id: number; from: number; made: number; expires: number } & OfferTerms;

/** A neighbour's investment in the city: it takes `share` percent of its industrial taxes until `until`. */
export interface Investment {
  id: number;
  from: number;
  /** The neighbour's name when it invested (the record outlives a town that is replaced). */
  name: string;
  amount: number;
  share: number;
  months: number;
  since: number;
  until: number;
}

/** A loan from a neighbour to the city, repaid in instalments like a bank loan. */
export interface Debt {
  id: number;
  from: number;
  name: string;
  principal: number;
  annualRate: number;
  months: number;
  payment: number;
  balance: number;
  takenTick: number;
}

const money = (v: number) => `$${formatInt(Math.round(v))}`;
const percent = (v: number) => `${Math.round(v * 1000) / 10}%`;

/**
 * The next id for an offer, an investment or a loan from a neighbour. They count in the war economy,
 * not in the city's shared counter: an offer that lapses unanswered must not shift the id of every
 * building, unit and war made after it (battles are seeded by those ids).
 */
function nextId(sim: Sim): number {
  const e = economy(sim);
  e.seq = (e.seq ?? 0) + 1;
  return e.seq;
}

/** A computer neighbour by id (friends' cities make no offers until M39). */
function computerNeighbour(sim: Sim, id: number): Neighbour | undefined {
  const n = sim.state.region.neighbours.find((x) => x.id === id);
  return n?.rival && !n.player ? n : undefined;
}

/** The city's industrial taxes a month: last month's, or this month's so far in its first. */
export function industrialTaxes(sim: Sim): number {
  const e = sim.state.economy;
  const lines = e.history.at(-1)?.lines ?? e.month;
  let t = 0;
  for (const [k, v] of Object.entries(lines)) if (k.startsWith('taxI')) t += v;
  return Math.max(0, Math.round(t));
}

/** What the city spends a month: last month's outgoings, or this month's so far in its first. */
export function monthlySpending(sim: Sim): number {
  const e = sim.state.economy;
  const lines = e.history.at(-1)?.lines ?? e.month;
  let t = 0;
  for (const v of Object.values(lines)) if (v < 0) t -= v;
  return Math.round(t);
}

/** The cash below which the city counts as short (lenders come forward). */
export function cashFloor(sim: Sim): number {
  return Math.max(OFFERS.loan.floor, OFFERS.loan.shortMonths * monthlySpending(sim));
}

/** Percent of the city's industrial taxes already sold to investors. */
export function investedShare(sim: Sim): number {
  return (sim.state.war?.economy?.investors ?? []).reduce((a, i) => a + i.share, 0);
}

// ----- Making offers -----

/** Why a neighbour makes no offer to the city now, whatever the kind, or null. */
function offerBlock(sim: Sim, n: Neighbour): string | null {
  const r = n.rival;
  if (!r || n.player) return `${n.name} is a friend’s city`;
  if (r.vassal) return `${n.name} is the city’s vassal`;
  if (warWith(sim, n.id)) return `The city is at war with ${n.name}`;
  if (r.relation <= OFFERS.minRelation) return `${n.name} doesn’t trust the city enough to deal with it`;
  return tradeStopped(sim, n.id);
}

/**
 * The terms this neighbour would offer now, or why it wouldn't (plain words). `pick(n)` chooses one of
 * `n` alternatives (the dice, or a fixed choice for a check).
 */
export function offerTerms(
  sim: Sim,
  n: Neighbour,
  kind: OfferKind,
  pick: (n: number) => number,
): OfferTerms | string {
  const s = sim.state;
  const w = s.war;
  const r = n.rival;
  if (!w || !r) return 'War is off in this city';
  const blocked = offerBlock(sim, n);
  if (blocked) return blocked;
  const e = w.economy;
  if (kind === 'arms') {
    const why = armsBuyerRefusal(sim, n.id);
    if (why) return why;
    if (e?.arms?.[n.id]) return `The city already sells ${n.name} munitions`;
    const cap = armsCapacity(n);
    if (cap < ARMS.step) return `${n.name} is too small to buy munitions`;
    if (w.stock.munitions < OFFERS.arms.minStock) return 'The war stores hold too few crates to sell';
    const share = OFFERS.arms.shares[pick(OFFERS.arms.shares.length)]!;
    return { kind, crates: Math.max(ARMS.step, Math.floor((cap * share) / ARMS.step) * ARMS.step) };
  }
  if (s.options.sandbox) return 'Money is no object in a sandbox city';
  if (kind === 'invest') {
    const I = OFFERS.invest;
    const pays = I.pays[r.personality];
    if (!pays) return `${n.name} doesn’t invest abroad`;
    if (anyWarOpen(sim)) return 'No one invests in a city at war';
    if (e?.investors?.some((i) => i.from === n.id)) return `${n.name} has invested in the city already`;
    const share = I.shares[pick(I.shares.length)]!;
    if (investedShare(sim) + share > I.maxShare)
      return `${I.maxShare}% of the city’s industrial taxes is the most to sell`;
    const tax = industrialTaxes(sim);
    if (tax < I.minTax)
      return `The city’s industrial taxes (${money(tax)} a month) are too small to interest ${n.name}`;
    const means = Math.floor((neighbourTaxes(n) * I.meansMonths) / 100) * 100;
    const amount = Math.min(means, Math.round((share * tax * I.months * pays) / 100 / 100) * 100);
    if (amount < 1_000) return `${n.name} is too small to invest in the city`;
    return { kind, amount, share, months: I.months };
  }
  const L = OFFERS.loan;
  if (e?.debts?.some((d) => d.from === n.id)) return `The city still owes ${n.name}`;
  const need = cashFloor(sim);
  if (s.treasury >= need) return 'The city isn’t short of cash';
  const theirs = neighbourTaxes(n) * L.meansMonths;
  const ours = monthlyTaxes(sim) * L.taxMonths;
  const fits = L.amounts.filter((a) => a <= Math.min(theirs, ours));
  if (!fits.length)
    return ours < L.amounts[0]!
      ? 'The city’s taxes are too small for anyone to lend against'
      : `${n.name} is too small to lend the city anything`;
  const amount = fits.find((a) => a >= need - s.treasury) ?? fits[fits.length - 1]!;
  return { kind, amount, rate: offerRate(r.personality), months: L.months };
}

/** An offer in words, for the notice and the war room. */
export function offerText(n: Neighbour, o: OfferTerms): string {
  switch (o.kind) {
    case 'arms':
      return `${n.name} offers to buy ${o.crates} crates of munitions a month at ${money(ARMS.price)} a crate`;
    case 'invest':
      return `${n.name} offers ${money(o.amount)} for ${o.share}% of the city’s industrial taxes for ${o.months} months`;
    case 'loan':
      return `${n.name} offers to lend the city ${money(o.amount)} at ${percent(o.rate)} a year, repaid over ${o.months} months`;
  }
}

/** Put an offer to the city (it stays open for `OFFERS.openDays` days). */
function makeOffer(sim: Sim, n: Neighbour, terms: OfferTerms): Offer {
  const s = sim.state;
  const offer = {
    id: nextId(sim),
    from: n.id,
    made: s.tick,
    expires: s.tick + OFFERS.openDays * TICKS_PER_MONTH,
    ...terms,
  } as Offer;
  (economy(sim).offers ??= []).push(offer);
  note(sim, n.id, 'offer', offerText(n, terms), undefined, { offer: offer.id, kind: terms.kind });
  return offer;
}

/**
 * Each month (at its start): perhaps one neighbour makes the city an offer. Every neighbour with
 * something to offer rolls once for each kind, with a chance of `OFFERS.chance` times its character's
 * trade weight; of those that came up, one is picked by the same dice.
 */
export function offersMonth(sim: Sim): void {
  const s = sim.state;
  if (!s.war) return;
  const rng = Rng.fromSeed(`${s.options.seed}:econ:${dateOf(s.tick).totalMonths}`);
  const open = s.war.economy?.offers ?? [];
  const tries: { n: Neighbour; kind: OfferKind }[] = [];
  for (const n of s.region.neighbours) {
    if (!n.rival || n.player || open.some((o) => o.from === n.id)) continue;
    if (offerBlock(sim, n)) continue;
    const trade = PERSONALITY[n.rival.personality].trade;
    for (const kind of OFFER_KINDS) {
      if (typeof offerTerms(sim, n, kind, () => 0) === 'string') continue;
      if (rng.chance(OFFERS.chance * trade)) tries.push({ n, kind });
    }
  }
  if (!tries.length) return;
  const t = tries[rng.int(tries.length)]!;
  const terms = offerTerms(sim, t.n, t.kind, (len) => rng.int(len));
  if (typeof terms !== 'string') makeOffer(sim, t.n, terms);
}

/** Test mode: a neighbour makes the city this kind of offer now (the `offer` cheat). */
export function offerCheat(sim: Sim, id: number, kind: OfferKind, dryRun: boolean): CommandResult {
  if (!sim.state.war) return fail('War is off in this city');
  const n = computerNeighbour(sim, id);
  if (!n) return fail('No such rival');
  if (!OFFER_KINDS.includes(kind)) return fail('No such offer');
  const terms = offerTerms(sim, n, kind, () => 0);
  if (typeof terms === 'string') return fail(terms);
  if (dryRun) return ok(0);
  const offer = makeOffer(sim, n, terms);
  return ok(0, { created: [offer.id] });
}

// ----- Answering -----

/** Why the city can't take this offer now, or null (the terms stand as they were made; the world may not). */
export function acceptRefusal(sim: Sim, o: Offer): string | null {
  const n = computerNeighbour(sim, o.from);
  if (!n) return 'The town that made the offer is gone';
  const blocked = offerBlock(sim, n);
  if (blocked) return blocked;
  const e = sim.state.war!.economy;
  switch (o.kind) {
    case 'arms':
      return (
        armsDealRefusal(sim, o.from, o.crates) ??
        (e?.arms?.[o.from] ? `The city already sells ${n.name} munitions` : null)
      );
    case 'invest': {
      if (anyWarOpen(sim)) return 'No one invests in a city at war';
      if (e?.investors?.some((i) => i.from === n.id)) return `${n.name} has invested in the city already`;
      if (investedShare(sim) + o.share > OFFERS.invest.maxShare)
        return `${OFFERS.invest.maxShare}% of the city’s industrial taxes is the most to sell`;
      return null;
    }
    case 'loan':
      return e?.debts?.some((d) => d.from === n.id) ? `The city still owes ${n.name}` : null;
  }
}

/** The city answers an offer: takes it up or turns it down. */
export function answerOffer(sim: Sim, id: number, accept: boolean, dryRun: boolean): CommandResult {
  const w = sim.state.war;
  if (!w) return fail('War is off in this city');
  const e = w.economy;
  const o = e?.offers?.find((x) => x.id === id);
  if (!e || !o) return fail('That offer is gone');
  const n = computerNeighbour(sim, o.from);
  if (accept) {
    const why = acceptRefusal(sim, o);
    if (why) return fail(why);
  }
  if (dryRun) return ok(0);
  e.offers = e.offers!.filter((x) => x !== o);
  if (!e.offers.length) delete e.offers;
  const name = n?.name ?? 'The town';
  if (!accept) {
    note(sim, o.from, 'offerDeclined', `The city turns down ${name}’s offer`);
    return ok(0);
  }
  const s = sim.state;
  switch (o.kind) {
    case 'arms':
      makeArmsDeal(sim, o.from, o.crates);
      note(
        sim,
        o.from,
        'offerAccepted',
        `The city agrees to sell ${name} ${o.crates} crates of munitions a month`,
        'good',
      );
      break;
    case 'invest': {
      const inv: Investment = {
        id: nextId(sim),
        from: o.from,
        name,
        amount: o.amount,
        share: o.share,
        months: o.months,
        since: s.tick,
        until: s.tick + o.months * TICKS_PER_MONTH,
      };
      (e.investors ??= []).push(inv);
      book(sim, 'investment', o.amount);
      note(
        sim,
        o.from,
        'offerAccepted',
        `${name} invests ${money(o.amount)} in the city and takes ${o.share}% of its industrial taxes for ${o.months} months`,
        'good',
      );
      break;
    }
    case 'loan': {
      const payment = annuity(o.amount, o.rate, o.months);
      (e.debts ??= []).push({
        id: nextId(sim),
        from: o.from,
        name,
        principal: o.amount,
        annualRate: o.rate,
        months: o.months,
        payment,
        balance: o.amount,
        takenTick: s.tick,
      });
      book(sim, 'lenderLoan', o.amount);
      note(
        sim,
        o.from,
        'offerAccepted',
        `${name} lends the city ${money(o.amount)} at ${percent(o.rate)} a year`,
        'good',
      );
      break;
    }
  }
  sim.warChanged();
  return ok(0, { info: { kind: o.kind } });
}

// ----- Each hour, and the ledger -----

/** Why a record of the neighbour's can no longer run: the town fell to the city, so it is the city's own. */
function fallen(sim: Sim, id: number): boolean {
  return !!computerNeighbour(sim, id)?.rival?.vassal;
}

/** Offers expire, an investment ends or is wiped, and instalments on loans from neighbours are paid. */
export function offersHour(sim: Sim): void {
  const e = sim.state.war?.economy;
  if (!e) return;
  const s = sim.state;
  for (const o of [...(e.offers ?? [])]) {
    const n = computerNeighbour(sim, o.from);
    const gone = !n || n.rival!.vassal;
    if (!gone && s.tick < o.expires) continue;
    e.offers = e.offers!.filter((x) => x !== o);
    if (!e.offers.length) delete e.offers;
    if (gone) sim.warChanged();
    else note(sim, o.from, 'offerLapsed', `The offer from ${n!.name} lapses: the city didn’t answer in time`);
  }
  for (const inv of [...(e.investors ?? [])]) {
    const wiped = fallen(sim, inv.from);
    if (!wiped && s.tick < inv.until) continue;
    e.investors = e.investors!.filter((x) => x !== inv);
    if (!e.investors.length) delete e.investors;
    note(
      sim,
      inv.from,
      'investmentEnded',
      wiped
        ? `${inv.name} has fallen to the city: its share of the city’s industrial taxes is the city’s again`
        : `${inv.name}’s investment has run its term: its share of the city’s industrial taxes ends`,
      'good',
    );
  }
  for (const debt of [...(e.debts ?? [])]) {
    if (fallen(sim, debt.from)) {
      e.debts = e.debts!.filter((x) => x !== debt);
      if (!e.debts.length) delete e.debts;
      note(
        sim,
        debt.from,
        'debtWiped',
        `${debt.name} has fallen to the city: the ${money(debt.balance)} the city owed it is wiped out`,
        'good',
      );
      continue;
    }
    const interest = (debt.balance * (debt.annualRate / 12)) / HOURS_PER_DAY;
    const pay = Math.min(debt.payment / HOURS_PER_DAY, debt.balance + interest);
    const principal = pay - interest;
    accrue(sim, 'lenderInterest', -interest);
    accrue(sim, 'lenderRepaid', -principal);
    debt.balance -= principal;
    if (debt.balance <= 0.5) {
      // Settle the last cents exactly so nothing is lost or created.
      accrue(sim, 'lenderRepaid', -debt.balance);
      e.debts = e.debts!.filter((x) => x !== debt);
      if (!e.debts.length) delete e.debts;
      note(sim, debt.from, 'debtRepaid', `The city has repaid ${debt.name}’s loan in full`, 'good');
    }
  }
}

/**
 * Monthly ledger lines from neighbours' loans (instalments, booked by the hour) and investors (their
 * share of this month's industrial taxes, `industrial`), at current conditions.
 */
export function offerRates(sim: Sim, industrial: number): Record<string, number> {
  const e = sim.state.war?.economy;
  const out: Record<string, number> = {};
  if (!e) return out;
  const add = (k: string, v: number) => {
    if (v) out[k] = (out[k] ?? 0) + v;
  };
  for (const debt of e.debts ?? []) {
    const interest = Math.min(debt.balance * (debt.annualRate / 12), debt.payment);
    add('lenderInterest', -interest);
    add('lenderRepaid', -Math.min(debt.balance, debt.payment - interest));
  }
  for (const inv of e.investors ?? [])
    if (!fallen(sim, inv.from)) add('investorShare', -(industrial * inv.share) / 100);
  return out;
}

/** The city's dealings with a town that is replaced by a friend's city: its offers go; what is agreed runs its course. */
export function forgetOffers(sim: Sim, id: number): void {
  const e = sim.state.war?.economy;
  if (e?.offers) {
    e.offers = e.offers.filter((o) => o.from !== id);
    if (!e.offers.length) delete e.offers;
  }
}

export interface OffersSummary {
  /** Open offers, with why the city can't take each now (null when it can). */
  offers: {
    id: number;
    from: number;
    name: string;
    kind: OfferKind;
    text: string;
    made: number;
    expires: number;
    crates: number | null;
    amount: number | null;
    share: number | null;
    rate: number | null;
    months: number | null;
    why: string | null;
  }[];
  /** Neighbours' investments in the city: what each takes a month now, and when it ends. */
  investors: {
    id: number;
    from: number;
    name: string;
    amount: number;
    share: number;
    perMonth: number;
    until: number;
  }[];
  /** Loans from neighbours. */
  debts: {
    id: number;
    from: number;
    name: string;
    principal: number;
    balance: number;
    payment: number;
    annualRate: number;
    monthsLeft: number;
  }[];
  /** What the city owes neighbours, and the share of its industrial taxes sold. */
  owed: number;
  sold: number;
}

export function offersSummary(sim: Sim): OffersSummary {
  const e = sim.state.war?.economy;
  const s = sim.state;
  const industrial = industrialTaxes(sim);
  return {
    offers: (e?.offers ?? []).map((o) => {
      const n = computerNeighbour(sim, o.from);
      return {
        id: o.id,
        from: o.from,
        name: n?.name ?? 'A lost town',
        kind: o.kind,
        text: n ? offerText(n, o) : 'The town that made this offer is gone',
        made: o.made,
        expires: o.expires,
        crates: o.kind === 'arms' ? o.crates : null,
        amount: o.kind === 'arms' ? null : o.amount,
        share: o.kind === 'invest' ? o.share : null,
        rate: o.kind === 'loan' ? o.rate : null,
        months: o.kind === 'arms' ? null : o.months,
        why: acceptRefusal(sim, o),
      };
    }),
    investors: (e?.investors ?? []).map((i) => ({
      id: i.id,
      from: i.from,
      name: i.name,
      amount: i.amount,
      share: i.share,
      perMonth: Math.round((industrial * i.share) / 100),
      until: i.until,
    })),
    debts: (e?.debts ?? []).map((d) => ({
      id: d.id,
      from: d.from,
      name: d.name,
      principal: d.principal,
      balance: Math.round(d.balance),
      payment: Math.round(d.payment),
      annualRate: d.annualRate,
      monthsLeft: Math.max(0, d.months - Math.floor((s.tick - d.takenTick) / TICKS_PER_MONTH)),
    })),
    owed: Math.round((e?.debts ?? []).reduce((a, d) => a + d.balance, 0)),
    sold: investedShare(sim),
  };
}
