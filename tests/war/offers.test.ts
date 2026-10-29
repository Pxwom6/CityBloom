import { describe, expect, it } from 'vitest';
import { DIPLOMATS } from '../../src/data/diplomacy';
import { annuity } from '../../src/data/economy';
import { PERSONALITY, PERSONALITY_IDS } from '../../src/data/war';
import { ARMS, OFFERS, offerRate } from '../../src/data/warEconomy';
import { checkCommand } from '../../src/sim/commandCheck';
import { roomRefusal, type SharedRules } from '../../src/sim/rules';
import { Sim } from '../../src/sim/sim';
import { industrialTaxes, offersMonth, type Offer } from '../../src/sim/systems/offers';
import { warSummary } from '../../src/sim/systems/war';
import { armsCapacity, warEconomySummary } from '../../src/sim/systems/warEconomy';
import { TICKS_PER_HOUR, TICKS_PER_MONTH, isMonthStart } from '../../src/sim/time';
import { buildTown, newSim, serveTown } from '../helpers';
import {
  clone,
  dip,
  eco,
  friendTakesPlace,
  lastMonth,
  ofKind,
  ok,
  rate,
  rivals,
  setTreasury,
  stockUp,
  toMonthStart,
  total,
  treaty,
  warCity,
  why,
} from './economyHelpers';

/**
 * M38 step 7: computer neighbours' offers. At most one a month, by a neighbour's character and its
 * own dice: to buy munitions (from allies), to invest in the city (mercantile and cautious, never at
 * war), to lend to a city short of cash (mercantile cheapest). The city answers; an offer stays open
 * three days. Each kind is tested taken up, turned down and lapsing. The cities have rival neighbours
 * and no buildings unless a test says; the `offer` cheat makes an offer at once.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

const offers = (sim: Sim): Offer[] => sim.state.war!.economy?.offers ?? [];
/** The `diplomacy` events since the last clear, by what they say. */
const told = (sim: Sim, what: string) =>
  sim.events.filter((e) => e.kind === 'diplomacy' && e.info?.what === what);
const offer = (sim: Sim, neighbour: number, kind: 'arms' | 'invest' | 'loan') =>
  why(sim, { type: 'cheat', cheat: 'offer', neighbour, offer: kind });
const answer = (sim: Sim, id: number, accept: boolean) =>
  why(sim, { type: 'answerOffer', offer: id, accept });
/** The offer just made. */
const latest = (sim: Sim): Offer => offers(sim).at(-1)!;

/** A city whose industrial taxes were $6,000 last month, as the books say (no buildings are needed). */
function withIndustry(sim: Sim, tax = 6_000): void {
  sim.state.economy.history.push({
    month: 0,
    lines: { taxI1: tax, taxR1: 4_000 },
    treasury: sim.state.treasury,
  });
}

/**
 * Step to the next month's start with the books showing industrial and home taxes earned in the month
 * just ended (the money comes with them) and the bank low: what a small, short-of-cash city has when
 * the month's dice are rolled.
 */
function monthStartWithTaxes(sim: Sim, tax = 6_000): void {
  while (!isMonthStart(sim.state.tick + 1)) sim.step();
  const e = sim.state.economy;
  e.month.taxI1 = (e.month.taxI1 ?? 0) + tax;
  e.month.taxR1 = (e.month.taxR1 ?? 0) + tax;
  sim.state.treasury += 2 * tax;
  setTreasury(sim, 5_000);
  sim.step();
}

describe('M38: an ally’s offer to buy munitions', () => {
  function ally() {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    n.population = 20_000;
    n.rival!.personality = 'aggressive';
    treaty(sim, n.id, [{ k: 'alliance' }]);
    stockUp(sim, 500);
    return { sim, n };
  }

  it('is made with a plain reason when it can’t be, open three days, and taken up as an arms deal', () => {
    const { sim, n } = ally();
    const other = ofKind(sim, 'suburb');
    sim.events = [];
    expect(offer(sim, other.id, 'arms')).toMatch(/isn’t the city’s ally/);
    stockUp(sim, 5);
    expect(offer(sim, n.id, 'arms')).toMatch(/too few crates/);
    stockUp(sim, 500);
    // A preview makes nothing, not even the offers list.
    expect(sim.preview({ type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'arms' })).toMatchObject({
      ok: true,
    });
    expect(offers(sim)).toHaveLength(0);
    expect(offer(sim, n.id, 'arms')).toBeNull();
    const o = latest(sim);
    if (o.kind !== 'arms') throw new Error('an arms offer');
    expect(o).toMatchObject({ from: n.id, made: sim.state.tick, expires: sim.state.tick + 3 * M });
    const cap = armsCapacity(n);
    expect(o.crates).toBeLessThanOrEqual(cap);
    expect(o.crates % ARMS.step).toBe(0);
    expect(o.crates).toBeGreaterThanOrEqual(cap / 2 - ARMS.step);
    // Told as a notice and in the log.
    expect(told(sim, 'offer')).toHaveLength(1);
    expect(String(told(sim, 'offer')[0]!.info!.text)).toMatch(
      new RegExp(`${n.name} offers to buy \\d+ crates`),
    );
    expect(dip(sim).log.some((l) => l.with === n.id && /offers to buy/.test(l.text))).toBe(true);
    // The war summary has it, takeable.
    expect(warEconomySummary(sim)!.offers.offers[0]).toMatchObject({ id: o.id, kind: 'arms', why: null });
    // Taken: the arms deal stands as the city would have made it, and the offer is gone.
    expect(answer(sim, o.id, true)).toBeNull();
    expect(eco(sim).arms![n.id]).toMatchObject({ neighbour: n.id, amount: o.crates });
    expect(offers(sim)).toHaveLength(0);
    expect(told(sim, 'offerAccepted')).toHaveLength(1);
    sim.advance(3 * H);
    expect(rate(sim, 'armsSales')).toBeCloseTo(o.crates * ARMS.price, 0);
    // The same offer can't be taken twice, nor a second made while a deal stands.
    expect(answer(sim, o.id, true)).toBe('That offer is gone');
    expect(offer(sim, n.id, 'arms')).toMatch(/already sells/);
  });

  it('turned down changes nothing but the log; unanswered it lapses after three days', () => {
    const { sim, n } = ally();
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'arms' });
    const relation = n.rival!.relation;
    sim.events = [];
    expect(answer(sim, latest(sim).id, false)).toBeNull();
    expect(eco(sim).arms).toBeUndefined();
    expect(offers(sim)).toHaveLength(0);
    expect(n.rival!.relation).toBe(relation);
    expect(told(sim, 'offerDeclined')).toHaveLength(1);
    // Unanswered: open until the third day is out, gone after.
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'arms' });
    const open = latest(sim);
    sim.events = [];
    sim.advance(3 * M - 2 * H);
    expect(offers(sim)).toHaveLength(1);
    expect(told(sim, 'offerLapsed')).toHaveLength(0);
    sim.advance(3 * H);
    expect(offers(sim)).toHaveLength(0);
    expect(told(sim, 'offerLapsed')).toHaveLength(1);
    expect(answer(sim, open.id, true)).toBe('That offer is gone');
  });

  it('can’t be taken once its pact is gone, but can still be turned down', () => {
    const { sim, n } = ally();
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'arms' });
    const id = latest(sim).id;
    const pact = dip(sim).pacts.find((p) => p.with === n.id && p.term.k === 'alliance')!;
    ok(sim, { type: 'endPact', pact: pact.id, breakPact: true });
    sim.events = [];
    expect(answer(sim, id, true)).toMatch(/isn’t the city’s ally/);
    expect(offers(sim)).toHaveLength(1);
    expect(answer(sim, id, false)).toBeNull();
    expect(eco(sim).arms).toBeUndefined();
  });
});

describe('M38: a neighbour’s offer to invest in the city', () => {
  function investor() {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    n.rival!.personality = 'mercantile';
    n.population = 20_000;
    withIndustry(sim);
    return { sim, n };
  }

  it('is a lump sum now for a share of the industrial taxes, taken up with the money booked', () => {
    const { sim, n } = investor();
    expect(industrialTaxes(sim)).toBe(6_000);
    expect(offer(sim, n.id, 'invest')).toBeNull();
    const o = latest(sim);
    if (o.kind !== 'invest') throw new Error('an investment');
    expect(OFFERS.invest.shares).toContain(o.share);
    expect(o.months).toBe(24);
    // What the share is worth over the term, less the neighbour's profit.
    expect(o.amount).toBe(
      Math.round((o.share * 6_000 * 24 * OFFERS.invest.pays.mercantile) / 100 / 100) * 100,
    );
    const money = sim.state.treasury;
    expect(answer(sim, o.id, true)).toBeNull();
    expect(sim.state.treasury).toBe(money + o.amount);
    expect(total(sim, 'investment')).toBe(o.amount);
    expect(eco(sim).investors![0]).toMatchObject({
      from: n.id,
      share: o.share,
      amount: o.amount,
      until: sim.state.tick + 24 * M,
    });
    expect(offers(sim)).toHaveLength(0);
    // No second from the same neighbour while it stands.
    expect(offer(sim, n.id, 'invest')).toMatch(/has invested in the city already/);
    expect(warEconomySummary(sim)!.offers.sold).toBe(o.share);
  });

  it('turned down leaves the city as it was', () => {
    const { sim, n } = investor();
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'invest' });
    const money = sim.state.treasury;
    expect(answer(sim, latest(sim).id, false)).toBeNull();
    expect(sim.state.treasury).toBe(money);
    expect(eco(sim).investors).toBeUndefined();
  });

  it('only from the mercantile and the cautious, never at war', () => {
    const { sim, n } = investor();
    for (const p of PERSONALITY_IDS) {
      n.rival!.personality = p;
      const r = offer(sim, n.id, 'invest');
      if (p === 'mercantile' || p === 'cautious') expect(r).toBeNull();
      else expect(r).toMatch(/doesn’t invest abroad/);
      if (sim.state.war!.economy) sim.state.war!.economy.offers = [];
    }
    // The city at war with anyone: nobody invests, whatever its character.
    n.rival!.personality = 'cautious';
    const e = ofKind(sim, 'suburb');
    ok(sim, { type: 'declareWar', neighbour: e.id, scale: 'war', reason: 'Our border' });
    sim.advance(13 * H);
    expect(offer(sim, n.id, 'invest')).toMatch(/at war/);
    // And the neighbour at war with the city offers nothing at all.
    expect(offer(sim, e.id, 'loan')).toMatch(/at war with/);
  });

  it('is limited: a town of little means gives little, small taxes tempt no one, 30% is the most', () => {
    const { sim, n } = investor();
    n.population = 1_000; // taxes of $4,000 a month: twelve months of them is the most it can put up
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'invest' });
    const small = latest(sim);
    expect(small.kind === 'invest' && small.amount).toBeLessThanOrEqual(48_000);
    // Small taxes.
    const poor = warCity();
    ofKind(poor, 'industrial').rival!.personality = 'mercantile';
    withIndustry(poor, 1_000);
    expect(offer(poor, ofKind(poor, 'industrial').id, 'invest')).toMatch(/too small to interest/);
    // Two investors at 15% fill the share; a third is refused.
    const full = warCity();
    withIndustry(full, 40_000);
    const [a, b, c] = (['industrial', 'suburb', 'resort'] as const).map((k) => ofKind(full, k));
    for (const t of [a!, b!, c!]) {
      t.rival!.personality = 'cautious';
      t.population = 30_000;
    }
    for (const t of [a!, b!]) {
      ok(full, { type: 'cheat', cheat: 'offer', neighbour: t.id, offer: 'invest' });
      const o = latest(full);
      if (o.kind === 'invest') o.share = 15;
      expect(answer(full, o.id, true)).toBeNull();
    }
    expect(offer(full, c!.id, 'invest')).toMatch(/30% .* the most/);
  });

  it('takes its share of the industrial taxes by the hour, and ends after its term', () => {
    // A grown town with industry: its taxes are real, the books say they were $6,000 last month.
    const sim = newSim({ rivals: true, disasters: false });
    buildTown(sim);
    serveTown(sim);
    sim.advance(3 * M);
    const n = ofKind(sim, 'industrial');
    n.rival!.personality = 'mercantile';
    n.rival!.relation = 60;
    n.population = 20_000;
    withIndustry(sim);
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'invest' });
    const o = latest(sim);
    if (o.kind !== 'invest') throw new Error('an investment');
    ok(sim, { type: 'answerOffer', offer: o.id, accept: true });
    const taxes = () => rate(sim, 'taxI0') + rate(sim, 'taxI1') + rate(sim, 'taxI2');
    expect(taxes()).toBeGreaterThan(0);
    expect(rate(sim, 'investorShare')).toBeCloseTo(-(taxes() * o.share) / 100, 6);
    // A month of it: the share of what the industry paid.
    const before = {
      share: total(sim, 'investorShare'),
      tax: total(sim, 'taxI0') + total(sim, 'taxI1') + total(sim, 'taxI2'),
    };
    sim.advance(M);
    const paid = -(total(sim, 'investorShare') - before.share);
    const earned = total(sim, 'taxI0') + total(sim, 'taxI1') + total(sim, 'taxI2') - before.tax;
    expect(earned).toBeGreaterThan(0);
    expect(paid / earned).toBeGreaterThan((o.share / 100) * 0.85);
    expect(paid / earned).toBeLessThan((o.share / 100) * 1.15);
  });

  it('ends with its term, or is wiped out if the investor falls to the city; a friend taking its place changes nothing', () => {
    const { sim, n } = investor();
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'invest' });
    ok(sim, { type: 'answerOffer', offer: latest(sim).id, accept: true });
    // A friend takes the town's place: the agreement runs on (its name is kept).
    const kept = clone(sim);
    friendTakesPlace(kept);
    expect(eco(kept).investors).toHaveLength(1);
    kept.events = [];
    kept.advance(24 * M + H);
    expect(eco(kept).investors).toBeUndefined();
    expect(told(kept, 'investmentEnded')).toHaveLength(1);
    // The investor conquered: its share is the city's again.
    n.rival!.vassal = { since: sim.state.tick };
    sim.events = [];
    sim.advance(2 * H);
    expect(eco(sim).investors).toBeUndefined();
    expect(told(sim, 'investmentEnded')[0]!.info!.text).toMatch(/fallen to the city/);
  });
});

describe('M38: a neighbour’s offer to lend to the city', () => {
  function broke() {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    n.rival!.personality = 'mercantile';
    n.population = 20_000;
    setTreasury(sim, 10_000);
    withIndustry(sim);
    return { sim, n };
  }

  it('comes when the city is short of cash, and not when it isn’t or in a sandbox', () => {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    withIndustry(sim);
    expect(offer(sim, n.id, 'loan')).toMatch(/isn’t short of cash/);
    setTreasury(sim, 10_000);
    expect(offer(sim, n.id, 'loan')).toBeNull();
    const free = warCity();
    free.state.options.sandbox = true;
    setTreasury(free, 10_000);
    withIndustry(free);
    expect(offer(free, ofKind(free, 'industrial').id, 'loan')).toMatch(/sandbox/);
  });

  it('is lent against the city’s means: ten months of its taxes at most, and nothing to a town with no income', () => {
    const none = warCity();
    setTreasury(none, 10_000);
    const n = ofKind(none, 'industrial');
    expect(offer(none, n.id, 'loan')).toMatch(/taxes are too small for anyone to lend against/);
    // Taxes of $4,000 a month: $40,000 at most, so the $25,000 loan and not the $50,000 one.
    const sim = warCity();
    setTreasury(sim, 10_000);
    sim.state.economy.history.push({ month: 0, lines: { taxR1: 4_000 }, treasury: 10_000 });
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: ofKind(sim, 'industrial').id, offer: 'loan' });
    const o = latest(sim);
    expect(o.kind === 'loan' && o.amount).toBe(25_000);
    // Taxes of $30,000: the whole range is open, and the loan is the smallest that covers the gap.
    const rich = warCity();
    setTreasury(rich, 10_000);
    rich.state.economy.history.push({ month: 0, lines: { taxR1: 30_000 }, treasury: 10_000 });
    ok(rich, { type: 'cheat', cheat: 'offer', neighbour: ofKind(rich, 'industrial').id, offer: 'loan' });
    expect(latest(rich).kind === 'loan' && (latest(rich) as { amount: number }).amount).toBe(50_000);
  });

  it('lends at the neighbour’s rate, repaid like a bank loan with its own lines in the ledger', () => {
    const { sim, n } = broke();
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' });
    const o = latest(sim);
    if (o.kind !== 'loan') throw new Error('a loan');
    expect(OFFERS.loan.amounts).toContain(o.amount);
    expect(o.rate).toBe(offerRate('mercantile'));
    const before = sim.state.treasury;
    expect(answer(sim, o.id, true)).toBeNull();
    expect(sim.state.treasury).toBe(before + o.amount);
    const debt = eco(sim).debts![0]!;
    expect(debt).toMatchObject({ from: n.id, principal: o.amount, annualRate: o.rate, balance: o.amount });
    expect(debt.payment).toBeCloseTo(annuity(o.amount, o.rate, 24), 6);
    expect(total(sim, 'lenderLoan')).toBe(o.amount);
    // The rates in the ledger, then the hours.
    expect(rate(sim, 'lenderInterest')).toBeLessThan(0);
    expect(rate(sim, 'lenderRepaid')).toBeLessThan(0);
    expect(rate(sim, 'lenderInterest') + rate(sim, 'lenderRepaid')).toBeCloseTo(-debt.payment, 4);
    sim.advance(M);
    expect(debt.balance).toBeLessThan(o.amount);
    expect(total(sim, 'lenderRepaid') + total(sim, 'lenderInterest')).toBeCloseTo(-debt.payment, -1);
    // While it's owed, no second loan from it.
    expect(offer(sim, n.id, 'loan')).toMatch(/still owes/);
    expect(warEconomySummary(sim)!.offers).toMatchObject({ owed: Math.round(debt.balance) });
  });

  it('is paid off in two years, to the cent, and the lender is told', () => {
    const { sim, n } = broke();
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' });
    const o = latest(sim);
    if (o.kind !== 'loan') throw new Error('a loan');
    ok(sim, { type: 'answerOffer', offer: o.id, accept: true });
    setTreasury(sim, 1_000_000);
    sim.events = [];
    // Month by month, as the books close (the ledger keeps only the last two years).
    let repaid = 0;
    let interest = 0;
    for (let m = 0; m < 26; m++) {
      toMonthStart(sim);
      repaid += lastMonth(sim, 'lenderRepaid');
      interest += lastMonth(sim, 'lenderInterest');
    }
    expect(eco(sim).debts).toBeUndefined();
    expect(told(sim, 'debtRepaid')).toHaveLength(1);
    expect(Math.abs(repaid + o.amount)).toBeLessThanOrEqual(1);
    // Interest at the lender's rate on a balance falling over two years: more than half a year's
    // simple interest and under two years'.
    expect(-interest).toBeGreaterThan(o.amount * o.rate * 0.5);
    expect(-interest).toBeLessThan(o.amount * o.rate * 2);
  });

  it('is wiped out if the lender falls to the city', () => {
    const { sim, n } = broke();
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' });
    ok(sim, { type: 'answerOffer', offer: latest(sim).id, accept: true });
    n.rival!.vassal = { since: sim.state.tick };
    sim.events = [];
    sim.advance(2 * H);
    expect(eco(sim).debts).toBeUndefined();
    expect(told(sim, 'debtWiped')).toHaveLength(1);
  });

  it('is cheapest from the mercantile, dearest from the aggressive', () => {
    const rates = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, offerRate(p)])) as Record<
      (typeof PERSONALITY_IDS)[number],
      number
    >;
    for (const p of PERSONALITY_IDS) if (p !== 'mercantile') expect(rates.mercantile).toBeLessThan(rates[p]);
    expect(rates.aggressive).toBe(Math.max(...Object.values(rates)));
    // The trade weight lowers it and the money weight raises it: the mercantile have the most of both.
    expect(PERSONALITY.mercantile.trade).toBe(Math.max(...PERSONALITY_IDS.map((p) => PERSONALITY[p].trade)));
    expect(DIPLOMATS.mercantile.money).toBe(Math.max(...PERSONALITY_IDS.map((p) => DIPLOMATS[p].money)));
  });

  it('turned down leaves the city as it was', () => {
    const { sim, n } = broke();
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' });
    const money = sim.state.treasury;
    expect(answer(sim, latest(sim).id, false)).toBeNull();
    expect(sim.state.treasury).toBe(money);
    expect(eco(sim).debts).toBeUndefined();
  });
});

describe('M38: offers come by the month, by character, one at most', () => {
  /** An ally to sell arms to (and stores for them), three towns to lend, and a city short of cash. */
  function market() {
    const sim = warCity();
    const [a, b, c] = rivals(sim);
    a!.rival!.personality = 'mercantile';
    b!.rival!.personality = 'aggressive';
    c!.rival!.personality = 'cautious';
    for (const t of [a!, b!, c!]) t.population = 30_000;
    treaty(sim, b!.id, [{ k: 'alliance' }]);
    stockUp(sim, 1_000_000);
    setTreasury(sim, 5_000);
    return sim;
  }

  it('at most one a month, and over three years some come, of more than one kind', () => {
    const sim = market();
    let made = 0;
    const kinds = new Set<string>();
    for (let month = 0; month < 36; month++) {
      sim.events = [];
      const before = new Set(offers(sim).map((o) => o.id));
      monthStartWithTaxes(sim);
      const fresh = offers(sim).filter((o) => !before.has(o.id));
      expect(fresh.length).toBeLessThanOrEqual(1);
      expect(told(sim, 'offer').length).toBeLessThanOrEqual(1);
      for (const o of fresh) kinds.add(o.kind);
      made += fresh.length;
      // Whatever lingers is answered with nothing: each lapses after its three days.
    }
    expect(made).toBeGreaterThan(3);
    expect(made).toBeLessThan(36);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  });

  it('use dice of their own: the same state gives the same offer, and no other stream moves', () => {
    const sim = market();
    const copy = clone(sim);
    let made = false;
    for (let month = 0; month < 20 && !made; month++) {
      monthStartWithTaxes(sim);
      monthStartWithTaxes(copy);
      made = offers(sim).length > 0;
    }
    expect(made).toBe(true);
    expect(JSON.stringify(offers(copy))).toBe(JSON.stringify(offers(sim)));
    expect(copy.hash()).toBe(sim.hash());
    // Rolled by hand, month's dice apart, the war's and diplomacy's streams stand where they were.
    const dice = (s: Sim) => JSON.stringify([s.state.war!.rng, s.state.war!.diplomacy?.rng ?? null, s.rng]);
    let rolled = 0;
    for (let k = 0; k < 30; k++) {
      const fresh = clone(sim);
      fresh.state.options.seed = `streams-${k}`;
      if (fresh.state.war!.economy) fresh.state.war!.economy.offers = [];
      const before = dice(fresh);
      offersMonth(fresh);
      expect(dice(fresh)).toBe(before);
      rolled += offers(fresh).length;
    }
    expect(rolled).toBeGreaterThan(0);
  });

  it('trade-minded characters offer more often than the others', () => {
    // Each candidate rolls the data's chance scaled by its character's trade weight.
    expect(OFFERS.chance * PERSONALITY.mercantile.trade).toBeGreaterThan(
      OFFERS.chance * PERSONALITY.cautious.trade,
    );
    expect(PERSONALITY.cautious.trade).toBeGreaterThan(PERSONALITY.aggressive.trade);
    // Over many tries at the same state the mercantile town makes more offers than the aggressive one.
    let mercantile = 0;
    let aggressive = 0;
    for (let k = 0; k < 40; k++) {
      const sim = warCity();
      setTreasury(sim, 5_000);
      withIndustry(sim);
      const [a, b] = rivals(sim);
      a!.rival!.personality = 'mercantile';
      b!.rival!.personality = 'aggressive';
      for (const t of rivals(sim)) t.population = 30_000;
      // Only these two can lend: the third town is under an embargo.
      treaty(sim, rivals(sim)[2]!.id, [{ k: 'embargo' }]);
      sim.state.options.seed = `offers-${k}`;
      offersMonth(sim);
      for (const o of offers(sim)) {
        if (o.from === a!.id) mercantile++;
        if (o.from === b!.id) aggressive++;
      }
    }
    expect(mercantile).toBeGreaterThan(aggressive);
  });
});

describe('M38: offers and the rest of the game', () => {
  it('survive a save and go on exactly as they were', () => {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    n.rival!.personality = 'mercantile';
    n.population = 20_000;
    setTreasury(sim, 10_000);
    withIndustry(sim);
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' });
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'invest' });
    ok(sim, { type: 'answerOffer', offer: offers(sim)[0]!.id, accept: true });
    const copy = clone(sim);
    expect(copy.hash()).toBe(sim.hash());
    expect(offers(copy)).toEqual(offers(sim));
    sim.advance(2 * M);
    copy.advance(2 * M);
    expect(copy.hash()).toBe(sim.hash());
    expect(Sim.fromSave(sim.save('2026-10-29')).hash()).toBe(sim.hash());
  });

  it('are in the war summary, and the offer cheat is for tests only', () => {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    setTreasury(sim, 10_000);
    withIndustry(sim);
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' });
    const s = warSummary(sim, () => 0)!.economy!.offers;
    expect(s.offers).toHaveLength(1);
    expect(s.offers[0]).toMatchObject({ kind: 'loan', name: n.name, why: null });
    sim.testMode = false;
    expect(why(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' })).toBe(
      'Test mode only',
    );
  });

  it('are answered by a command that previews cleanly and says why when it can’t', () => {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    setTreasury(sim, 10_000);
    withIndustry(sim);
    expect(answer(sim, 12345, true)).toBe('That offer is gone');
    ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' });
    const id = latest(sim).id;
    const hash = sim.hash();
    expect(sim.preview({ type: 'answerOffer', offer: id, accept: true })).toMatchObject({ ok: true });
    expect(sim.preview({ type: 'answerOffer', offer: id, accept: false })).toMatchObject({ ok: true });
    expect(sim.hash()).toBe(hash);
    // Embargoed in the meantime: refused, with the reason; the offer waits to be turned down.
    treaty(sim, n.id, [{ k: 'embargo' }]);
    expect(answer(sim, id, true)).toMatch(/under embargo/);
    expect(answer(sim, id, false)).toBeNull();
  });

  it('answerOffer is checked in shape and is the city’s money', () => {
    const bad = (cmd: Record<string, unknown>) => 'problem' in checkCommand(cmd);
    expect(bad({ type: 'answerOffer', offer: 7, accept: true })).toBe(false);
    expect(bad({ type: 'answerOffer', offer: 7, accept: false })).toBe(false);
    expect(bad({ type: 'answerOffer', offer: 1.5, accept: true })).toBe(true);
    expect(bad({ type: 'answerOffer', offer: 7, accept: 'yes' })).toBe(true);
    expect(bad({ type: 'answerOffer', accept: true })).toBe(true);
    const rules: SharedRules = { perms: { 2: ['speed'] }, host: 1, spendLimit: null };
    const cmd = { type: 'answerOffer', offer: 7, accept: true } as const;
    expect(roomRefusal(rules, 2, cmd)).toMatch(/taxes, the budget or loans/);
    expect(roomRefusal(rules, 1, cmd)).toBeNull();
    // The cheat is never a shared city's.
    expect(bad({ type: 'cheat', cheat: 'offer', neighbour: 1, offer: 'loan' })).toBe(true);
  });

  it('are nothing to a city at peace, which keeps no war state', () => {
    const peace = Sim.create({ seed: 'peace-offers', disasters: false });
    peace.testMode = true;
    peace.advance(3 * M);
    expect(peace.state.war).toBeUndefined();
    expect(peace.dispatch({ type: 'answerOffer', offer: 1, accept: true })).toMatchObject({
      ok: false,
      reason: 'War is off in this city',
    });
    expect(peace.dispatch({ type: 'cheat', cheat: 'offer', neighbour: 1, offer: 'loan' }).ok).toBe(false);
  });
});
