import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { capacity } from '../src/sim/systems/region';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, newSim, serveTown } from './helpers';

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
