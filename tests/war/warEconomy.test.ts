import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { DIPLOMACY, type Term } from '../../src/data/diplomacy';
import { annuity } from '../../src/data/economy';
import { INVEST, LENDING, WAR_AID, lendingRate } from '../../src/data/warEconomy';
import { PERSONALITY_IDS } from '../../src/data/war';
import { checkCommand } from '../../src/sim/commandCheck';
import { roomRefusal, type SharedRules } from '../../src/sim/rules';
import { Sim } from '../../src/sim/sim';
import { TICKS_PER_HOUR, TICKS_PER_MONTH, isMonthStart } from '../../src/sim/time';
import { fightingWith } from '../../src/sim/systems/diplomacy';
import { monthlyRates } from '../../src/sim/systems/economy';
import { warSummary } from '../../src/sim/systems/war';
import {
  frozenReason,
  industryEarnings,
  industryValue,
  stakePremium,
  stakePrice,
  stakeSale,
  stakeWorth,
  warEconomySummary,
} from '../../src/sim/systems/warEconomy';
import { newSim } from '../helpers';

/**
 * M38 steps 2 and 3: stakes in a computer neighbour's industry (dividends in peace, frozen while the
 * city fights that neighbour, seized by a capitulation or a treacherous declaration), loans to
 * allies, and aid to an ally's war. The cities here have rival neighbours and no buildings: nothing
 * but the war economy moves the money.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

const rivals = (sim: Sim) => sim.state.region.neighbours.filter((n) => n.rival && !n.player);
const ok = (sim: Sim, cmd: Parameters<Sim['dispatch']>[0]) => {
  const r = sim.dispatch(cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
  return r;
};
/** Run a command; null when it was done, else the reason it wasn't. */
const why = (sim: Sim, cmd: Parameters<Sim['dispatch']>[0]) => {
  const r = sim.dispatch(cmd);
  return r.ok ? null : r.reason;
};
const dip = (sim: Sim) => sim.state.war!.diplomacy!;
const eco = (sim: Sim) => sim.state.war!.economy!;

/** A war city with rival neighbours that like it (no premium), no alliances among them, and money. */
function warCity(): Sim {
  const sim = newSim({ rivals: true, disasters: false });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  for (const n of rivals(sim)) {
    n.rival!.relation = INVEST.premium.to;
    n.rival!.allies = [];
  }
  return sim;
}

/** Set the treasury, keeping the money invariant (the month's start moves with it). */
function setTreasury(sim: Sim, v: number): void {
  const e = sim.state.economy;
  e.monthStartTreasury += v - sim.state.treasury;
  sim.state.treasury = v;
}

/** A copy of the city as it stands, which plays on from the same dice. */
function clone(sim: Sim): Sim {
  const copy = Sim.fromSave(sim.save('2026-10-29'));
  copy.testMode = true;
  return copy;
}

/** Step to the next month's start (the tick whose month block has just run). */
function toMonthStart(sim: Sim): void {
  do sim.step();
  while (!isMonthStart(sim.state.tick));
}

/** A line's total over the months closed (the last 24) and the month so far. */
function total(sim: Sim, key: string): number {
  const e = sim.state.economy;
  return e.history.reduce((a, h) => a + (h.lines[key] ?? 0), 0) + (e.month[key] ?? 0);
}

/** The line in the last month closed. */
const lastMonth = (sim: Sim, key: string) => sim.state.economy.history.at(-1)?.lines[key] ?? 0;

/** The line's rate a month, at current conditions. */
const rate = (sim: Sim, key: string) => monthlyRates(sim)[key] ?? 0;

/** The neighbour puts these terms to the city and the city accepts. */
function treaty(sim: Sim, id: number, terms: Term[]): void {
  ok(sim, { type: 'cheat', cheat: 'proposal', neighbour: id, terms });
  const p = dip(sim).proposals.find((x) => x.from === 'them' && x.with === id)!;
  ok(sim, { type: 'answerProposal', proposal: p.id, accept: true });
}

/** A friend's city in the place of the first computer neighbour, as a shared region's news brings it. */
function friendTakesPlace(sim: Sim): void {
  const none = { power: 0, water: 0, garbage: 0 };
  ok(sim, {
    type: 'regionUpdate',
    update: {
      cities: [
        {
          slot: 2,
          name: 'Samton',
          mayor: 'Sam',
          color: 1,
          population: 5_000,
          kind: 'suburb',
          offers: { buy: { ...none }, sell: { ...none } },
          workers: 0,
          jobs: 0,
          shoppers: 0,
          online: true,
        },
      ],
      contracts: [],
      project: null,
    },
  });
}

describe('M38: stakes in a neighbour’s industry', () => {
  it('cost the industry’s value plus what the neighbour asks for its feelings, and sell back at 90 %', () => {
    const sim = warCity();
    const n = rivals(sim)[0]!;
    // A neighbour that likes the city sells at value; one that only just sells asks a fifth more.
    n.rival!.relation = INVEST.premium.to;
    expect(stakePremium(n)).toBe(0);
    expect(stakePrice(n, 10)).toBe(stakeWorth(n, 10));
    n.rival!.relation = INVEST.minRelation + 1;
    expect(stakePremium(n)).toBeCloseTo(INVEST.premium.max, 2);
    n.rival!.relation = (INVEST.premium.from + INVEST.premium.to) / 2;
    expect(stakePremium(n)).toBeCloseTo(INVEST.premium.max / 2, 5);
    expect(stakeWorth(n, 10)).toBe(Math.round(industryValue(n) / 10));
    const price = stakePrice(n, 10);
    expect(price).toBeGreaterThan(stakeWorth(n, 10));

    const before = sim.state.treasury;
    expect(sim.preview({ type: 'buyStake', neighbour: n.id, share: 10 })).toMatchObject({
      ok: true,
      cost: price,
    });
    // A preview changes nothing: not the treasury, not even the existence of the war economy.
    expect(sim.state.treasury).toBe(before);
    expect(sim.state.war!.economy).toBeUndefined();
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 10 });
    expect(sim.state.treasury).toBe(before - price);
    expect(eco(sim).stakes[n.id]).toMatchObject({ share: 10, paid: price });
    expect(total(sim, 'stakeBought')).toBe(-price);
    // More of it later: the shares add up and so do the prices.
    const more = stakePrice(n, 5);
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 5 });
    expect(eco(sim).stakes[n.id]).toMatchObject({ share: 15, paid: price + more });

    // Selling takes the whole stake back at nine tenths of what it's worth now.
    const proceeds = stakeSale(n, 15);
    expect(proceeds).toBe(Math.round(stakeWorth(n, 15) * INVEST.sellShare));
    const t = sim.state.treasury;
    expect(sim.preview({ type: 'sellStake', neighbour: n.id })).toMatchObject({ ok: true, cost: -proceeds });
    ok(sim, { type: 'sellStake', neighbour: n.id });
    expect(sim.state.treasury).toBe(t + proceeds);
    expect(eco(sim).stakes[n.id]).toBeUndefined();
    expect(total(sim, 'stakeSold')).toBe(proceeds);
    expect(why(sim, { type: 'sellStake', neighbour: n.id })).toMatch(/holds no stake/);
  });

  it('pay dividends every month in peace, by the industry’s earnings and the share held', () => {
    const sim = warCity();
    const n = rivals(sim).find((x) => x.kind === 'industrial')!;
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 20 });
    toMonthStart(sim);
    let last = 0;
    for (let k = 0; k < 4; k++) {
      // The town's size moves at each month's start, so the month's dividends follow it.
      const expected = (industryEarnings(sim, n) * 20) / 100;
      expect(rate(sim, 'dividends')).toBeCloseTo(expected, 5);
      toMonthStart(sim);
      last = lastMonth(sim, 'dividends');
      expect(last).toBeGreaterThan(0);
      expect(Math.abs(last - expected)).toBeLessThanOrEqual(1);
    }
    // 1.2 % of the stake's worth a month: about 15 % a year.
    const worth = stakeWorth(n, 20);
    expect(last / worth).toBeGreaterThan(INVEST.yield - 0.0005);
    expect(last / worth).toBeLessThan(INVEST.yield + 0.0005);
    // The summary says so too.
    const row = warEconomySummary(sim)!.neighbours.find((x) => x.id === n.id)!;
    expect(row).toMatchObject({ held: 20, frozen: null, sell: null });
    expect(row.dividend).toBeCloseTo((industryEarnings(sim, n) * 20) / 100, 0);
    expect(warSummary(sim, () => 0)!.economy).toEqual(warEconomySummary(sim));
  });

  it('earn more with weapons tech and less in a blackout or with the power out', () => {
    const sim = warCity();
    const n = rivals(sim)[0]!;
    const base = industryValue(n) * INVEST.yield;
    expect(industryEarnings(sim, n)).toBeCloseTo(base, 5);
    n.rival!.tech = 2;
    const tech = base * (1 + 2 * INVEST.techBonus);
    expect(industryEarnings(sim, n)).toBeCloseTo(tech, 5);
    n.rival!.blackout = { from: 0, until: sim.state.war!.clock + 100 };
    expect(industryEarnings(sim, n)).toBeCloseTo(tech * (1 - INVEST.disrupted), 5);
    delete n.rival!.blackout;
    n.rival!.intel = { power: sim.state.war!.clock + 100 };
    expect(industryEarnings(sim, n)).toBeCloseTo(tech * (1 - INVEST.disrupted), 5);
    // An industrial town's industry is worth the most per resident.
    expect(new Set(rivals(sim).map((x) => x.kind)).size).toBe(3);
    expect(INVEST.perResident.industrial).toBeGreaterThan(INVEST.perResident.resort);
    expect(INVEST.perResident.resort).toBeGreaterThan(INVEST.perResident.suburb);
  });

  it('are turned down with a plain reason: size, cap, feelings, war, money, friends', () => {
    const sim = warCity();
    const [a, b] = rivals(sim);
    const buy = (neighbour: number, share: number) => why(sim, { type: 'buyStake', neighbour, share });
    expect(buy(a!.id, 7)).toMatch(/steps of 5%/);
    expect(buy(a!.id, 30)).toMatch(/steps of 5%/);
    expect(buy(a!.id, 0)).toMatch(/steps of 5%/);
    expect(buy(99, 5)).toMatch(/No such neighbour/);
    // The cap is 25 % of a town's industry.
    expect(buy(a!.id, 25)).toBeNull();
    expect(buy(a!.id, 5)).toMatch(/holds 25% of .*: 25% at most/);
    // Feelings: hostile neighbours won't sell; just above the line they do.
    b!.rival!.relation = INVEST.minRelation;
    expect(buy(b!.id, 5)).toMatch(/distrusts/);
    b!.rival!.relation = INVEST.minRelation + 1;
    // Money: a stake costs what it costs.
    const cash = sim.state.treasury;
    setTreasury(sim, 100);
    expect(buy(b!.id, 5)).toMatch(/costs \$/);
    setTreasury(sim, cash);
    expect(buy(b!.id, 5)).toBeNull();
    // A neighbour at war with the city sells nothing, from the declaration on.
    ok(sim, { type: 'declareWar', neighbour: b!.id, scale: 'war', reason: '' });
    expect(buy(b!.id, 5)).toMatch(/at war with .*: it sells no stakes/);
    // A friend's city takes a neighbour's place: no stakes in it until treaties among friends (M39).
    friendTakesPlace(sim);
    const friend = sim.state.region.neighbours.find((x) => x.player)!;
    expect(buy(friend.id, 5)).toMatch(/friend/);
    // And a city without war has no economy to speak of.
    const peaceful = newSim({ disasters: false });
    expect(why(peaceful, { type: 'buyStake', neighbour: 1, share: 5 })).toMatch(/War is off/);
    expect(why(peaceful, { type: 'sellStake', neighbour: 1 })).toMatch(/War is off/);
    expect(why(peaceful, { type: 'lendAlly', neighbour: 1, amount: 50_000 })).toMatch(/War is off/);
    expect(why(peaceful, { type: 'fundAlly', neighbour: 1, perMonth: 10_000 })).toMatch(/War is off/);
  });

  it('can still be sold in a war’s warning, and not bought again until peace', () => {
    const sim = warCity();
    const n = rivals(sim)[0]!;
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 10 });
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' });
    sim.advance(6 * H);
    expect(fightingWith(sim, n.id)).toBeUndefined();
    expect(why(sim, { type: 'sellStake', neighbour: n.id })).toBeNull();
    expect(eco(sim).stakes[n.id]).toBeUndefined();
    expect(why(sim, { type: 'buyStake', neighbour: n.id, share: 10 })).toMatch(/at war/);
  });

  it('stop at a declared war once it opens, and resume at peace', () => {
    const sim = warCity();
    const n = rivals(sim)[0]!;
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 10 });
    toMonthStart(sim);
    sim.advance(2 * H);
    // In peace: dividends accrue by the hour.
    const d0 = total(sim, 'dividends');
    sim.advance(4 * H);
    const d1 = total(sim, 'dividends');
    expect(d1).toBeGreaterThan(d0);
    expect(rate(sim, 'dividends')).toBeGreaterThan(0);

    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'war', reason: 'Our border' });
    const war = dip(sim).wars[0]!;
    // During the warning the stake still pays.
    sim.advance(3 * H);
    expect(sim.state.tick).toBeLessThan(war.opens);
    expect(rate(sim, 'dividends')).toBeGreaterThan(0);
    expect(total(sim, 'dividends')).toBeGreaterThan(d1);
    // The war opens: dividends stop, in the rates and in the ledger.
    sim.advance(DIPLOMACY.warningHours * H - 3 * H + 2);
    expect(fightingWith(sim, n.id)).toBeDefined();
    expect(rate(sim, 'dividends')).toBe(0);
    const d3 = total(sim, 'dividends');
    sim.advance(2 * M);
    expect(total(sim, 'dividends')).toBe(d3);
    expect(lastMonth(sim, 'dividends')).toBe(0);
    // The stake is still there, frozen: it can't be sold, and the war room says why.
    expect(eco(sim).stakes[n.id]!.share).toBe(10);
    expect(why(sim, { type: 'sellStake', neighbour: n.id })).toMatch(/fighting .*frozen/);
    const row = warEconomySummary(sim)!.neighbours.find((x) => x.id === n.id)!;
    expect(row.frozen).toMatch(/frozen/);
    expect(row.dividend).toBe(0);
    expect(row.sell).toMatch(/frozen/);
    expect(row.held).toBe(10);

    // Peace: the stake thaws and pays again.
    treaty(sim, n.id, [{ k: 'peace' }]);
    expect(dip(sim).wars).toHaveLength(0);
    expect(fightingWith(sim, n.id)).toBeUndefined();
    expect(frozenReason(sim, n.id, n.name)).toBeNull();
    expect(rate(sim, 'dividends')).toBeGreaterThan(0);
    const d4 = total(sim, 'dividends');
    sim.advance(2 * M);
    expect(total(sim, 'dividends')).toBeGreaterThan(d4 + rate(sim, 'dividends'));
    expect(lastMonth(sim, 'dividends')).toBeGreaterThan(0);
    expect(why(sim, { type: 'sellStake', neighbour: n.id })).toBeNull();
    expect(eco(sim).stakes[n.id]).toBeUndefined();
  });

  it('thaw in a ceasefire, which stops the fighting, and freeze again when it ends', () => {
    const sim = warCity();
    const n = rivals(sim)[0]!;
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 5 });
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' });
    sim.advance((DIPLOMACY.warningHours + 1) * H);
    expect(rate(sim, 'dividends')).toBe(0);
    treaty(sim, n.id, [{ k: 'ceasefire', hours: 48 }]);
    expect(dip(sim).wars).toHaveLength(1);
    expect(rate(sim, 'dividends')).toBeGreaterThan(0);
    sim.advance(49 * H);
    expect(fightingWith(sim, n.id)).toBeDefined();
    expect(rate(sim, 'dividends')).toBe(0);
  });

  it('are seized when the city capitulates to that neighbour, and no other stake is touched', () => {
    const sim = warCity();
    const [a, b] = rivals(sim);
    ok(sim, { type: 'buyStake', neighbour: a!.id, share: 10 });
    ok(sim, { type: 'buyStake', neighbour: b!.id, share: 5 });
    ok(sim, { type: 'declareWar', neighbour: a!.id, scale: 'war', reason: '' });
    sim.advance((DIPLOMACY.warningHours + 1) * H);
    const t = sim.state.treasury;
    const sold = total(sim, 'stakeSold');
    // The war goes badly enough that the city gives up; the terms it must accept end the war.
    dip(sim).wars[0]!.score = DIPLOMACY.score.capitulate - 5;
    sim.advance(2 * H);
    expect(dip(sim).log.some((e) => /The city capitulates/.test(e.text) && e.with === a!.id)).toBe(true);
    expect(dip(sim).wars).toHaveLength(0);
    expect(eco(sim).stakes[a!.id]).toBeUndefined();
    expect(eco(sim).stakes[b!.id]!.share).toBe(5);
    expect(dip(sim).log.some((e) => /seizes the city’s 10% stake/.test(e.text) && e.with === a!.id)).toBe(
      true,
    );
    // Nothing came back for it: only the other stake's dividends moved the money.
    expect(total(sim, 'stakeSold')).toBe(sold);
    expect(sim.state.treasury - t).toBeLessThan(500);
    // At peace the other stake pays, and the seized one does not.
    expect(warEconomySummary(sim)!.neighbours.find((x) => x.id === a!.id)!.held).toBe(0);
    expect(rate(sim, 'dividends')).toBeCloseTo((industryEarnings(sim, b!) * 5) / 100, 5);
  });

  it('are seized in the winner when the city falls to it, and in none of the others', () => {
    const sim = warCity();
    const [a, b] = rivals(sim);
    ok(sim, { type: 'buyStake', neighbour: a!.id, share: 10 });
    ok(sim, { type: 'buyStake', neighbour: b!.id, share: 10 });
    ok(sim, { type: 'cheat', cheat: 'fall', neighbour: a!.id });
    expect(dip(sim).vassal?.overlord).toBe(a!.id);
    expect(eco(sim).stakes[a!.id]).toBeUndefined();
    expect(eco(sim).stakes[b!.id]!.share).toBe(10);
    expect(dip(sim).log.some((e) => /seizes the city’s 10% stake/.test(e.text))).toBe(true);
  });

  it('are kept when the city conquers the neighbour, which then pays as a vassal', () => {
    const sim = warCity();
    const n = rivals(sim)[0]!;
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 10 });
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance((DIPLOMACY.warningHours + 1) * H);
    // The city has held the seat of power long enough: the neighbour falls.
    dip(sim).wars[0]!.hold = { by: 'us', since: sim.state.tick - DIPLOMACY.conquestHours * H };
    sim.advance(2 * H);
    expect(n.rival!.vassal).toBeDefined();
    expect(dip(sim).wars).toHaveLength(0);
    expect(eco(sim).stakes[n.id]!.share).toBe(10);
    expect(rate(sim, 'dividends')).toBeGreaterThan(0);
    expect(rate(sim, 'vassals')).toBeGreaterThan(0);
  });

  /** An established city (the menu's demo town) with war on, and a neighbour of this character that hates it. */
  function establishedWithStake(personality: 'treacherous' | 'aggressive'): { sim: Sim; id: number } {
    const sim = Sim.fromSave(decodeSave(new Uint8Array(readFileSync('public/demo.citybloom'))));
    sim.testMode = true;
    ok(sim, {
      type: 'regionUpdate',
      update: { cities: [], contracts: [], project: null, rules: { war: true, scale: 'total' } },
    });
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
    for (const x of rivals(sim)) x.rival!.allies = [];
    const n = rivals(sim)[0]!;
    n.rival!.personality = personality;
    n.rival!.relation = 50;
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 10 });
    // It turns on the city: strong, and no friend of it.
    n.rival!.relation = -80;
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 400, defences: 50 });
    return { sim, id: n.id };
  }
  const declaredOn = (sim: Sim, id: number) =>
    sim.state.war!.diplomacy?.wars.find((w) => w.with === id && w.by === 'them');

  it('are seized when a treacherous neighbour declares war on the city', () => {
    const { sim, id } = establishedWithStake('treacherous');
    for (let d = 0; d < 90 && !declaredOn(sim, id); d++) sim.advance(M);
    expect(declaredOn(sim, id)).toBeDefined();
    // It strikes first and keeps the stake, the moment it declares.
    expect(eco(sim).stakes[id]).toBeUndefined();
    expect(dip(sim).log.some((e) => /seizes the city’s 10% stake .*declares war/.test(e.text))).toBe(true);
  });

  it('are kept when another neighbour declares war on the city, and frozen once the war opens', () => {
    const { sim, id } = establishedWithStake('aggressive');
    for (let d = 0; d < 90 && !declaredOn(sim, id); d++) sim.advance(M);
    expect(declaredOn(sim, id)).toBeDefined();
    expect(eco(sim).stakes[id]!.share).toBe(10);
    // The neighbour is at war with the city: the stake can't be sold until the fighting stops.
    sim.advance((DIPLOMACY.warningHours + 1) * H);
    expect(fightingWith(sim, id)).toBeDefined();
    expect(rate(sim, 'dividends')).toBe(0);
    expect(why(sim, { type: 'sellStake', neighbour: id })).toMatch(/frozen/);
  });

  it('end, paid back what they cost, when a friend’s city takes the neighbour’s place', () => {
    const sim = warCity();
    const first = sim.state.region.neighbours.find((x) => !x.player)!;
    ok(sim, { type: 'buyStake', neighbour: first.id, share: 10 });
    const paid = eco(sim).stakes[first.id]!.paid;
    const t = sim.state.treasury;
    friendTakesPlace(sim);
    expect(first.player).toBeDefined();
    expect(eco(sim).stakes[first.id]).toBeUndefined();
    expect(sim.state.treasury).toBe(t + paid);
  });
});

describe('M38: loans to allies', () => {
  /** A city allied (by treaty) with its first computer neighbour, of this character if asked. */
  function allyCity(personality?: (typeof PERSONALITY_IDS)[number]): { sim: Sim; ally: number } {
    const sim = warCity();
    const n = rivals(sim)[0]!;
    if (personality) n.rival!.personality = personality;
    treaty(sim, n.id, [{ k: 'alliance' }]);
    expect(dip(sim).pacts.some((p) => p.term.k === 'alliance' && p.with === n.id)).toBe(true);
    return { sim, ally: n.id };
  }

  it('charge a rate by the ally’s character, from 4 % to 9 %', () => {
    const rates = PERSONALITY_IDS.map((p) => lendingRate(p));
    expect(Math.min(...rates)).toBe(LENDING.rate.minRate);
    expect(Math.max(...rates)).toBe(LENDING.rate.maxRate);
    expect(lendingRate('honourable')).toBe(0.04);
    expect(lendingRate('mercantile')).toBe(0.09);
    // Characters in between sit in between, those who value money more paying more.
    expect(lendingRate('aggressive')).toBeGreaterThan(lendingRate('cautious'));
    expect(lendingRate('treacherous')).toBeGreaterThan(lendingRate('aggressive'));
    expect(lendingRate('treacherous')).toBeLessThan(lendingRate('mercantile'));
  });

  it('go to an ally only, in the sizes on offer, one at a time, and need the money', () => {
    const { sim, ally } = allyCity();
    const other = rivals(sim).find((n) => n.id !== ally)!;
    const lend = (neighbour: number, amount: number) => why(sim, { type: 'lendAlly', neighbour, amount });
    expect(lend(other.id, 50_000)).toMatch(/isn’t the city’s ally/);
    expect(lend(ally, 60_000)).toMatch(/No such loan/);
    expect(lend(99, 50_000)).toMatch(/No such neighbour/);
    const cash = sim.state.treasury;
    setTreasury(sim, 10_000);
    expect(lend(ally, 50_000)).toMatch(/needs that much/);
    setTreasury(sim, cash);
    expect(lend(ally, 50_000)).toBeNull();
    expect(lend(ally, 150_000)).toMatch(/still owes the city/);
    // A defensive pact makes an ally too.
    treaty(sim, other.id, [{ k: 'defensivePact' }]);
    expect(lend(other.id, 50_000)).toBeNull();
    // A friend's city: not until M39.
    friendTakesPlace(sim);
    const friend = sim.state.region.neighbours.find((x) => x.player)!;
    expect(lend(friend.id, 50_000)).toMatch(/friend/);
  });

  it('are paid out of the treasury, and repaid with interest over two years', () => {
    const { sim, ally } = allyCity('mercantile');
    const amount = 150_000;
    const t0 = sim.state.treasury;
    const r = ok(sim, { type: 'lendAlly', neighbour: ally, amount });
    const annual = lendingRate('mercantile');
    const payment = annuity(amount, annual, LENDING.months);
    expect(r.info).toMatchObject({ rate: annual, payment: Math.round(payment) });
    expect(sim.state.treasury).toBe(t0 - amount);
    expect(total(sim, 'allyLent')).toBe(-amount);
    expect(eco(sim).loans).toHaveLength(1);
    expect(eco(sim).loans[0]).toMatchObject({
      with: ally,
      principal: amount,
      annualRate: annual,
      balance: amount,
    });
    // The first month: interest on the balance, and the rest of the instalment as principal.
    expect(rate(sim, 'allyInterest')).toBeCloseTo((amount * annual) / 12, 3);
    expect(rate(sim, 'allyInterest') + rate(sim, 'allyRepaid')).toBeCloseTo(payment, 3);
    // Month by month to the end (the ledger keeps only two years): totals of what came in.
    let interest = 0;
    let repaid = 0;
    for (let m = 0; m < LENDING.months + 2; m++) {
      toMonthStart(sim);
      interest += lastMonth(sim, 'allyInterest');
      repaid += lastMonth(sim, 'allyRepaid');
      if (m === 1) {
        // A full month in: close to the instalment, and the interest a little under the first month's.
        expect(Math.abs(lastMonth(sim, 'allyInterest') - Math.round((amount * annual) / 12))).toBeLessThan(
          120,
        );
        expect(lastMonth(sim, 'allyRepaid')).toBeGreaterThan(0);
        expect(
          Math.abs(lastMonth(sim, 'allyInterest') + lastMonth(sim, 'allyRepaid') - payment),
        ).toBeLessThan(3);
      }
    }
    interest += sim.state.economy.month.allyInterest ?? 0;
    repaid += sim.state.economy.month.allyRepaid ?? 0;
    expect(eco(sim).loans).toHaveLength(0);
    // The principal came back to within a dollar or two, with the interest on top: a little under
    // the schedule's (interest accrues by the hour on a balance that falls, as on a bank loan).
    expect(Math.abs(repaid - amount)).toBeLessThanOrEqual(2);
    const schedule = payment * LENDING.months - amount;
    expect(interest).toBeLessThan(schedule);
    expect(interest).toBeGreaterThan(schedule * 0.9);
    expect(sim.state.treasury).toBeGreaterThan(t0);
    expect(sim.state.treasury).toBe(t0 - amount + interest + repaid);
    expect(dip(sim).log.some((e) => /repaid the city’s loan in full/.test(e.text))).toBe(true);
    // Nothing more comes in, and a new loan can be made.
    expect(rate(sim, 'allyInterest')).toBe(0);
    expect(why(sim, { type: 'lendAlly', neighbour: ally, amount: 400_000 })).toBeNull();
  });

  it('are written off when the pact ends, whichever side ends it', () => {
    const { sim, ally } = allyCity();
    ok(sim, { type: 'lendAlly', neighbour: ally, amount: 150_000 });
    sim.advance(3 * H);
    const pact = dip(sim).pacts.find((p) => p.term.k === 'alliance')!;
    ok(sim, { type: 'endPact', pact: pact.id });
    expect(eco(sim).loans).toHaveLength(1); // until the next hour
    sim.advance(H);
    expect(eco(sim).loans).toHaveLength(0);
    expect(
      dip(sim).log.some((e) =>
        /writes off the \$[\d,]+ still owed by .*: its pact with .* is over/.test(e.text),
      ),
    ).toBe(true);
    const repaid = total(sim, 'allyRepaid');
    sim.advance(2 * M);
    expect(total(sim, 'allyRepaid')).toBe(repaid);
    expect(rate(sim, 'allyInterest')).toBe(0);

    // The other side: the neighbour ends the pact (a treacherous one breaking its word).
    const second = allyCity('treacherous');
    ok(second.sim, { type: 'lendAlly', neighbour: second.ally, amount: 50_000 });
    dip(second.sim).pacts = dip(second.sim).pacts.filter((p) => p.term.k !== 'alliance');
    expect(rate(second.sim, 'allyInterest')).toBe(0); // the projection already leaves it out
    second.sim.advance(H);
    expect(eco(second.sim).loans).toHaveLength(0);
  });

  it('are written off when the city conquers the ally: it is the city’s own then', () => {
    const { sim, ally } = allyCity();
    ok(sim, { type: 'lendAlly', neighbour: ally, amount: 150_000 });
    sim.state.region.neighbours.find((x) => x.id === ally)!.rival!.vassal = { since: sim.state.tick };
    sim.advance(H);
    expect(eco(sim).loans).toHaveLength(0);
    expect(dip(sim).log.some((e) => /fallen to the city/.test(e.text))).toBe(true);
  });

  it('stop while the city is fighting the borrower (and, from step 5, under sanctions), and carry on after', () => {
    const { sim, ally } = allyCity();
    ok(sim, { type: 'lendAlly', neighbour: ally, amount: 150_000 });
    toMonthStart(sim);
    sim.advance(3 * H);
    const balance = eco(sim).loans[0]!.balance;
    expect(balance).toBeLessThan(150_000);
    // A war with the borrower, planted beside the pact (declaring one would break the pact and write
    // the loan off): the loan freezes, in the rates and in the books.
    dip(sim).wars.push({
      id: 9_001,
      with: ally,
      name: 'Ally',
      scale: 'war',
      by: 'us',
      reason: '',
      declared: 0,
      opens: 0,
      score: 0,
      battles: 0,
    });
    expect(rate(sim, 'allyInterest')).toBe(0);
    // Nothing new is lent while it's frozen either.
    expect(why(sim, { type: 'lendAlly', neighbour: ally, amount: 50_000 })).toMatch(
      /fighting .*loan.*frozen/,
    );
    const repaid = total(sim, 'allyRepaid');
    sim.advance(2 * H);
    expect(eco(sim).loans[0]!.balance).toBe(balance);
    expect(total(sim, 'allyRepaid')).toBe(repaid);
    expect(warEconomySummary(sim)!.neighbours.find((x) => x.id === ally)!.loan!.frozen).toBe(true);
    dip(sim).wars = dip(sim).wars.filter((w) => w.id !== 9_001);
    sim.advance(2 * H);
    expect(eco(sim).loans[0]!.balance).toBeLessThan(balance);
  });
});

describe('M38: funding an ally’s war', () => {
  /**
   * The city allied with `ally` and at war with `enemy` (open), at a month's start: the ally fights
   * at the city's side. The neighbours' own alliances are cleared so nobody joins the enemy.
   */
  function sideBySide(): { sim: Sim; ally: number; enemy: number } {
    const sim = warCity();
    const [a, e] = rivals(sim);
    // A big, armed-to-the-teeth ally, so the gap it closes each month is plain to measure.
    a!.population = 40_000;
    a!.rival!.personality = 'aggressive';
    treaty(sim, a!.id, [{ k: 'alliance' }]);
    ok(sim, { type: 'declareWar', neighbour: e!.id, scale: 'war', reason: '' });
    sim.advance((DIPLOMACY.warningHours + 1) * H);
    toMonthStart(sim);
    return { sim, ally: a!.id, enemy: e!.id };
  }
  const score = (sim: Sim) => dip(sim).wars[0]!.score;
  const forces = (sim: Sim, id: number) =>
    sim.state.region.neighbours.find((n) => n.id === id)!.rival!.forces;

  it('goes to an ally fighting at the city’s side, in whole steps, and nobody else', () => {
    const sim = warCity();
    const [a, e, c] = rivals(sim);
    const fund = (id: number, perMonth: number) => why(sim, { type: 'fundAlly', neighbour: id, perMonth });
    // No alliance, no war: nothing to fund.
    expect(fund(a!.id, 10_000)).toMatch(/isn’t the city’s ally/);
    treaty(sim, a!.id, [{ k: 'alliance' }]);
    expect(fund(a!.id, 10_000)).toMatch(/isn’t at war/);
    ok(sim, { type: 'declareWar', neighbour: e!.id, scale: 'war', reason: '' });
    // The warning isn't a war yet.
    expect(fund(a!.id, 10_000)).toMatch(/isn’t at war/);
    sim.advance((DIPLOMACY.warningHours + 1) * H);
    expect(fund(a!.id, 5_000)).toMatch(/Aid is \$10,000 to \$100,000/);
    expect(fund(a!.id, 15_000)).toMatch(/Aid is/);
    expect(fund(a!.id, 110_000)).toMatch(/Aid is/);
    expect(fund(a!.id, -10_000)).toMatch(/Aid is/);
    expect(fund(99, 10_000)).toMatch(/No such neighbour/);
    // The enemy and the bystander can't be funded: neither is an ally.
    expect(fund(e!.id, 10_000)).toMatch(/isn’t the city’s ally/);
    expect(fund(c!.id, 10_000)).toMatch(/isn’t the city’s ally/);
    // An ally that stays out of it (it isn't fighting beside the city) can't either.
    treaty(sim, c!.id, [{ k: 'alliance' }]);
    c!.rival!.allies = [e!.id];
    expect(fund(c!.id, 10_000)).toMatch(/isn’t fighting at the city’s side/);
    // Stopping needs something to stop.
    expect(fund(a!.id, 0)).toMatch(/isn’t funding/);
    expect(fund(a!.id, 10_000)).toBeNull();
    expect(fund(a!.id, 0)).toBeNull();
  });

  it('is paid by the hour while the ally fights beside the city, and not otherwise', () => {
    const { sim, ally, enemy } = sideBySide();
    ok(sim, { type: 'fundAlly', neighbour: ally, perMonth: 60_000 });
    expect(rate(sim, 'warAid')).toBe(-60_000);
    const t = sim.state.treasury;
    toMonthStart(sim);
    // A whole month at 60,000.
    expect(Math.abs(lastMonth(sim, 'warAid') + 60_000)).toBeLessThanOrEqual(1);
    expect(t - sim.state.treasury).toBeGreaterThan(59_000);
    // Peace with the enemy: the ally has no war to help in, and nothing is sent.
    treaty(sim, enemy, [{ k: 'peace' }]);
    expect(rate(sim, 'warAid')).toBe(0);
    toMonthStart(sim);
    toMonthStart(sim);
    expect(lastMonth(sim, 'warAid')).toBe(0);
    expect(why(sim, { type: 'fundAlly', neighbour: ally, perMonth: 20_000 })).toMatch(/isn’t at war/);
  });

  it('lets an ally close the gap to its forces twice as fast at full funding, half as much at half', () => {
    const { sim, ally } = sideBySide();
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: ally, forces: 0.5, defences: 1 });
    const control = clone(sim);
    ok(sim, { type: 'fundAlly', neighbour: ally, perMonth: WAR_AID.max });
    const f0 = forces(sim, ally);
    // A month of funding in, the ally arms by twice what the control does (from the same dice).
    toMonthStart(sim);
    toMonthStart(control);
    const gained = forces(sim, ally) - f0;
    const usual = forces(control, ally) - f0;
    expect(usual).toBeGreaterThan(3);
    expect(gained / usual).toBeGreaterThan(1.9);
    expect(gained / usual).toBeLessThan(2.1);
    expect(eco(sim).aid[ally]!.effect).toBeGreaterThan(0.99);
    expect(eco(sim).aid[ally]!.funded).toBe(0);
    // Half the funding, half the lift.
    ok(sim, { type: 'fundAlly', neighbour: ally, perMonth: WAR_AID.max / 2 });
    toMonthStart(sim);
    expect(eco(sim).aid[ally]!.effect).toBeGreaterThan(0.49);
    expect(eco(sim).aid[ally]!.effect).toBeLessThan(0.51);
  });

  it('doubles the ally’s daily share of the war score at full funding, and less for less', () => {
    const { sim, ally } = sideBySide();
    const control = clone(sim);
    ok(sim, { type: 'fundAlly', neighbour: ally, perMonth: WAR_AID.max });
    toMonthStart(sim);
    toMonthStart(control);
    // The first month counted last month's funding, all of it: the score moved by 2, not 1.
    expect(score(sim) - score(control)).toBeCloseTo(
      DIPLOMACY.score.allyPerDay * (WAR_AID.scoreFactor - 1),
      5,
    );
    // At 40 % the share is 1.4 days' worth.
    const part = clone(sim);
    const plain = clone(sim);
    ok(part, { type: 'fundAlly', neighbour: ally, perMonth: 40_000 });
    ok(plain, { type: 'fundAlly', neighbour: ally, perMonth: 0 });
    toMonthStart(part);
    toMonthStart(plain);
    expect(score(part) - score(plain)).toBeCloseTo(0.4, 5);
  });

  it('stops for free, keeping the lift the funding so far earned', () => {
    const { sim, ally } = sideBySide();
    const control = clone(sim);
    ok(sim, { type: 'fundAlly', neighbour: ally, perMonth: WAR_AID.max });
    sim.advance(12 * H);
    const t = sim.state.treasury;
    ok(sim, { type: 'fundAlly', neighbour: ally, perMonth: 0 });
    expect(rate(sim, 'warAid')).toBe(0);
    sim.advance(3 * H);
    expect(sim.state.treasury).toBe(t); // nothing else moves the money
    toMonthStart(sim);
    toMonthStart(control);
    // About half a month's funding: about half the lift, and the stopped order goes a month later.
    expect(score(sim) - score(control)).toBeGreaterThan(0.3);
    expect(score(sim) - score(control)).toBeLessThan(0.7);
    expect(eco(sim).aid[ally]!.effect).toBeGreaterThan(0.4);
    expect(eco(sim).aid[ally]!.perMonth).toBe(0);
    toMonthStart(sim);
    expect(eco(sim).aid[ally]).toBeUndefined();
  });

  it('ends with the pact, and a funded ally that stops fighting beside the city costs nothing', () => {
    const { sim, ally } = sideBySide();
    ok(sim, { type: 'fundAlly', neighbour: ally, perMonth: 30_000 });
    const pact = dip(sim).pacts.find((p) => p.term.k === 'alliance')!;
    ok(sim, { type: 'endPact', pact: pact.id, breakPact: true });
    sim.advance(H);
    expect(eco(sim).aid[ally]).toBeUndefined();
    expect(rate(sim, 'warAid')).toBe(0);
    expect(dip(sim).log.some((e) => /aid to .* ends with their pact/.test(e.text))).toBe(true);
  });

  it('shows in the war room’s economy summary', () => {
    const { sim, ally } = sideBySide();
    ok(sim, { type: 'fundAlly', neighbour: ally, perMonth: 50_000 });
    ok(sim, { type: 'lendAlly', neighbour: ally, amount: 50_000 });
    const summary = warEconomySummary(sim)!;
    const row = summary.neighbours.find((x) => x.id === ally)!;
    expect(row).toMatchObject({ allied: true, helping: true, aid: 50_000, fund: null });
    expect(row.loan).toMatchObject({ principal: 50_000, balance: 50_000, frozen: false });
    expect(summary.rates.warAid).toBe(-50_000);
    expect(summary.owed).toBe(50_000);
  });
});

describe('M38: the war economy in a saved city', () => {
  const V30 = 'tests/fixtures/war/v30-war.citybloom';

  it('a v30 war save takes up the war economy, and the economy survives a save and a load', () => {
    const sim = Sim.fromSave(decodeSave(new Uint8Array(readFileSync(V30))));
    sim.testMode = true;
    // (The fixture's war is with Wilholm, who joined Calhaven's side: a neighbour at peace sells.)
    const n = rivals(sim).find((x) => !dip(sim).wars.some((w) => w.with === x.id))!;
    n.rival!.relation = 60;
    // (Allied to the city's enemy it would sanction the city, step 5: this one stands apart.)
    n.rival!.allies = [];
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 15 });
    sim.advance(M);
    expect(rate(sim, 'dividends')).toBeGreaterThan(0);
    const copy = clone(sim);
    expect(eco(copy)).toEqual(eco(sim));
    expect(copy.hash()).toBe(sim.hash());
    sim.advance(2 * M);
    copy.advance(2 * M);
    expect(copy.hash()).toBe(sim.hash());
    expect(total(copy, 'dividends')).toBe(total(sim, 'dividends'));
  });
});

describe('M38: commands from other players', () => {
  it('are checked in shape: sizes, steps and amounts out of range are turned away', () => {
    const bad = (cmd: Record<string, unknown>) => 'problem' in checkCommand(cmd);
    expect(bad({ type: 'buyStake', neighbour: 1, share: 10 })).toBe(false);
    expect(bad({ type: 'buyStake', neighbour: 1, share: 30 })).toBe(true);
    expect(bad({ type: 'buyStake', neighbour: 1, share: 2.5 })).toBe(true);
    expect(bad({ type: 'buyStake', neighbour: -1, share: 5 })).toBe(true);
    expect(bad({ type: 'sellStake', neighbour: 1 })).toBe(false);
    expect(bad({ type: 'sellStake' })).toBe(true);
    expect(bad({ type: 'lendAlly', neighbour: 1, amount: 400_000 })).toBe(false);
    expect(bad({ type: 'lendAlly', neighbour: 1, amount: 60_000 })).toBe(true);
    expect(bad({ type: 'fundAlly', neighbour: 1, perMonth: 0 })).toBe(false);
    expect(bad({ type: 'fundAlly', neighbour: 1, perMonth: 100_000 })).toBe(false);
    expect(bad({ type: 'fundAlly', neighbour: 1, perMonth: 1e9 })).toBe(true);
    expect(bad({ type: 'fundAlly', neighbour: 1, perMonth: '10000' })).toBe(true);
  });

  it('are the city’s money: a player without the host’s say-so on money can’t invest, lend or fund', () => {
    const rules: SharedRules = { perms: { 2: ['speed'] }, host: 1, spendLimit: null };
    const cmds = [
      { type: 'buyStake', neighbour: 1, share: 5 },
      { type: 'sellStake', neighbour: 1 },
      { type: 'lendAlly', neighbour: 1, amount: 50_000 },
      { type: 'fundAlly', neighbour: 1, perMonth: 10_000 },
    ] as const;
    for (const cmd of cmds) {
      expect(roomRefusal(rules, 2, cmd), cmd.type).toMatch(/taxes, the budget or loans/);
      expect(roomRefusal(rules, 1, cmd), cmd.type).toBeNull();
    }
  });
});
