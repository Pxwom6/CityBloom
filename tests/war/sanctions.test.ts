import { describe, expect, it } from 'vitest';
import { DIPLOMACY } from '../../src/data/diplomacy';
import { INVEST, SANCTION } from '../../src/data/warEconomy';
import { checkCommand } from '../../src/sim/commandCheck';
import { roomRefusal, type SharedRules } from '../../src/sim/rules';
import { Sim } from '../../src/sim/sim';
import { warSummary } from '../../src/sim/systems/war';
import { sanctionsBetween, warEconomySummary } from '../../src/sim/systems/warEconomy';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import {
  addUnit,
  clone,
  dip,
  eco,
  friendTakesPlace,
  ofKind,
  ok,
  rate,
  rivals,
  stockUp,
  toMonthStart,
  total,
  treaty,
  warCity,
  why,
} from './economyHelpers';

/**
 * M38 step 5: sanctions both ways. The city sanctions a neighbour (its deals end, its stakes freeze,
 * the neighbour grows and arms more slowly and minds it); computer neighbours sanction the city for
 * a war on their ally, a pact broken or a low reputation, and it is lifted at peace or after a time.
 * The cities here have rival neighbours and no buildings.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

const deal = (sim: Sim, id: number, resource: string) =>
  sim.state.region.deals.find((d) => d.neighbour === id && d.resource === resource);
const neighbour = (sim: Sim, id: number) => sim.state.region.neighbours.find((n) => n.id === id)!;
/** The `diplomacy` events since the last clear, by what they say. */
const told = (sim: Sim, what: string) =>
  sim.events.filter((e) => e.kind === 'diplomacy' && e.info?.what === what);

describe('M38: the city’s sanctions', () => {
  it('are put on and lifted at will, with a plain reason when not', () => {
    const sim = warCity();
    const a = ofKind(sim, 'industrial');
    const sanction = (neighbour: number, on: boolean) => why(sim, { type: 'setSanction', neighbour, on });
    expect(sanction(a.id, false)).toMatch(/isn’t sanctioning/);
    expect(sanction(99, true)).toBe('No such neighbour');
    // A preview changes nothing, not even the existence of the war economy.
    expect(sim.preview({ type: 'setSanction', neighbour: a.id, on: true })).toMatchObject({ ok: true });
    expect(sim.state.war!.economy).toBeUndefined();
    expect(sanction(a.id, true)).toBeNull();
    expect(eco(sim).sanctioned![a.id]).toEqual({ since: sim.state.tick });
    expect(sanction(a.id, true)).toMatch(/sanctions .* already/);
    expect(sanctionsBetween(sim, a.id)).toBe(true);
    expect(sanction(a.id, false)).toBeNull();
    expect(eco(sim).sanctioned![a.id]).toBeUndefined();
    expect(sanctionsBetween(sim, a.id)).toBe(false);
    // A vassal is the city's own; a friend's city waits for M39.
    const b = rivals(sim).find((n) => n.id !== a.id)!;
    b.rival!.vassal = { since: 0 };
    expect(sanction(b.id, true)).toMatch(/vassal/);
    friendTakesPlace(sim);
    const friend = sim.state.region.neighbours.find((n) => n.player)!;
    expect(sanction(friend.id, true)).toMatch(/friend/);
    // And where war is off there is nothing to do.
    expect(sanction(1, true)).not.toMatch(/War is off/);
  });

  /** An ally (industrial, 20,000) with a power deal, an arms deal, a stake and a loan; a suburb with a water deal and a stake. */
  function business() {
    const sim = warCity();
    const a = ofKind(sim, 'industrial');
    const b = ofKind(sim, 'suburb');
    a.rival!.personality = 'aggressive';
    a.population = 20_000;
    treaty(sim, a.id, [{ k: 'alliance' }]);
    stockUp(sim, 1_000);
    ok(sim, { type: 'setArmsDeal', neighbour: a.id, crates: 60 });
    ok(sim, { type: 'setDeal', neighbour: a.id, resource: 'power', direction: 'buy', amount: 100 });
    ok(sim, { type: 'setDeal', neighbour: b.id, resource: 'water', direction: 'buy', amount: 100 });
    ok(sim, { type: 'buyStake', neighbour: a.id, share: 10 });
    ok(sim, { type: 'buyStake', neighbour: b.id, share: 10 });
    ok(sim, { type: 'lendAlly', neighbour: a.id, amount: 50_000 });
    sim.advance(3 * H);
    return { sim, a, b };
  }

  it('end the deals with that neighbour, freeze the city’s stakes and loans there, and leave the rest alone', () => {
    const { sim, a, b } = business();
    const relation = a.rival!.relation;
    const dividends = rate(sim, 'dividends');
    expect(dividends).toBeGreaterThan(0);
    expect(rate(sim, 'allyInterest')).toBeGreaterThan(0);
    expect(rate(sim, 'armsSales')).toBe(60 * 38);
    sim.events = [];
    ok(sim, { type: 'setSanction', neighbour: a.id, on: true });
    // It minds.
    expect(a.rival!.relation).toBe(relation + SANCTION.relation);
    // The regional deal and the arms deal with it end at once; the suburb's water deal stands.
    expect(deal(sim, a.id, 'power')).toBeUndefined();
    expect(eco(sim).arms![a.id]).toBeUndefined();
    expect(deal(sim, b.id, 'water')).toBeDefined();
    expect(rate(sim, 'armsSales')).toBe(0);
    // The stake and the loan freeze: nothing paid, nothing sold, nothing collected.
    const aWorth = (rate(sim, 'dividends') / dividends) * 100;
    expect(aWorth).toBeGreaterThan(0);
    expect(aWorth).toBeLessThan(100);
    expect(rate(sim, 'allyInterest')).toBe(0);
    expect(rate(sim, 'allyRepaid')).toBe(0);
    expect(why(sim, { type: 'sellStake', neighbour: a.id })).toMatch(/Sanctions .* freeze its stake/);
    const balance = eco(sim).loans[0]!.balance;
    sim.advance(3 * H);
    expect(eco(sim).loans[0]!.balance).toBe(balance);
    const row = warEconomySummary(sim)!.neighbours.find((n) => n.id === a.id)!;
    expect(row).toMatchObject({ sanctioning: true, stopped: expect.stringMatching(/Sanctions/) });
    expect(row.frozen).toMatch(/Sanctions/);
    expect(row.loan!.frozen).toBe(true);
    expect(row.sanction).toBeNull(); // it can be lifted
    // Nothing new is bought, lent, dealt or sold there; trade with the suburb goes on.
    const refused = /Sanctions between the city and .* stand in the way/;
    expect(why(sim, { type: 'buyStake', neighbour: a.id, share: 5 })).toMatch(refused);
    expect(
      why(sim, { type: 'setDeal', neighbour: a.id, resource: 'power', direction: 'buy', amount: 50 }),
    ).toMatch(refused);
    expect(why(sim, { type: 'setArmsDeal', neighbour: a.id, crates: 30 })).toMatch(refused);
    expect(why(sim, { type: 'sellUnit', unit: addUnit(sim, 'infantry'), neighbour: a.id })).toMatch(refused);
    expect(why(sim, { type: 'lendAlly', neighbour: a.id, amount: 150_000 })).toMatch(/Sanctions .* freeze/);
    expect(sim.preview({ type: 'buyStake', neighbour: b.id, share: 5 })).toMatchObject({ ok: true });
    expect(
      sim.preview({ type: 'setDeal', neighbour: b.id, resource: 'water', direction: 'buy', amount: 50 }),
    ).toMatchObject({ ok: true });
    // It was told, in the log and as a notice.
    expect(
      dip(sim).log.some((e) => /sanctions .*: trade ends, its stakes and loans there freeze/.test(e.text)),
    ).toBe(true);
    expect(told(sim, 'sanctionsOn')).toHaveLength(1);

    // Lifted, the stake and the loan thaw; the deals that ended stay ended, and new ones may be made.
    ok(sim, { type: 'setSanction', neighbour: a.id, on: false });
    expect(told(sim, 'sanctionsOff')).toHaveLength(1);
    expect(rate(sim, 'dividends')).toBeCloseTo(dividends, 5);
    expect(rate(sim, 'allyInterest')).toBeGreaterThan(0);
    expect(deal(sim, a.id, 'power')).toBeUndefined();
    sim.advance(2 * H);
    expect(eco(sim).loans[0]!.balance).toBeLessThan(balance);
    expect(
      sim.preview({ type: 'setDeal', neighbour: a.id, resource: 'power', direction: 'buy', amount: 50 }),
    ).toMatchObject({ ok: true });
    expect(sim.preview({ type: 'setArmsDeal', neighbour: a.id, crates: 30 })).toMatchObject({ ok: true });
    expect(sim.preview({ type: 'sellStake', neighbour: a.id })).toMatchObject({ ok: true });
  });

  it('slow the neighbour’s town by half a percent a month, and its arming to four fifths', () => {
    const sim = warCity();
    const a = ofKind(sim, 'industrial');
    a.population = 20_000;
    a.rival!.personality = 'aggressive';
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: a.id, forces: 0.5, defences: 0.5 });
    // A bystander shows the sanction on `a` leaves the others alone.
    const control = clone(sim);
    const controlA = neighbour(control, a.id);
    ok(sim, { type: 'setSanction', neighbour: a.id, on: true });
    // (The sanction's relation drop is the only other difference; it doesn't touch growth or arming.)
    const p0 = a.population;
    toMonthStart(sim);
    toMonthStart(control);
    // The same dice: the same trend, and half a percent less growth.
    expect(a.trend).toBe(controlA.trend);
    expect(a.population).toBe(Math.round(p0 * (1 + a.trend + SANCTION.growth)));
    expect(controlA.population).toBe(Math.round(p0 * (1 + controlA.trend)));
    expect(a.population).toBeLessThan(controlA.population);
    // Arming: it closes four fifths of the gap it would have closed, forces and defences alike.
    expect(controlA.rival!.forces - 0.5).toBeGreaterThan(3);
    expect((a.rival!.forces - 0.5) / (controlA.rival!.forces - 0.5)).toBeGreaterThan(0.77);
    expect((a.rival!.forces - 0.5) / (controlA.rival!.forces - 0.5)).toBeLessThan(0.83);
    expect(controlA.rival!.defences - 0.5).toBeGreaterThan(0.5);
    expect((a.rival!.defences - 0.5) / (controlA.rival!.defences - 0.5)).toBeGreaterThan(0.74);
    expect((a.rival!.defences - 0.5) / (controlA.rival!.defences - 0.5)).toBeLessThan(0.86);
    // The other towns are as they were.
    for (const n of rivals(sim).filter((x) => x.id !== a.id)) {
      expect(n.population).toBe(neighbour(control, n.id).population);
      expect(n.rival!.forces).toBe(neighbour(control, n.id).rival!.forces);
    }
    // Lifted, it grows as usual again.
    ok(sim, { type: 'setSanction', neighbour: a.id, on: false });
    const p1 = a.population;
    toMonthStart(sim);
    expect(a.population).toBe(Math.round(p1 * (1 + a.trend)));
  });

  it('end with the sanctioned town when a friend’s city takes its place, and when it falls to the city', () => {
    const sim = warCity();
    const first = sim.state.region.neighbours.find((x) => !x.player)!;
    ok(sim, { type: 'setSanction', neighbour: first.id, on: true });
    friendTakesPlace(sim);
    expect(eco(sim).sanctioned![first.id]).toBeUndefined();
    const second = warCity();
    const b = rivals(second)[1]!;
    ok(second, { type: 'setSanction', neighbour: b.id, on: true });
    b.rival!.vassal = { since: second.state.tick };
    toMonthStart(second);
    expect(eco(second).sanctioned![b.id]).toBeUndefined();
  });
});

describe('M38: sanctions on the city', () => {
  /**
   * The city at peace with a suburb (E) and an industrial town (N) it has a power deal with. N is E's
   * ally but stays out of a fight (a mercantile character), so a war on E is one N sanctions the
   * city for. The resort (R) is on nobody's side.
   */
  function sides() {
    const sim = warCity();
    const e = ofKind(sim, 'suburb');
    const n = ofKind(sim, 'industrial');
    const r = ofKind(sim, 'resort');
    n.rival!.personality = 'mercantile';
    n.rival!.allies = [e.id];
    e.rival!.allies = [n.id];
    ok(sim, { type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 100 });
    // (The resort buys water: the city has none to spare, so the deal stands but ships nothing.)
    ok(sim, { type: 'setDeal', neighbour: r.id, resource: 'water', direction: 'sell', amount: 50 });
    sim.advance(2 * H);
    expect(deal(sim, n.id, 'power')!.delivered).toBe(100);
    return { sim, e, n, r };
  }
  const declare = (sim: Sim, id: number) =>
    ok(sim, { type: 'declareWar', neighbour: id, scale: 'war', reason: 'Our border' });

  it('come from a neighbour allied to one the city is at war with, and are lifted at peace', () => {
    const { sim, e, n, r } = sides();
    expect(why(sim, { type: 'buyStake', neighbour: n.id, share: 5 })).toBeNull();
    sim.events = [];
    declare(sim, e.id);
    // From the declaration, the ally's side refuses to deal and its deal with the city stops delivering.
    expect(sanctionsBetween(sim, n.id)).toBe(true);
    expect(sanctionsBetween(sim, r.id)).toBe(false);
    expect(why(sim, { type: 'buyStake', neighbour: n.id, share: 5 })).toMatch(
      /Sanctions .* stand in the way/,
    );
    expect(
      why(sim, { type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 50 }),
    ).toMatch(/Sanctions .* stand in the way/);
    expect(why(sim, { type: 'buyStake', neighbour: r.id, share: 5 })).toBeNull();
    sim.advance(H);
    expect(deal(sim, n.id, 'power')!.delivered).toBe(0);
    expect(deal(sim, r.id, 'water')).toBeDefined();
    // The day's pass makes it official: the deal ends, the city is told, the log and the page say so.
    expect(eco(sim).sanctionedBy).toBeUndefined();
    toMonthStart(sim);
    expect(eco(sim).sanctionedBy![n.id]).toMatchObject({ cause: 'ally' });
    expect(deal(sim, n.id, 'power')).toBeUndefined();
    expect(deal(sim, r.id, 'water')).toBeDefined();
    const [event] = told(sim, 'sanctionedUs');
    expect(told(sim, 'sanctionedUs')).toHaveLength(1);
    expect(event!.id).toBe(n.id);
    expect(event!.info).toMatchObject({ tone: 'bad', cause: 'ally' });
    expect(String(event!.info!.text)).toMatch(
      new RegExp(`${n.name} sanctions the city for its war on ${e.name}, ${n.name}’s ally`),
    );
    expect(dip(sim).log.some((l) => l.with === n.id && /sanctions the city for its war/.test(l.text))).toBe(
      true,
    );
    const row = warEconomySummary(sim)!.neighbours.find((x) => x.id === n.id)!;
    expect(row.sanctionedBy).toMatchObject({ cause: 'ally' });
    expect(row.sanctionedBy!.text).toMatch(/sanctions the city for its war on/);
    expect(
      warSummary(sim, () => 0)!.economy!.neighbours.find((x) => x.id === n.id)!.sanctionedBy,
    ).not.toBeNull();
    expect(row.stopped).toMatch(/Sanctions/);
    // The war is the cause for as long as it lasts, however long.
    toMonthStart(sim);
    expect(eco(sim).sanctionedBy![n.id]).toBeDefined();
    // Peace: refusals stop at once, and the sanction is lifted by the day's pass, with no waiting.
    sim.events = [];
    sim.advance((DIPLOMACY.warningHours + 1) * H);
    treaty(sim, e.id, [{ k: 'peace' }]);
    expect(sanctionsBetween(sim, r.id)).toBe(false);
    expect(eco(sim).sanctionedBy![n.id]).toBeDefined();
    toMonthStart(sim);
    expect(eco(sim).sanctionedBy![n.id]).toBeUndefined();
    expect(told(sim, 'sanctionLifted')).toHaveLength(1);
    expect(told(sim, 'sanctionLifted')[0]!.info).toMatchObject({ tone: 'good' });
    expect(
      why(sim, { type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 50 }),
    ).toBeNull();
  });

  it('do not fall on a neighbour with nothing to cut, but dealing with it is refused all the same', () => {
    const sim = warCity();
    const e = ofKind(sim, 'suburb');
    const n = ofKind(sim, 'industrial');
    n.rival!.personality = 'mercantile';
    n.rival!.allies = [e.id];
    e.rival!.allies = [n.id];
    declare(sim, e.id);
    toMonthStart(sim);
    toMonthStart(sim);
    // No deal, no stake, no loan, no aid: no sanction is made, and the war economy holds nothing but
    // the weariness (M38 step 6) of the war that is open.
    expect({ ...sim.state.war!.economy, weariness: undefined }).toEqual({
      stakes: {},
      loans: [],
      aid: {},
      weariness: undefined,
    });
    expect(told(sim, 'sanctionedUs')).toHaveLength(0);
    expect(sanctionsBetween(sim, n.id)).toBe(true);
    expect(
      why(sim, { type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 50 }),
    ).toMatch(/Sanctions/);
  });

  /** Two neighbours with deals (power from the industrial town, water from the resort) and a pact to break with the suburb. */
  function pacted() {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    const r = ofKind(sim, 'resort');
    const x = ofKind(sim, 'suburb');
    ok(sim, { type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 100 });
    ok(sim, { type: 'setDeal', neighbour: r.id, resource: 'water', direction: 'sell', amount: 50 });
    treaty(sim, x.id, [{ k: 'nonAggression', months: 12 }]);
    sim.advance(2 * H);
    return { sim, n, r, x };
  }

  it('come from every neighbour while the city’s reputation is low, and linger 30 days after it mends', () => {
    const { sim, n, r, x } = pacted();
    const rep = (v: number) => (dip(sim).reputation = v);
    // The edge: 35 is fine, 34 is not.
    rep(SANCTION.reputation);
    expect(sanctionsBetween(sim, n.id)).toBe(false);
    rep(SANCTION.reputation - 1);
    expect(sanctionsBetween(sim, n.id)).toBe(true);
    expect(sanctionsBetween(sim, x.id)).toBe(true);
    sim.advance(H);
    expect(deal(sim, n.id, 'power')!.delivered).toBe(0);
    sim.events = [];
    toMonthStart(sim);
    // Imposed on the neighbours the city has deals with; the suburb has none to cut.
    expect(Object.keys(eco(sim).sanctionedBy!).map(Number).sort()).toEqual([n.id, r.id].sort());
    expect(eco(sim).sanctionedBy![n.id]).toMatchObject({ cause: 'reputation' });
    expect(deal(sim, n.id, 'power')).toBeUndefined();
    expect(deal(sim, r.id, 'water')).toBeUndefined();
    expect(told(sim, 'sanctionedUs')).toHaveLength(2);
    expect(String(told(sim, 'sanctionedUs')[0]!.info!.text)).toMatch(
      /sanctions the city: its word counts for too little/,
    );
    // The reputation mends; the sanction stays for thirty days after the last day it was needed.
    rep(60);
    expect(sanctionsBetween(sim, n.id)).toBe(true);
    for (let day = 1; day < SANCTION.lapseDays; day++) {
      toMonthStart(sim);
      expect(eco(sim).sanctionedBy![n.id], `day ${day}`).toBeDefined();
    }
    sim.events = [];
    toMonthStart(sim);
    expect(eco(sim).sanctionedBy![n.id]).toBeUndefined();
    expect(eco(sim).sanctionedBy![r.id]).toBeUndefined();
    expect(told(sim, 'sanctionLifted')).toHaveLength(2);
    expect(sanctionsBetween(sim, n.id)).toBe(false);
    expect(
      why(sim, { type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 50 }),
    ).toBeNull();
  });

  it('come at once from honourable and cautious neighbours when the city breaks a pact, for 30 days', () => {
    const { sim, n, r, x } = pacted();
    n.rival!.personality = 'honourable';
    r.rival!.personality = 'aggressive';
    const pact = dip(sim).pacts.find((p) => p.term.k === 'nonAggression')!;
    sim.events = [];
    const t0 = sim.state.tick;
    ok(sim, { type: 'endPact', pact: pact.id, breakPact: true });
    expect(dip(sim).reputation).toBe(DIPLOMACY.reputation.start + DIPLOMACY.reputation.breakPact);
    // The honourable town sanctions the city on the spot for its word, and ends its deal. One breach
    // leaves the reputation above the bar every neighbour goes by, so the aggressive town trades on.
    expect(eco(sim).sanctionedBy![n.id]).toMatchObject({ cause: 'broke', since: t0, last: t0 });
    expect(dip(sim).reputation).toBeGreaterThanOrEqual(SANCTION.reputation);
    expect(eco(sim).sanctionedBy![r.id]).toBeUndefined();
    expect(deal(sim, n.id, 'power')).toBeUndefined();
    expect(deal(sim, r.id, 'water')).toBeDefined();
    // The suburb, whose pact it was, has nothing to cut.
    expect(eco(sim).sanctionedBy![x.id]).toBeUndefined();
    const notices = told(sim, 'sanctionedUs');
    expect(notices).toHaveLength(1);
    expect(String(notices[0]!.info!.text)).toMatch(/sanctions the city for breaking its word/);
    // A pattern (a second breach takes the reputation under the bar): every neighbour it deals with.
    dip(sim).reputation = SANCTION.reputation - 5;
    toMonthStart(sim);
    const t1 = eco(sim).sanctionedBy![r.id]?.since;
    expect(eco(sim).sanctionedBy![r.id]).toMatchObject({ cause: 'reputation' });
    expect(deal(sim, r.id, 'water')).toBeUndefined();
    expect(String(told(sim, 'sanctionedUs').find((e) => e.id === r.id)!.info!.text)).toMatch(
      /its word counts for too little/,
    );
    // The word broken is what the honourable town remembers, whatever the reputation does: thirty days
    // on it is lifted. (Here the reputation mends at once, which is what leaves the days to count.)
    dip(sim).reputation = 60;
    let days = 0;
    while (eco(sim).sanctionedBy![n.id] && days < 40) {
      toMonthStart(sim);
      days++;
    }
    expect(eco(sim).sanctionedBy![n.id]).toBeUndefined();
    const lifted = sim.state.tick - t0;
    expect(lifted).toBeGreaterThanOrEqual(SANCTION.lapseDays * M);
    expect(lifted).toBeLessThan((SANCTION.lapseDays + 1) * M);
    // The aggressive town's lingers thirty days after its cause last held, then goes too.
    for (let k = 0; k < 3 && eco(sim).sanctionedBy![r.id]; k++) toMonthStart(sim);
    expect(eco(sim).sanctionedBy![r.id]).toBeUndefined();
    expect(sim.state.tick - t1!).toBeGreaterThanOrEqual(SANCTION.lapseDays * M);
  });

  it('are not made by a neighbour that fell to the city, or a friend’s city', () => {
    const { sim, n, r } = pacted();
    dip(sim).reputation = 10;
    n.rival!.vassal = { since: sim.state.tick };
    expect(sanctionsBetween(sim, n.id)).toBe(false);
    toMonthStart(sim);
    const made = sim.state.war!.economy?.sanctionedBy ?? {};
    expect(made[n.id]).toBeUndefined();
    // The resort, which has a deal with the city, does sanction it: the reputation is 10.
    expect(made[r.id]).toBeDefined();
    friendTakesPlace(sim);
    const friend = sim.state.region.neighbours.find((x) => x.player)!;
    expect(sanctionsBetween(sim, friend.id)).toBe(false);
    toMonthStart(sim);
    expect(sim.state.war!.economy?.sanctionedBy?.[friend.id]).toBeUndefined();
  });

  it('end with the town when a friend’s city takes its place', () => {
    const { sim, n, r } = pacted();
    const first = sim.state.region.neighbours.find((x) => !x.player)!;
    dip(sim).reputation = 10;
    toMonthStart(sim);
    const had = first.id === n.id ? n : first.id === r.id ? r : null;
    // Whichever of the two the friend replaces, the sanction on the town that was is gone with it.
    if (had) expect(eco(sim).sanctionedBy![had.id]).toBeDefined();
    friendTakesPlace(sim);
    expect(first.player).toBeDefined();
    expect(eco(sim).sanctionedBy![first.id]).toBeUndefined();
    expect(eco(sim).sanctionedBy![first.id === n.id ? r.id : n.id]).toBeDefined();
  });

  it('keep an old city untouched unless a cause and something to cut come together', () => {
    // Cause without ties, over a good many days: not a trace in the state.
    const sim = warCity();
    treaty(sim, ofKind(sim, 'suburb').id, [{ k: 'nonAggression', months: 12 }]);
    dip(sim).reputation = 10;
    const before = JSON.stringify(sim.state.war!.economy ?? null);
    for (let day = 0; day < 4; day++) toMonthStart(sim);
    expect(JSON.stringify(sim.state.war!.economy ?? null)).toBe(before);
    expect(sim.state.war!.economy).toBeUndefined();
  });
});

describe('M38: sanctions in a saved city', () => {
  it('survive a save and a load, and the copy plays on to the same state', () => {
    const sim = warCity();
    const n = ofKind(sim, 'industrial');
    const r = ofKind(sim, 'resort');
    ok(sim, { type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 100 });
    ok(sim, { type: 'setSanction', neighbour: r.id, on: true });
    treaty(sim, ofKind(sim, 'suburb').id, [{ k: 'nonAggression', months: 12 }]);
    dip(sim).reputation = 20;
    toMonthStart(sim);
    expect(eco(sim).sanctionedBy![n.id]).toBeDefined();
    expect(eco(sim).sanctioned![r.id]).toBeDefined();
    const copy = clone(sim);
    expect(eco(copy)).toEqual(eco(sim));
    expect(copy.hash()).toBe(sim.hash());
    dip(sim).reputation = 60;
    dip(copy).reputation = 60;
    for (let d = 0; d < 3; d++) {
      toMonthStart(sim);
      toMonthStart(copy);
    }
    expect(copy.hash()).toBe(sim.hash());
    expect(total(copy, 'imports')).toBe(total(sim, 'imports'));
    expect(neighbour(copy, r.id).population).toBe(neighbour(sim, r.id).population);
  });
});

describe('M38: sanction commands from other players', () => {
  it('are checked in shape', () => {
    const bad = (cmd: Record<string, unknown>) => 'problem' in checkCommand(cmd);
    expect(bad({ type: 'setSanction', neighbour: 1, on: true })).toBe(false);
    expect(bad({ type: 'setSanction', neighbour: 1, on: false })).toBe(false);
    expect(bad({ type: 'setSanction', neighbour: 1, on: 'yes' })).toBe(true);
    expect(bad({ type: 'setSanction', neighbour: 1 })).toBe(true);
    expect(bad({ type: 'setSanction', neighbour: -1, on: true })).toBe(true);
    expect(bad({ type: 'setSanction', on: true })).toBe(true);
  });

  it('are a treaty matter (M39 roles): a player the host keeps from treaties can’t sanction', () => {
    const rules: SharedRules = { perms: { 2: ['speed'] }, host: 1, spendLimit: null, roles: true };
    const cmd = { type: 'setSanction', neighbour: 1, on: true } as const;
    expect(roomRefusal(rules, 2, cmd)).toMatch(/make or answer treaties/);
    expect(roomRefusal(rules, 1, cmd)).toBeNull();
  });
});

// Peaceful play is as it was: nothing here is touched without war.
describe('M38: sanctions in peace', () => {
  it('are nothing to a city without war: deals run and no state appears', () => {
    const sim = Sim.create({ seed: 'peace-sanctions', disasters: false });
    sim.testMode = true;
    const n = sim.state.region.neighbours.find((x) => x.kind === 'industrial')!;
    expect(
      sim.dispatch({ type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 100 }).ok,
    ).toBe(true);
    sim.advance(3 * H);
    expect(sim.state.region.deals[0]!.delivered).toBe(100);
    expect(sanctionsBetween(sim, n.id)).toBe(false);
    expect(sim.state.war).toBeUndefined();
    expect(INVEST.step).toBe(5);
  });
});
