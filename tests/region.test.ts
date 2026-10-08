import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { UTILITY_USE } from '../src/data/civic';
import { CLIMATES, WEATHER } from '../src/data/climate';
import { NEIGHBOUR_KIND, REGION, type DealResource } from '../src/data/region';
import { ZONE_R, ZONE_C } from '../src/data/zones';
import { Sim } from '../src/sim/sim';
import { advise } from '../src/sim/systems/advisors';
import { capacity } from '../src/sim/systems/region';
import { civicOutput, powerOutlook, supplyBalance, winterOutlook } from '../src/sim/systems/utilities';
import { weatherUse } from '../src/sim/systems/weather';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { BState } from '../src/sim/world/buildings';
import { buildTown, newSim, placeAlong, serveTown } from './helpers';

/** A grown town on coal and pumps (two months), for the deals to work on. */
function town(seed = 'region'): { sim: Sim; civics: number[] } {
  const sim = newSim({ seed });
  buildTown(sim);
  const { civics } = serveTown(sim);
  sim.advance(TICKS_PER_MONTH * 2);
  return { sim, civics };
}

/** A ledger line this month so far, plus last month's in case the month just turned. */
const line = (sim: Sim, k: string) =>
  (sim.state.economy.month[k] ?? 0) + (sim.state.economy.history.at(-1)?.lines[k] ?? 0);

const byKind = (sim: Sim, kind: string) => sim.state.region.neighbours.find((n) => n.kind === kind)!;

type Res = 'power' | 'water';

/** A copy of the city as it stands (it plays on identically, so it can serve as a control). */
const clone = (s: Sim): Sim => {
  const c = Sim.fromSave(JSON.parse(JSON.stringify(s.save())));
  c.testMode = true;
  return c;
};

/** What went through last hour on all the deals for a resource, one way. */
const total = (sim: Sim, res: DealResource, dir: 'buy' | 'sell') =>
  sim.state.region.deals
    .filter((d) => d.resource === res && d.direction === dir)
    .reduce((a, d) => a + d.delivered, 0);

/** Sell as much as every neighbour will take; returns the sum of the contracts. */
const sellToAll = (sim: Sim, res: Res): number => {
  let contracted = 0;
  for (const n of sim.state.region.neighbours) {
    const amount = capacity(sim, n, res, 'sell');
    if (amount <= 0) continue;
    sim.dispatch({ type: 'setDeal', neighbour: n.id, resource: res, direction: 'sell', amount });
    contracted += amount;
  }
  return contracted;
};

describe('region (M23)', () => {
  it('has three neighbours of different characters that grow or shrink, the same for the same seed', () => {
    const a = newSim({ seed: 'north' });
    const b = newSim({ seed: 'north' });
    const n = a.state.region.neighbours;
    expect(n.map((x) => x.kind).sort()).toEqual(['industrial', 'resort', 'suburb']);
    expect(new Set(n.map((x) => x.name)).size).toBe(3);
    expect(new Set(n.map((x) => x.side)).size).toBe(3);
    expect(b.state.region).toEqual(a.state.region);
    const start = n.map((x) => x.population);
    a.advance(TICKS_PER_MONTH * 12);
    const after = a.state.region.neighbours.map((x) => x.population);
    expect(after).not.toEqual(start);
    for (const x of a.state.region.neighbours) {
      expect(x.history).toHaveLength(13);
      expect(x.population).toBeGreaterThan(1_000);
    }
    // Another seed, other towns.
    expect(newSim({ seed: 'south' }).state.region.neighbours.map((x) => x.name)).not.toEqual(
      n.map((x) => x.name),
    );
  });

  it('a power deal covers a shortage: bought power reaches the homes, and is paid for', () => {
    const { sim, civics } = town();
    const coal = civics[0]!;
    expect(sim.state.civics.get(coal)!.def).toBe('coal');
    // The coal plant closes: the town goes dark.
    sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: coal } });
    sim.advance(TICKS_PER_HOUR * 2);
    const short = sim.state.utilityStats.power;
    expect(short.supply).toBe(0);
    expect(short.unserved).toBeGreaterThan(0);
    // Buy what's needed from the industrial town, with a margin.
    const ind = byKind(sim, 'industrial');
    const need = Math.ceil(short.demand * 1.2);
    expect(capacity(sim, ind, 'power', 'buy')).toBeGreaterThan(need);
    expect(
      sim.dispatch({ type: 'setDeal', neighbour: ind.id, resource: 'power', direction: 'buy', amount: need }),
    ).toMatchObject({ ok: true });
    sim.advance(TICKS_PER_HOUR * 2);
    const p = sim.state.utilityStats.power;
    console.log(`[region] power deal: ${need} MW bought, demand ${p.demand}, unserved ${p.unserved}`);
    expect(p.supply).toBe(need);
    expect(p.unserved).toBe(0);
    expect(line(sim, 'imports')).toBeLessThan(0);
    // A neighbour that doesn't sell power can't be asked to.
    const resort = byKind(sim, 'resort');
    expect(
      sim.dispatch({
        type: 'setDeal',
        neighbour: resort.id,
        resource: 'power',
        direction: 'buy',
        amount: 10,
      }),
    ).toMatchObject({ ok: false });
    // Ending the deal ends the supply.
    sim.dispatch({ type: 'setDeal', neighbour: ind.id, resource: 'power', direction: 'buy', amount: 0 });
    sim.advance(TICKS_PER_HOUR * 2);
    expect(sim.state.utilityStats.power.supply).toBe(0);
  });

  it('power sold comes only from what the city has spare, and earns money', () => {
    const { sim } = town();
    const before = sim.state.utilityStats.power;
    const spare = before.supply - before.demand;
    expect(spare).toBeGreaterThan(100);
    const buyer = sim.state.region.neighbours.find((n) => capacity(sim, n, 'power', 'sell') > 0)!;
    // Offer far more than is spare: only the spare goes, and no home loses power.
    sim.dispatch({
      type: 'setDeal',
      neighbour: buyer.id,
      resource: 'power',
      direction: 'sell',
      amount: capacity(sim, buyer, 'power', 'sell'),
    });
    sim.advance(TICKS_PER_HOUR * 2);
    const deal = sim.state.region.deals[0]!;
    const after = sim.state.utilityStats.power;
    expect(deal.delivered).toBeGreaterThan(0);
    expect(deal.delivered).toBeLessThanOrEqual(Math.min(deal.amount, spare + 20));
    expect(after.unserved).toBe(0);
    expect(line(sim, 'exports')).toBeGreaterThan(0);
  });

  describe('bought power and water are never resold (P8)', () => {
    it.each([
      ['power', 'industrial'],
      ['water', 'suburb'],
    ] as const)('buying %s does not raise what the city sells', (res, seller) => {
      const { sim } = town();
      const contracted = sellToAll(sim, res);
      sim.advance(TICKS_PER_HOUR * 2);
      const soldBefore = total(sim, res, 'sell');
      // The city's own spare is what limits the sale, so the bug would show.
      expect(soldBefore).toBeGreaterThan(0);
      expect(soldBefore).toBeLessThan(contracted);
      const ctrl = clone(sim);
      const from = byKind(sim, seller);
      const amount = capacity(sim, from, res, 'buy');
      expect(amount).toBeGreaterThan(0);
      expect(
        sim.dispatch({ type: 'setDeal', neighbour: from.id, resource: res, direction: 'buy', amount }),
      ).toMatchObject({ ok: true });
      sim.advance(TICKS_PER_HOUR * 2);
      ctrl.advance(TICKS_PER_HOUR * 2);
      // Same days, same city: what it sells is what it itself has to spare, bought or not.
      expect(Math.abs(total(sim, res, 'sell') - total(ctrl, res, 'sell'))).toBeLessThanOrEqual(1);
      expect(total(sim, res, 'buy')).toBeGreaterThan(0);
      expect(sim.state.utilityStats[res].unserved).toBe(0);
      // And never more than the city makes less what it uses.
      const bought = total(sim, res, 'buy');
      const sold = total(sim, res, 'sell');
      const stat = sim.state.utilityStats[res];
      expect(sold).toBeLessThanOrEqual(stat.supply - bought - (stat.demand - sold) + 1);
    });

    it('a shortage covered by a power deal leaves nothing to resell', () => {
      const { sim, civics } = town();
      sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: civics[0]! } });
      sim.advance(TICKS_PER_HOUR * 2);
      const resort = byKind(sim, 'resort');
      sim.dispatch({
        type: 'setDeal',
        neighbour: resort.id,
        resource: 'power',
        direction: 'sell',
        amount: capacity(sim, resort, 'power', 'sell'),
      });
      const ind = byKind(sim, 'industrial');
      const need = Math.ceil(sim.state.utilityStats.power.demand * 1.2);
      sim.dispatch({ type: 'setDeal', neighbour: ind.id, resource: 'power', direction: 'buy', amount: need });
      sim.advance(TICKS_PER_HOUR * 2);
      const p = sim.state.utilityStats.power;
      // The 20 % margin is bought power, not the city's own: it is not sold on.
      expect(total(sim, 'power', 'sell')).toBe(0);
      expect(p.unserved).toBe(0);
      expect(p.supply).toBe(need);
    });
  });

  it('a garbage deal empties the landfill a little each hour', () => {
    const { sim, civics } = town();
    const landfill = [...sim.state.civics.values()].find((c) => c.def === 'landfill')!;
    expect(civics).toContain(landfill.id);
    landfill.stored = 5_000;
    const ind = byKind(sim, 'industrial');
    const amount = Math.min(600, capacity(sim, ind, 'garbage', 'buy'));
    expect(amount).toBeGreaterThan(100);
    sim.dispatch({ type: 'setDeal', neighbour: ind.id, resource: 'garbage', direction: 'buy', amount });
    const stored = landfill.stored;
    sim.advance(TICKS_PER_HOUR * 12);
    // Half a day's contract taken away, less whatever the trucks brought in meanwhile.
    expect(landfill.stored).toBeLessThan(stored);
    expect(sim.state.region.deals[0]!.delivered).toBeGreaterThan(0);
  });

  it('older saves get neighbours and play on; the region survives a save and load exactly', () => {
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    expect(old.state.region.neighbours).toHaveLength(3);
    expect(old.state.region.deals).toEqual([]);
    expect(old.state.rng.region).toHaveLength(4);
    const pop = old.state.totals.population;
    old.advance(TICKS_PER_MONTH);
    expect(old.state.totals.population).toBeGreaterThan(pop * 0.9);
    const ind = old.state.region.neighbours.find((n) => n.kind === 'industrial')!;
    old.dispatch({ type: 'setDeal', neighbour: ind.id, resource: 'power', direction: 'buy', amount: 50 });
    const again = Sim.fromSave(JSON.parse(JSON.stringify(old.save())));
    expect(again.hash()).toBe(old.hash());
    old.advance(TICKS_PER_MONTH);
    again.advance(TICKS_PER_MONTH);
    expect(again.state.region).toEqual(old.state.region);
  });
});

describe('the Region panel shows supply and demand (P20)', () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const coldest = WEATHER.heatBelow - WEATHER.heatSpan; // heating at its fullest (cold = 1)

  /** The town with a power and water deal each way, and a control that was left alone. */
  function trading() {
    const { sim, civics } = town();
    const ctrl = clone(sim);
    sellToAll(sim, 'power');
    sellToAll(sim, 'water');
    sim.dispatch({
      type: 'setDeal',
      neighbour: byKind(sim, 'industrial').id,
      resource: 'power',
      direction: 'buy',
      amount: 300,
    });
    sim.dispatch({
      type: 'setDeal',
      neighbour: byKind(sim, 'suburb').id,
      resource: 'water',
      direction: 'buy',
      amount: 200,
    });
    sim.advance(TICKS_PER_HOUR * 2);
    ctrl.advance(TICKS_PER_HOUR * 2);
    return { sim, ctrl, civics };
  }

  it.each(['power', 'water'] as const)(
    '%s: what is made and used adds up with what crosses the border',
    (res) => {
      const { sim, ctrl } = trading();
      const b = supplyBalance(sim)[res];
      const stat = sim.state.utilityStats[res];
      expect(b.bought).toBeGreaterThan(0);
      expect(b.sold).toBeGreaterThan(0);
      expect(b.bought).toBe(total(sim, res, 'buy'));
      expect(b.sold).toBe(total(sim, res, 'sell'));
      // The stats count what's bought as supply and what's sold as demand.
      expect(b.make + b.bought).toBe(stat.supply);
      expect(b.use + b.sold).toBe(stat.demand);
      // What the city makes is what its own plants give; what it uses is what a city without the
      // deals uses.
      const own = sum(
        [...sim.state.civics.values()].filter((c) => c.access).map((c) => civicOutput(sim, c, res)),
      );
      expect(b.make).toBe(Math.round(own));
      expect(b.use).toBe(supplyBalance(ctrl)[res].use);
      expect(b.make).toBeGreaterThan(0);
    },
  );

  it('garbage: made, processed, room left, and what the neighbours take or send', () => {
    const { sim, civics } = town();
    const landfill = [...sim.state.civics.values()].find((c) => c.def === 'landfill')!;
    expect(civics).toContain(landfill.id);
    const g0 = supplyBalance(sim).garbage;
    const detail = sim.civicDetails(landfill.id)!.garbage!;
    expect(g0.made).toBe(detail.producedPerDay);
    expect(g0.made).toBeGreaterThan(0);
    expect(g0.room).toBe(Math.round(detail.storage - landfill.stored));
    expect(g0.process).toBe(0);
    expect(g0.sent + g0.taken).toBe(0);
    // A recycling centre processes 1,600 a day.
    let placed = false;
    for (const seg of sim.state.net.segments.values()) {
      if (seg.type === 'highway') continue;
      try {
        placeAlong(sim, 'recycling', seg.id);
        placed = true;
        break;
      } catch {
        /* the next road */
      }
    }
    expect(placed).toBe(true);
    expect(supplyBalance(sim).garbage.process).toBe(1600);
    // A neighbour that takes garbage: what it takes is what the deal delivered, a day.
    landfill.stored = 5_000;
    const ind = byKind(sim, 'industrial');
    sim.dispatch({
      type: 'setDeal',
      neighbour: ind.id,
      resource: 'garbage',
      direction: 'buy',
      amount: Math.min(600, capacity(sim, ind, 'garbage', 'buy')),
    });
    sim.advance(TICKS_PER_HOUR * 12);
    const g1 = supplyBalance(sim).garbage;
    expect(g1.sent).toBe(sim.state.region.deals[0]!.delivered);
    expect(g1.sent).toBeGreaterThan(0);
    expect(g1.taken).toBe(0);
  });

  it('the ledger line is last month’s imports and exports, and absent before a month has closed', () => {
    const fresh = newSim({ seed: 'region' });
    expect(supplyBalance(fresh).ledger).toBeNull();
    const { sim } = trading();
    sim.advance(TICKS_PER_MONTH * 2);
    const last = sim.state.economy.history.at(-1)!.lines;
    const ledger = supplyBalance(sim).ledger!;
    expect(ledger.imports).toBe(Math.round(-last.imports!));
    expect(ledger.exports).toBe(Math.round(last.exports!));
    expect(ledger.imports).toBeGreaterThan(0);
    expect(ledger.exports).toBeGreaterThan(0);
  });

  describe('the winter forecast', () => {
    /** The city's own power need with every zone heating by its own factor, worked out here. */
    function ownNeed(sim: Sim, mean: number): number {
      const cold = Math.max(0, Math.min(1, (WEATHER.heatBelow - mean) / WEATHER.heatSpan));
      let n = 0;
      for (const b of sim.state.buildings.values()) {
        if (b.state !== BState.Active) continue;
        const z = b.zone === ZONE_R ? 'R' : b.zone === ZONE_C ? 'C' : 'I';
        n += b.cap * UTILITY_USE.power[b.zone]! * (1 + WEATHER.heating[z] * cold);
      }
      return n;
    }

    /** What the old forecast made of the city: all of today's demand, exports included, scaled by the homes' factor. */
    function oldNeed(sim: Sim, mean: number): number {
      const w = sim.state.weather;
      return (
        (sim.state.utilityStats.power.demand * weatherUse({ ...w, mean }).power.R) /
        weatherUse(w, sim.state.tick).power.R
      );
    }

    it('needs the city’s own buildings only, each zone heating by its own factor', () => {
      const { sim, ctrl } = trading();
      const out = powerOutlook(sim, coldest);
      expect(out.need).toBeCloseTo(ownNeed(sim, coldest), 6);
      // Selling power on doesn't change what the city itself will need.
      expect(out.need).toBeCloseTo(powerOutlook(ctrl, coldest).need, 6);
      expect(oldNeed(sim, coldest)).toBeGreaterThan(out.need * 1.05);
    });

    it('counts bought power only as far as the neighbour can still send in the cold', () => {
      const { sim } = town();
      const ind = byKind(sim, 'industrial');
      const full = capacity(sim, ind, 'power', 'buy');
      sim.dispatch({ type: 'setDeal', neighbour: ind.id, resource: 'power', direction: 'buy', amount: full });
      sim.advance(TICKS_PER_HOUR * 2);
      const w = { ...sim.state.weather, mean: coldest };
      const rate = NEIGHBOUR_KIND.industrial.per.sell.power;
      expect(capacity(sim, ind, 'power', 'buy', w)).toBe(
        Math.floor(((rate * ind.population) / 1000) * (1 - REGION.winterPowerCut)),
      );
      const deal = sim.state.region.deals[0]!;
      expect(deal.delivered).toBeGreaterThan(0);
      const then = Math.min(deal.amount, capacity(sim, ind, 'power', 'buy', w));
      expect(then).toBeLessThan(deal.delivered);
      const out = powerOutlook(sim, coldest);
      expect(out.have).toBe(sim.state.utilityStats.power.supply - deal.delivered + then);
      expect(out.cut).toBe(deal.delivered - then);
    });

    it('does not warn when the city’s own power covers its own winter, however much it sells', () => {
      const { sim } = town();
      sellToAll(sim, 'power');
      sim.advance(TICKS_PER_MONTH * 5 + TICKS_PER_HOUR * 2); // October
      const o = winterOutlook(sim)!;
      expect(o.months).toBe(2);
      expect(sim.state.region.deals.length).toBeGreaterThan(0);
      expect(o.have).toBeGreaterThan(o.need * 1.05);
      // The old forecast counted the exports as need and would have cried wolf.
      expect(sim.state.utilityStats.power.supply).toBeLessThan(
        oldNeed(sim, Math.min(...CLIMATES[sim.state.weather.climate].temps)) * 1.05,
      );
      expect(advise(sim).map((a) => a.title)).not.toContain('Winter will need more power');
      // Starve the plant and it does warn, with the city's own need and what it has.
      sim.dispatch({ type: 'setFunding', dept: 'power', pct: 55 });
      sim.advance(TICKS_PER_HOUR * 2);
      const short = winterOutlook(sim)!;
      expect(short.have).toBeLessThan(short.need);
      const warn = advise(sim).find((a) => a.title === 'Winter will need more power')!;
      expect(warn).toBeTruthy();
      expect(warn.text).toContain(`${Math.round(short.need).toLocaleString('en-US')} MW`);
      expect(warn.text).toContain(`${Math.round(short.have).toLocaleString('en-US')} MW`);
    });

    it('is absent with seasons off', () => {
      const { sim } = town();
      sim.state.weather.seasons = false;
      expect(winterOutlook(sim)).toBeNull();
      expect(supplyBalance(sim).winter).toBeNull();
    });
  });
});
