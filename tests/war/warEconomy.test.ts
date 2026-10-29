import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { DIPLOMACY, type Term } from '../../src/data/diplomacy';
import { INVEST } from '../../src/data/warEconomy';
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

describe('M38: the war economy in a saved city', () => {
  const V30 = 'tests/fixtures/war/v30-war.citybloom';

  it('a v30 war save takes up the war economy, and the economy survives a save and a load', () => {
    const sim = Sim.fromSave(decodeSave(new Uint8Array(readFileSync(V30))));
    sim.testMode = true;
    // (The fixture's war is with Wilholm, who joined Calhaven's side: a neighbour at peace sells.)
    const n = rivals(sim).find((x) => !dip(sim).wars.some((w) => w.with === x.id))!;
    n.rival!.relation = 60;
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
  it('are checked in shape: shares out of range are turned away', () => {
    const bad = (cmd: Record<string, unknown>) => 'problem' in checkCommand(cmd);
    expect(bad({ type: 'buyStake', neighbour: 1, share: 10 })).toBe(false);
    expect(bad({ type: 'buyStake', neighbour: 1, share: 30 })).toBe(true);
    expect(bad({ type: 'buyStake', neighbour: 1, share: 2.5 })).toBe(true);
    expect(bad({ type: 'buyStake', neighbour: -1, share: 5 })).toBe(true);
    expect(bad({ type: 'sellStake', neighbour: 1 })).toBe(false);
    expect(bad({ type: 'sellStake' })).toBe(true);
  });

  it('are the city’s money: a player without the host’s say-so on money can’t invest', () => {
    const rules: SharedRules = { perms: { 2: ['speed'] }, host: 1, spendLimit: null };
    const cmds = [
      { type: 'buyStake', neighbour: 1, share: 5 },
      { type: 'sellStake', neighbour: 1 },
    ] as const;
    for (const cmd of cmds) {
      expect(roomRefusal(rules, 2, cmd), cmd.type).toMatch(/taxes, the budget or loans/);
      expect(roomRefusal(rules, 1, cmd), cmd.type).toBeNull();
    }
  });
});
