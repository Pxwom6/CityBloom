import { describe, expect, it } from 'vitest';
import { checkCommand } from '../../src/sim/commandCheck';
import { roomRefusal, type SharedRules } from '../../src/sim/rules';
import { Sim } from '../../src/sim/sim';
import { ARMS } from '../../src/data/warEconomy';
import { UNIT } from '../../src/data/war';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { regionExport } from '../../src/sim/systems/region';
import { armsCapacity, unitSale, warEconomySummary } from '../../src/sim/systems/warEconomy';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';
import {
  addUnit,
  clone,
  dip,
  eco,
  friendTakesPlace,
  lastMonth,
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
 * M38 step 4: arms trade with allies. Munitions are sold by the month from the war stores and units
 * outright; an embargo or a sanction on either side cuts both. The cities here have rival neighbours
 * and no buildings: nothing but the war economy moves the money.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/** A war city with its industrial neighbour (a big, warlike town) as an ally. */
function allyCity(): { sim: Sim; ally: number } {
  const sim = warCity();
  const a = ofKind(sim, 'industrial');
  a.rival!.personality = 'aggressive';
  a.population = 20_000;
  treaty(sim, a.id, [{ k: 'alliance' }]);
  return { sim, ally: a.id };
}

describe('M38: arms deals', () => {
  it('are made with an ally only, in steps, up to what its town takes', () => {
    const sim = warCity();
    const a = ofKind(sim, 'industrial');
    const arms = (neighbour: number, crates: number) => why(sim, { type: 'setArmsDeal', neighbour, crates });
    // An aggressive town of 20,000 takes 6 crates a month for each thousand.
    a.rival!.personality = 'aggressive';
    a.population = 20_000;
    expect(armsCapacity(a)).toBe(120);
    expect(arms(a.id, 40)).toMatch(/isn’t the city’s ally/);
    treaty(sim, a.id, [{ k: 'alliance' }]);
    expect(arms(a.id, 45)).toMatch(/steps of 10 crates a month, up to 300/);
    expect(arms(a.id, 310)).toMatch(/steps of 10 crates a month, up to 300/);
    expect(arms(a.id, -10)).toMatch(/steps of 10 crates a month/);
    expect(arms(a.id, 0)).toMatch(/no arms deal with/);
    expect(arms(99, 40)).toMatch(/No such neighbour/);
    expect(arms(a.id, 130)).toMatch(/takes 120 crates a month at most/);
    expect(arms(a.id, 120)).toBeNull();
    // A defensive pact makes an ally too; a careful town of 2,000 is too small to want any.
    const b = rivals(sim).find((n) => n.id !== a.id)!;
    b.rival!.personality = 'honourable';
    b.population = 2_000;
    treaty(sim, b.id, [{ k: 'defensivePact' }]);
    expect(armsCapacity(b)).toBe(0);
    expect(arms(b.id, 10)).toMatch(/too small to buy munitions/);
    // A war-hungry town of the same size takes some.
    b.rival!.personality = 'aggressive';
    expect(armsCapacity(b)).toBe(10);
    expect(arms(b.id, 10)).toBeNull();
    // The vassal is the city's own.
    b.rival!.vassal = { since: 0 };
    expect(arms(b.id, 10)).toMatch(/vassal/);
  });

  it('are refused with a reason for a friend’s city, and where war is off', () => {
    const sim = warCity();
    friendTakesPlace(sim);
    const friend = sim.state.region.neighbours.find((n) => n.player)!;
    expect(why(sim, { type: 'setArmsDeal', neighbour: friend.id, crates: 10 })).toMatch(/friend/);
    const peace = newSim({ disasters: false });
    expect(why(peace, { type: 'setArmsDeal', neighbour: 1, crates: 10 })).toBe('War is off in this city');
    expect(why(peace, { type: 'sellUnit', unit: 1, neighbour: 1 })).toBe('War is off in this city');
  });

  it('sell munitions out of the stores by the hour, at the crate price, as a ledger line', () => {
    const { sim, ally } = allyCity();
    stockUp(sim, 1_000);
    const t0 = sim.state.treasury;
    // A preview changes nothing, not even the existence of the war economy.
    expect(sim.preview({ type: 'setArmsDeal', neighbour: ally, crates: 120 })).toMatchObject({ ok: true });
    expect(sim.state.war!.economy).toBeUndefined();
    ok(sim, { type: 'setArmsDeal', neighbour: ally, crates: 120 });
    expect(eco(sim).arms![ally]).toMatchObject({ neighbour: ally, amount: 120, sold: 0, last: 0 });
    // 120 crates a month is five an hour, 190 dollars an hour at 38 a crate.
    expect(ARMS.price).toBe(38);
    expect(rate(sim, 'armsSales')).toBe(120 * 38);
    sim.advance(5 * H);
    const hours = (1_000 - sim.state.war!.stock.munitions) / 5;
    expect(hours).toBeGreaterThanOrEqual(4);
    expect(Number.isInteger(hours)).toBe(true);
    expect(sim.state.treasury - t0).toBe(hours * 190);
    expect(total(sim, 'armsSales')).toBe(hours * 190);
    expect(eco(sim).arms![ally]!.sold).toBe(hours * 5);
    // The month turns: what was sold is last month's, and a whole month sells what was agreed.
    toMonthStart(sim);
    const partial = eco(sim).arms![ally]!;
    expect(partial.sold).toBe(0);
    expect(partial.last).toBeGreaterThanOrEqual(hours * 5);
    expect(Math.abs(lastMonth(sim, 'armsSales') - partial.last * 38)).toBeLessThanOrEqual(1);
    toMonthStart(sim);
    expect(Math.abs(lastMonth(sim, 'armsSales') - 120 * 38)).toBeLessThanOrEqual(1);
    expect(eco(sim).arms![ally]!.last).toBeCloseTo(120, 2);
    // More or fewer crates: the same deal, changed, keeps its record.
    ok(sim, { type: 'setArmsDeal', neighbour: ally, crates: 30 });
    expect(eco(sim).arms![ally]).toMatchObject({ amount: 30, last: eco(sim).arms![ally]!.last });
    // The summary says so.
    const row = warEconomySummary(sim)!.neighbours.find((n) => n.id === ally)!;
    expect(row.arms).toMatchObject({ amount: 30 });
    expect(row.armsMax).toBe(120);
    expect(row.stopped).toBeNull();
    expect(warEconomySummary(sim)!.cratePrice).toBe(38);
    // 0 ends it, and nothing more is sold.
    ok(sim, { type: 'setArmsDeal', neighbour: ally, crates: 0 });
    expect(eco(sim).arms![ally]).toBeUndefined();
    expect(rate(sim, 'armsSales')).toBe(0);
    const stock = sim.state.war!.stock.munitions;
    sim.advance(3 * H);
    expect(sim.state.war!.stock.munitions).toBe(stock);
  });

  it('sell no more than the stores hold, and the projection follows what they can spare', () => {
    const { sim, ally } = allyCity();
    stockUp(sim, 12);
    ok(sim, { type: 'setArmsDeal', neighbour: ally, crates: 120 });
    expect(rate(sim, 'armsSales')).toBe(120 * 38);
    sim.advance(6 * H);
    // Twelve crates went (five, five, two), then the stores ran dry: nothing negative, nothing
    // earned from thin air.
    expect(sim.state.war!.stock.munitions).toBe(0);
    expect(total(sim, 'armsSales')).toBe(12 * 38);
    expect(eco(sim).arms![ally]!.sold).toBe(12);
    expect(eco(sim).arms![ally]!.fill).toBe(0);
    expect(rate(sim, 'armsSales')).toBe(0);
    // Crates in the stores again, and the deal carries on.
    stockUp(sim, 100);
    sim.advance(2 * H);
    expect(sim.state.war!.stock.munitions).toBeLessThan(100);
    expect(rate(sim, 'armsSales')).toBeGreaterThan(0);
  });

  it('share the stores between buyers, the lower-numbered neighbour first', () => {
    const sim = warCity();
    const [a, b] = rivals(sim);
    for (const n of [a!, b!]) {
      n.rival!.personality = 'aggressive';
      n.population = 20_000;
      treaty(sim, n.id, [{ k: 'alliance' }]);
      ok(sim, { type: 'setArmsDeal', neighbour: n.id, crates: 120 });
    }
    stockUp(sim, 7);
    // The first hour whose delivery runs: the neighbour that comes first gets its five, the next the last two.
    do sim.step();
    while (sim.state.war!.stock.munitions === 7);
    expect(eco(sim).arms![a!.id]!.sold).toBe(5);
    expect(eco(sim).arms![b!.id]!.sold).toBe(2);
    expect(eco(sim).arms![a!.id]!.fill).toBe(1);
    expect(eco(sim).arms![b!.id]!.fill).toBe(0.4);
  });

  it('end, with a notice, when the pact is over or the buyer has fallen to the city', () => {
    const { sim, ally } = allyCity();
    stockUp(sim, 1_000);
    ok(sim, { type: 'setArmsDeal', neighbour: ally, crates: 120 });
    sim.advance(2 * H);
    const pact = dip(sim).pacts.find((p) => p.term.k === 'alliance')!;
    ok(sim, { type: 'endPact', pact: pact.id });
    expect(eco(sim).arms![ally]).toBeDefined(); // until the next hour
    expect(rate(sim, 'armsSales')).toBe(0); // the projection already leaves it out
    const stock = sim.state.war!.stock.munitions;
    sim.advance(H);
    expect(eco(sim).arms![ally]).toBeUndefined();
    expect(sim.state.war!.stock.munitions).toBe(stock); // not a crate went after the pact ended
    expect(dip(sim).log.some((e) => /arms deal with .* ends: its pact with .* is over/.test(e.text))).toBe(
      true,
    );
    // Conquered: the buyer is the city's own.
    const second = allyCity();
    ok(second.sim, { type: 'setArmsDeal', neighbour: second.ally, crates: 30 });
    second.sim.state.region.neighbours.find((n) => n.id === second.ally)!.rival!.vassal = { since: 0 };
    second.sim.advance(H);
    expect(eco(second.sim).arms![second.ally]).toBeUndefined();
    expect(dip(second.sim).log.some((e) => /ends: .* has fallen to the city/.test(e.text))).toBe(true);
  });
});

describe('M38: unit sales', () => {
  it('pay 60 % of the unit’s price at full health, take the unit away and raise the ally’s forces', () => {
    const { sim, ally } = allyCity();
    const a = sim.state.region.neighbours.find((n) => n.id === ally)!;
    const tank = addUnit(sim, 'tank');
    const t0 = sim.state.treasury;
    const f0 = a.rival!.forces;
    const price = Math.round(UNIT.get('tank')!.cost * ARMS.unitShare);
    expect(price).toBe(4_800);
    expect(unitSale(UNIT.get('tank')!, 1)).toEqual({ price: 4_800, strength: 5 });
    // A preview changes nothing.
    expect(sim.preview({ type: 'sellUnit', unit: tank, neighbour: ally })).toMatchObject({
      ok: true,
      cost: -price,
    });
    expect(sim.state.war!.units.has(tank)).toBe(true);
    expect(sim.state.treasury).toBe(t0);
    const r = ok(sim, { type: 'sellUnit', unit: tank, neighbour: ally });
    expect(r.info).toMatchObject({ price, strength: 5 });
    expect(sim.state.treasury).toBe(t0 + price);
    expect(total(sim, 'unitsSold')).toBe(price);
    expect(sim.state.war!.units.has(tank)).toBe(false);
    expect(a.rival!.forces).toBe(Math.round((f0 + 5) * 10) / 10);
    // It is gone: it can't be sold twice.
    expect(why(sim, { type: 'sellUnit', unit: tank, neighbour: ally })).toBe('No such unit');
  });

  it('fetch less, and add less to the ally’s forces, for a unit that is hurt', () => {
    const { sim, ally } = allyCity();
    const a = sim.state.region.neighbours.find((n) => n.id === ally)!;
    const squad = addUnit(sim, 'infantry', 0.5);
    const f0 = a.rival!.forces;
    const t0 = sim.state.treasury;
    ok(sim, { type: 'sellUnit', unit: squad, neighbour: ally });
    expect(sim.state.treasury - t0).toBe(Math.round(1_500 * 0.6 * 0.5));
    expect(a.rival!.forces).toBe(Math.round((f0 + 0.5) * 10) / 10);
  });

  it('settle back towards what the ally’s character keeps, as after any gift', () => {
    const { sim, ally } = allyCity();
    const a = sim.state.region.neighbours.find((n) => n.id === ally)!;
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: ally, forces: 5, defences: 5 });
    // Target forces for 20,000 aggressive residents are 20 × 2.4 = 48: well above what 5 + a tank is.
    ok(sim, { type: 'sellUnit', unit: addUnit(sim, 'heavytank'), neighbour: ally });
    expect(a.rival!.forces).toBe(14);
    toMonthStart(sim);
    expect(a.rival!.forces).toBeGreaterThan(14);
  });

  it('are refused for a unit that is away, a superweapon, a raid on its way or a battle', () => {
    const { sim, ally } = allyCity();
    const sell = (unit: number) => why(sim, { type: 'sellUnit', unit, neighbour: ally });
    expect(sell(12345)).toBe('No such unit');
    const away = addUnit(sim, 'tank');
    sim.state.war!.units.get(away)!.away = 77;
    expect(sell(away)).toMatch(/tank is away with a force/);
    const bot = addUnit(sim, 'windupbot');
    expect(sell(bot)).toMatch(/never sold/);
    const spare = addUnit(sim, 'infantry');
    expect(sim.preview({ type: 'sellUnit', unit: spare, neighbour: ally })).toMatchObject({ ok: true });
    // A raid on its way: the forces stay to meet it.
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 6 });
    expect(sim.state.war!.incoming).toHaveLength(1);
    expect(sell(spare)).toMatch(/raid is on its way/);
    // A battle being fought in the city.
    const raid = sim.state.war!.incoming![0]!;
    sim.state.war!.incoming = [];
    delete sim.state.war!.incoming;
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0, neighbour: raid.from });
    expect(sim.state.war!.battle).toBeDefined();
    expect(sell(spare)).toMatch(/battle is being fought/);
    // The unit-level reasons show in the summary, whoever buys.
    const rows = warEconomySummary(sim)!.units;
    expect(rows.find((u) => u.id === spare)!.why).toMatch(/battle is being fought/);
    expect(rows.find((u) => u.id === bot)!.why).toMatch(/never sold/);
  });

  it('go to an ally only', () => {
    const { sim, ally } = allyCity();
    const other = rivals(sim).find((n) => n.id !== ally)!;
    const unit = addUnit(sim, 'infantry');
    expect(why(sim, { type: 'sellUnit', unit, neighbour: other.id })).toMatch(/isn’t the city’s ally/);
    expect(why(sim, { type: 'sellUnit', unit, neighbour: 99 })).toBe('No such neighbour');
    friendTakesPlace(sim);
    const friend = sim.state.region.neighbours.find((n) => n.player)!;
    expect(why(sim, { type: 'sellUnit', unit, neighbour: friend.id })).toMatch(/friend/);
    expect(sim.preview({ type: 'sellUnit', unit, neighbour: ally })).toMatchObject({ ok: true });
  });
});

describe('M38: an embargo cuts the trade it targets', () => {
  /**
   * The city allied with an industrial town (A) and a suburb (B). With each it has an arms deal and a
   * regional deal (power from A, water from B), all running.
   */
  function trading() {
    const sim = warCity();
    const a = ofKind(sim, 'industrial');
    const b = ofKind(sim, 'suburb');
    for (const n of [a, b]) {
      n.rival!.personality = 'aggressive';
      n.population = 24_000;
      treaty(sim, n.id, [{ k: 'alliance' }]);
    }
    stockUp(sim, 10_000);
    ok(sim, { type: 'setArmsDeal', neighbour: a.id, crates: 120 });
    ok(sim, { type: 'setArmsDeal', neighbour: b.id, crates: 120 });
    ok(sim, { type: 'setDeal', neighbour: a.id, resource: 'power', direction: 'buy', amount: 100 });
    ok(sim, { type: 'setDeal', neighbour: b.id, resource: 'water', direction: 'buy', amount: 100 });
    sim.advance(3 * H);
    return { sim, a, b };
  }
  const deal = (sim: Sim, id: number, resource: string) =>
    sim.state.region.deals.find((d) => d.neighbour === id && d.resource === resource);

  it('stops an arms deal and a power deal, refuses new ones with the reason, and leaves other trade alone', () => {
    const { sim, a, b } = trading();
    // Before: both neighbours' trade runs.
    expect(deal(sim, a.id, 'power')!.delivered).toBe(100);
    expect(deal(sim, b.id, 'water')!.delivered).toBe(100);
    expect(eco(sim).arms![a.id]!.sold).toBeGreaterThan(0);
    expect(eco(sim).arms![b.id]!.sold).toBeGreaterThan(0);
    expect(rate(sim, 'armsSales')).toBe(2 * 120 * 38);
    expect(rate(sim, 'imports')).toBe(-100 * 3 - 100 * 3);
    // A control city carries on with the same trade, to measure what the embargo costs and saves.
    const control = clone(sim);

    // The embargo on A is signed.
    treaty(sim, a.id, [{ k: 'embargo' }]);
    expect(dip(sim).pacts.some((p) => p.with === a.id && p.term.k === 'embargo')).toBe(true);
    // Both deals with A are gone at once, in the books and in the projection.
    expect(deal(sim, a.id, 'power')).toBeUndefined();
    expect(eco(sim).arms![a.id]).toBeUndefined();
    expect(dip(sim).log.some((e) => /arms deal with .* ends: an embargo is signed/.test(e.text))).toBe(true);
    expect(rate(sim, 'armsSales')).toBe(120 * 38);
    expect(rate(sim, 'imports')).toBe(-100 * 3);

    // Four hours on: nothing is delivered to or earned from A, and nothing is paid to it, while B's
    // trade goes on as the control's does with both.
    const armsBefore = total(sim, 'armsSales');
    const importsBefore = total(sim, 'imports');
    const controlArmsBefore = total(control, 'armsSales');
    const controlImportsBefore = total(control, 'imports');
    const soldToB = eco(sim).arms![b.id]!.sold;
    sim.advance(4 * H);
    control.advance(4 * H);
    expect(total(sim, 'armsSales') - armsBefore).toBe(4 * 190);
    expect(total(control, 'armsSales') - controlArmsBefore).toBe(2 * 4 * 190);
    expect(eco(sim).arms![b.id]!.sold - soldToB).toBe(20);
    expect(Math.abs(total(sim, 'imports') - importsBefore + 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(total(control, 'imports') - controlImportsBefore + 100)).toBeLessThanOrEqual(1);
    expect(deal(sim, b.id, 'water')!.delivered).toBe(100);

    // New ones are refused, with the reason.
    const embargo = /under embargo/;
    expect(why(sim, { type: 'setArmsDeal', neighbour: a.id, crates: 30 })).toMatch(embargo);
    expect(
      why(sim, { type: 'setDeal', neighbour: a.id, resource: 'power', direction: 'buy', amount: 50 }),
    ).toMatch(embargo);
    expect(why(sim, { type: 'sellUnit', unit: addUnit(sim, 'infantry'), neighbour: a.id })).toMatch(embargo);
    const row = warEconomySummary(sim)!.neighbours.find((n) => n.id === a.id)!;
    expect(row.stopped).toMatch(embargo);
    expect(row.armsBuy).toMatch(embargo);
    expect(row.sellUnits).toMatch(embargo);
    // Trade with B is not refused, and the unit sale to B goes through.
    expect(why(sim, { type: 'setArmsDeal', neighbour: b.id, crates: 30 })).toBeNull();
    expect(
      why(sim, { type: 'setDeal', neighbour: b.id, resource: 'water', direction: 'buy', amount: 50 }),
    ).toBeNull();
    expect(why(sim, { type: 'sellUnit', unit: addUnit(sim, 'infantry'), neighbour: b.id })).toBeNull();

    // Trade resumes with a treaty, and the new deals are allowed again.
    treaty(sim, a.id, [{ k: 'trade' }]);
    expect(why(sim, { type: 'setArmsDeal', neighbour: a.id, crates: 30 })).toBeNull();
    expect(
      why(sim, { type: 'setDeal', neighbour: a.id, resource: 'power', direction: 'buy', amount: 50 }),
    ).toBeNull();
  });

  it('stops a deal that survives the embargo (an imposed one planted beside it): M36’s check at the hour', () => {
    const { sim, a, b } = trading();
    // Where the embargo's signing clears deals, an embargo that arrived any other way would not: the
    // hourly delivery checks it too.
    dip(sim).pacts.push({ id: 9_001, with: a.id, term: { k: 'embargo' }, since: sim.state.tick });
    expect(deal(sim, a.id, 'power')).toBeDefined();
    expect(eco(sim).arms![a.id]).toBeDefined();
    const armsBefore = total(sim, 'armsSales');
    const stock = sim.state.war!.stock.munitions;
    sim.advance(H);
    // The regional deal delivers nothing and pays nothing from the hour it was checked; the arms deal ends.
    expect(deal(sim, a.id, 'power')!.delivered).toBe(0);
    expect(eco(sim).arms![a.id]).toBeUndefined();
    expect(armsBefore).toBeGreaterThan(0);
    expect(stock - sim.state.war!.stock.munitions).toBe(5); // only B's crates left the stores
    expect(rate(sim, 'imports')).toBe(-100 * 3); // B's water alone
    sim.advance(3 * H);
    expect(deal(sim, a.id, 'power')!.delivered).toBe(0);
    expect(deal(sim, b.id, 'water')!.delivered).toBe(100);
    // Selling is checked too (what a neighbour would take of the city's spare power).
    const c = ofKind(sim, 'resort');
    dip(sim).pacts.push({ id: 9_002, with: c.id, term: { k: 'embargo' }, since: sim.state.tick });
    const sale = 9_100;
    sim.state.region.deals.push({
      id: sale,
      neighbour: c.id,
      resource: 'power',
      direction: 'sell',
      amount: 50,
      delivered: 0,
      since: sim.state.tick,
    });
    expect(regionExport(sim, 'power', 1_000)).toBe(0);
    expect(sim.state.region.deals.find((d) => d.id === sale)!.delivered).toBe(0);
    dip(sim).pacts = dip(sim).pacts.filter((p) => p.id !== 9_002);
    expect(regionExport(sim, 'power', 1_000)).toBeGreaterThan(0);
  });

  it('keeps garbage moving only where trade is open, in a grown town’s hourly round', () => {
    const sim = newSim({ seed: 'region', rivals: true, disasters: false });
    buildTown(sim);
    serveTown(sim);
    sim.advance(2 * M);
    let placed = false;
    for (const seg of sim.state.net.segments.values()) {
      if (seg.type === 'highway') continue;
      try {
        placeAlong(sim, 'landfill', seg.id);
        placed = true;
        break;
      } catch {
        /* the next road */
      }
    }
    expect(placed).toBe(true);
    const landfill = [...sim.state.civics.values()].find((c) => c.def === 'landfill')!;
    const n = ofKind(sim, 'industrial');
    ok(sim, { type: 'setDeal', neighbour: n.id, resource: 'garbage', direction: 'buy', amount: 600 });
    landfill.stored = 5_000;
    sim.advance(6 * H);
    expect(sim.state.region.deals[0]!.delivered).toBeGreaterThan(0);
    const emptied = 5_000 - landfill.stored;
    expect(emptied).toBeGreaterThan(0);
    // An embargo that does not clear the deal: the lorries stop coming.
    treaty(sim, ofKind(sim, 'resort').id, [{ k: 'nonAggression', months: 12 }]); // (makes the diplomacy)
    dip(sim).pacts.push({ id: 9_003, with: n.id, term: { k: 'embargo' }, since: sim.state.tick });
    landfill.stored = 5_000;
    sim.advance(6 * H);
    expect(sim.state.region.deals[0]!.delivered).toBe(0);
    expect(landfill.stored).toBeGreaterThanOrEqual(5_000);
  });
});

describe('M38: arms trade in a saved city', () => {
  it('survives a save and a load, and the copy plays on to the same state', () => {
    const { sim, ally } = allyCity();
    stockUp(sim, 500);
    ok(sim, { type: 'setArmsDeal', neighbour: ally, crates: 60 });
    sim.advance(2 * M);
    ok(sim, { type: 'sellUnit', unit: addUnit(sim, 'tank'), neighbour: ally });
    const copy = clone(sim);
    expect(eco(copy)).toEqual(eco(sim));
    expect(copy.hash()).toBe(sim.hash());
    sim.advance(2 * M);
    copy.advance(2 * M);
    expect(copy.hash()).toBe(sim.hash());
    expect(total(copy, 'armsSales')).toBe(total(sim, 'armsSales'));
    expect(total(sim, 'armsSales')).toBeGreaterThan(0);
  });
});

describe('M38: arms commands from other players', () => {
  it('are checked in shape', () => {
    const bad = (cmd: Record<string, unknown>) => 'problem' in checkCommand(cmd);
    expect(bad({ type: 'setArmsDeal', neighbour: 1, crates: 40 })).toBe(false);
    expect(bad({ type: 'setArmsDeal', neighbour: 1, crates: 0 })).toBe(false);
    expect(bad({ type: 'setArmsDeal', neighbour: 1, crates: 301 })).toBe(true);
    expect(bad({ type: 'setArmsDeal', neighbour: 1, crates: -10 })).toBe(true);
    expect(bad({ type: 'setArmsDeal', neighbour: 1, crates: 2.5 })).toBe(true);
    expect(bad({ type: 'setArmsDeal', neighbour: 1, crates: '40' })).toBe(true);
    expect(bad({ type: 'setArmsDeal', crates: 40 })).toBe(true);
    expect(bad({ type: 'sellUnit', unit: 5, neighbour: 2 })).toBe(false);
    expect(bad({ type: 'sellUnit', unit: 5 })).toBe(true);
    expect(bad({ type: 'sellUnit', neighbour: 2 })).toBe(true);
    expect(bad({ type: 'sellUnit', unit: 'x', neighbour: 2 })).toBe(true);
  });

  it('are the city’s money: a player without the host’s say-so on money can’t sell arms', () => {
    const rules: SharedRules = { perms: { 2: ['speed'] }, host: 1, spendLimit: null };
    const cmds = [
      { type: 'setArmsDeal', neighbour: 1, crates: 40 },
      { type: 'sellUnit', unit: 5, neighbour: 1 },
    ] as const;
    for (const cmd of cmds) {
      expect(roomRefusal(rules, 2, cmd), cmd.type).toMatch(/taxes, the budget or loans/);
      expect(roomRefusal(rules, 1, cmd), cmd.type).toBeNull();
    }
  });
});
