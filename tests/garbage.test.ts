import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { GARBAGE } from '../src/data/civic';
import { MODULE } from '../src/data/modules';
import { garbageRate, trucksFor } from '../src/sim/systems/garbage';
import { civicUpkeep, roadsidePose, type Civic } from '../src/sim/world/civic';
import { TICKS_PER_HOUR, TICKS_PER_MONTH as TICKS_PER_DAY } from '../src/sim/time';
import { buildTown, newSim, road, serveTown } from './helpers';

const landfillOf = (sim: Sim) => [...sim.state.civics.values()].find((c) => c.def === 'landfill')!;

/** Hourly samples over some days: piles on the streets, garbage made and brought in. */
function measure(sim: Sim, lf: Civic, days: number) {
  let piles = 0;
  let maxPiles = 0;
  let produced = 0;
  const stored0 = lf.stored;
  const hours = days * 24;
  for (let h = 0; h < hours; h++) {
    for (const b of sim.state.buildings.values()) produced += garbageRate(sim, b);
    sim.advance(TICKS_PER_HOUR);
    const n = [...sim.state.buildings.values()].filter((b) => b.garbage >= GARBAGE.visible).length;
    piles += n;
    maxPiles = Math.max(maxPiles, n);
  }
  return { avgPiles: piles / hours, maxPiles, produced, collected: lf.stored - stored0 };
}

/**
 * The planned town, served, with its landfill moved to the end of a road `far` metres long out of
 * town (or, with `late`, not built yet: its pose is returned for later).
 */
function farTown(
  far: number,
  extraTrucks: number,
  late = false,
): { sim: Sim; lf: Civic; pose: { x: number; z: number; angle: number; side: 1 | -1 } } {
  const sim = newSim();
  buildTown(sim);
  serveTown(sim);
  sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: landfillOf(sim).id } });
  const ends = [...sim.state.net.nodes.values()].filter(
    (n) => n.x > 0 && sim.net.segmentsAt(n.id).length === 1,
  );
  // The cheapest way out of town (since M13 hilly routes can be built too, at a price).
  let best: { pts: { x: number; z: number }[]; cost: number } | null = null;
  for (const n of ends) {
    for (const [dx, dz] of [
      [0, -1],
      [0, 1],
      [1, 0],
    ] as const) {
      const pts = [
        { x: n.x, z: n.z },
        { x: n.x + dx * far, z: n.z + dz * far },
      ];
      const p = sim.preview({ type: 'buildRoad', road: 'street', points: pts });
      if (p.ok && (!best || p.cost! < best.cost)) best = { pts, cost: p.cost! };
    }
  }
  const seg = road(sim, best!.pts, 'street').created!.at(-1)!;
  const len = sim.net.curve(seg).length;
  const pose = roadsidePose(sim.net, seg, len - 40, 1, 48);
  if (late) return { sim, lf: null as unknown as Civic, pose };
  expect(sim.dispatch({ type: 'placeBuilding', def: 'landfill', ...pose }).ok).toBe(true);
  const lf = landfillOf(sim);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 50_000 });
  for (let k = 0; k < extraTrucks; k++)
    expect(sim.dispatch({ type: 'addModule', civic: lf.id, module: 'garbageTruck' }).ok).toBe(true);
  return { sim, lf, pose };
}

describe('garbage in the early game (playtest fixes)', () => {
  it('the playtest city: one landfill at the edge of town with its starting trucks keeps it clean', () => {
    // Ashton, 1,331 residents, one landfill 317 m from the town's centre. Before collection rounds
    // its four trucks were always out, came back with a fifth of a load, and 4–8 piles stayed.
    const sim = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    sim.testMode = true;
    const lf = landfillOf(sim);
    expect(trucksFor(sim, lf)).toBe(4);
    sim.advance(TICKS_PER_DAY);
    const m = measure(sim, lf, 3);
    expect(m.avgPiles).toBeLessThan(1);
    expect(m.maxPiles).toBeLessThanOrEqual(4);
    expect(m.collected).toBeGreaterThan(m.produced * 0.9);
  });

  it('a landfill built late, out at the edge: piles stop growing at the cap, then the starting trucks catch up', () => {
    const { sim, pose } = farTown(400, 0, true);
    // Four days without a landfill: garbage piles up, but no pile grows past the cap.
    sim.advance(TICKS_PER_DAY * 4);
    const buildings = [...sim.state.buildings.values()];
    expect(buildings.filter((b) => b.garbage >= GARBAGE.visible).length).toBeGreaterThan(20);
    expect(Math.max(...buildings.map((b) => b.garbage))).toBeLessThanOrEqual(GARBAGE.maxPile);
    // Then the landfill, with just its starting trucks.
    expect(sim.dispatch({ type: 'placeBuilding', def: 'landfill', ...pose }).ok).toBe(true);
    const lf = landfillOf(sim);
    expect(trucksFor(sim, lf)).toBe(4);
    sim.advance(TICKS_PER_DAY * 3);
    const m = measure(sim, lf, 3);
    expect(m.avgPiles).toBeLessThan(2);
    expect(m.collected).toBeGreaterThan(m.produced * 0.85);
  });

  it('extra trucks keep up where the starting ones fall behind (a landfill far out of town)', () => {
    const base = farTown(1100, 0);
    base.sim.advance(TICKS_PER_DAY * 3);
    const without = measure(base.sim, base.lf, 3);
    const more = farTown(1100, 3);
    more.sim.advance(TICKS_PER_DAY * 3);
    const withTrucks = measure(more.sim, more.lf, 3);
    expect(without.avgPiles).toBeGreaterThan(3);
    expect(withTrucks.avgPiles).toBeLessThan(without.avgPiles / 2);
    expect(withTrucks.collected / withTrucks.produced).toBeGreaterThan(without.collected / without.produced);
  });

  it('extra trucks are bought one at a time, up to four, each with a price and upkeep', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    const lf = landfillOf(sim);
    const truck = MODULE.get('garbageTruck')!;
    expect(truck.unlockPopulation).toBe(0);
    // Far cheaper than a second landfill.
    expect(truck.cost * 2).toBeLessThan(9_000 / 3);
    const upkeep0 = civicUpkeep(lf);
    for (let k = 1; k <= 4; k++) {
      const money = sim.state.treasury;
      expect(sim.dispatch({ type: 'addModule', civic: lf.id, module: 'garbageTruck' }).ok).toBe(true);
      expect(money - sim.state.treasury).toBe(truck.cost);
      expect(trucksFor(sim, lf)).toBe(4 + k);
      expect(civicUpkeep(lf)).toBe(upkeep0 + k * truck.upkeep);
    }
    const fifth = sim.dispatch({ type: 'addModule', civic: lf.id, module: 'garbageTruck' });
    expect(fifth.ok).toBe(false);
    // Trucks follow garbage funding like the rest of the fleet.
    sim.dispatch({ type: 'setFunding', dept: 'garbage', pct: 50 });
    expect(trucksFor(sim, lf)).toBeLessThan(8);
  });
});
