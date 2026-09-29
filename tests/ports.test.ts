import { describe, expect, it } from 'vitest';
import { CIVIC } from '../src/data/civic';
import type { Sim } from '../src/sim/sim';
import { fieldAt } from '../src/sim/systems/pollution';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { berth } from '../src/sim/world/civic';
import { buildTown, connectPoint, newSim, placeAlong, road, roadsidePose, serveTown } from './helpers';

/** Place `def` along the first of these roads that has room for it; returns its id. */
function placeOn(sim: Sim, def: string, segs: number[]): number {
  const why = new Map<string, number>();
  const d = CIVIC.get(def)!;
  for (const id of segs) {
    if (!sim.state.net.segments.has(id)) continue;
    try {
      return placeAlong(sim, def, id);
    } catch {
      // Why not, for the error below.
      const len = sim.net.curve(id).length;
      for (let s = 20; s < len - 20; s += 30)
        for (const side of [1, -1] as const) {
          const r = sim.preview({ type: 'placeBuilding', def, ...roadsidePose(sim, id, s, side, d.d) });
          if (!r.ok) why.set(r.reason, (why.get(r.reason) ?? 0) + 1);
        }
    }
  }
  throw new Error(`nowhere for the ${def}: ${JSON.stringify([...why])}`);
}

/** A served town with a clock tower (visitors) and, off to one side, a long avenue with room. */
function townWithSights(seed: string) {
  const sim = newSim({ seed });
  buildTown(sim);
  serveTown(sim);
  const c = connectPoint(sim);
  const streets = [...sim.state.net.segments.values()].filter((s) => s.type === 'street').map((s) => s.id);
  const tower = placeOn(sim, 'clocktower', streets);
  sim.advance(TICKS_PER_MONTH);
  return { sim, c, tower };
}

describe('airport and seaport (M23)', () => {
  it('an airport raises visitor numbers, flies them in, and is loud along its runway', () => {
    const { sim, c } = townWithSights('region');
    sim.advance(TICKS_PER_HOUR * 2);
    const before = sim.state.tourism.visitors;
    expect(before).toBeGreaterThan(0);
    expect(sim.state.tourism.by!.air).toBe(0);
    // A long avenue north of town, and the airport beside it.
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
    let avenue: number[] = [];
    for (const dz of [-420, -480, -540, -360]) {
      const r = sim.preview({
        type: 'buildRoad',
        road: 'avenue',
        points: [
          { x: c.x + 40, z: c.z + dz },
          { x: c.x + 800, z: c.z + dz },
        ],
      });
      if (!r.ok) continue;
      avenue = road(
        sim,
        [
          { x: c.x + 40, z: c.z + dz },
          { x: c.x + 800, z: c.z + dz },
        ],
        'avenue',
      ).created!;
      // Joined to the end of the town's first side street.
      road(sim, [
        { x: c.x + 96, z: c.z + dz },
        { x: c.x + 96, z: c.z - 160 },
      ]);
      break;
    }
    expect(avenue.length).toBeGreaterThan(0);
    const airport = placeOn(sim, 'airport', avenue);
    sim.advance(TICKS_PER_HOUR * 4);
    const after = sim.state.tourism;
    console.log(`[ports] visitors ${before} → ${after.visitors} (${JSON.stringify(after.by)})`);
    expect(after.visitors).toBeGreaterThan(before * 1.4);
    expect(after.by!.air).toBeGreaterThan(before * 0.5);
    // Some drive into town from the airport, through the traffic model.
    sim.advance(TICKS_PER_HOUR * 2);
    expect(sim.regionFlows.visitors.air).toBeGreaterThan(0);
    // Business: shops feel the airport.
    expect(sim.state.demand.factors.C.some((f) => f.label === 'Airport')).toBe(true);
    // Loud along its runway, quieter across it, quiet far away.
    const a = sim.state.civics.get(airport)!;
    const def = CIVIC.get('airport')!;
    const noise = sim.noise();
    const along = fieldAt(
      noise,
      a.x + Math.cos(a.angle) * (def.w / 2 + 150),
      a.z + Math.sin(a.angle) * (def.w / 2 + 150),
    );
    const across = fieldAt(noise, a.x - Math.sin(a.angle) * 150, a.z + Math.cos(a.angle) * 150);
    expect(along).toBeGreaterThan(0.5);
    expect(across).toBeLessThan(along);
    expect(fieldAt(noise, a.x + 1500, a.z + 1500)).toBe(0);
  });

  it('a seaport needs deep water, then ships the goods off the highway and earns from trade', () => {
    const sim = newSim({ seed: 'port', preset: 'coast' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
    buildTown(sim);
    serveTown(sim);
    const c = connectPoint(sim);
    // Inland: no deep water behind it.
    const streets = [...sim.state.net.segments.values()].filter((s) => s.type === 'street').map((s) => s.id);
    expect(() => placeOn(sim, 'seaport', streets)).toThrow();
    // Out to the sea: an avenue east, then a street along the shore.
    let shoreStreet: number[] = [];
    for (const x of [1430, 1410, 1390, 1450, 1370]) {
      const pts = [
        { x, z: c.z - 400 },
        { x, z: c.z + 400 },
      ];
      if (!sim.preview({ type: 'buildRoad', road: 'street', points: pts }).ok) continue;
      if (
        !sim.preview({
          type: 'buildRoad',
          road: 'avenue',
          points: [
            { x: c.x + 480, z: c.z },
            { x, z: c.z },
          ],
        }).ok
      )
        continue;
      road(
        sim,
        [
          { x: c.x + 480, z: c.z },
          { x, z: c.z },
        ],
        'avenue',
      );
      shoreStreet = [...sim.state.net.segments.values()]
        .filter((s) => s.type === 'street' && Math.abs(sim.net.curve(s.id).pointAt(0).x - x) < 2)
        .map((s) => s.id);
      if (!shoreStreet.length) shoreStreet = road(sim, pts).created!;
      break;
    }
    expect(shoreStreet.length).toBeGreaterThan(0);
    sim.advance(TICKS_PER_MONTH * 2);
    const hwTrucks = () => sim.state.traffic.get(sim.state.highway.segment) ?? 0;
    const before = { highway: hwTrucks(), trade: sim.state.economy.month.trade ?? 0 };
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 250_000 });
    const port = placeOn(sim, 'seaport', shoreStreet);
    const p = sim.state.civics.get(port)!;
    expect(berth(sim, { ...p, side: p.side })).not.toBeNull();
    sim.advance(TICKS_PER_MONTH);
    const shipped = sim.railFreight.get(port) ?? 0;
    console.log(
      `[ports] seaport ships ${shipped} truckloads a day; highway ${Math.round(before.highway)} → ${Math.round(hwTrucks())}`,
    );
    expect(shipped).toBeGreaterThan(0);
    expect(sim.state.demand.factors.I.some((f) => f.label === 'Seaport')).toBe(true);
    const trade = sim.state.economy.history.at(-1)!.lines.trade ?? 0;
    expect(trade).toBeGreaterThan(before.trade);
  });
});
