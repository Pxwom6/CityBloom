import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { freightHubs } from '../src/sim/systems/specialisations';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { connectPoint, newSim, placeAlong, road } from './helpers';
import { freightTown } from './freightTown';

describe('rail freight (M20)', () => {
  it('a terminal needs a railway along its back, and ships only when that track reaches the region', () => {
    const sim = newSim({ seed: 'fr' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
    const c = connectPoint(sim);
    const street = road(sim, [c, { x: c.x + 500, z: c.z }]).created!;
    // No railway near: it can't go down.
    const r = sim.preview({
      type: 'placeBuilding',
      def: 'railfreight',
      x: c.x + 250,
      z: c.z + 26,
      angle: 0,
      side: -1,
    });
    expect(r).toMatchObject({ ok: false });
    // Track behind a street, not linked to anything: the terminal goes down but doesn't ship.
    road(
      sim,
      [
        { x: c.x + 100, z: c.z + 50 },
        { x: c.x + 600, z: c.z + 50 },
      ],
      'rail',
    );
    const id = placeAlong(sim, 'railfreight', street[0]!);
    expect(sim.state.civics.get(id)).toBeDefined();
    expect(freightHubs(sim)).toBe(0);
  });

  it('a terminal linked to the regional railway takes the estate’s trucks off the roads', () => {
    // Industry a kilometre from the highway: every truck drives the avenue through town.
    const sim = newSim({ seed: 'goods' });
    const t = freightTown(sim);
    sim.advance(5 * TICKS_PER_MONTH);
    sim.finishMatching();
    const control = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    const term = t.railway();
    expect(freightHubs(sim)).toBe(1);
    sim.advance(3 * TICKS_PER_MONTH);
    control.advance(3 * TICKS_PER_MONTH);
    // Trucks to and from the region (the highway link) and along the avenue through town.
    const trucks = (s: Sim) => s.state.traffic.get(s.state.highway.segment) ?? 0;
    const corridor = (s: Sim) => s.state.traffic.get(t.corridor) ?? 0;
    expect(trucks(control)).toBeGreaterThan(200);
    expect(sim.railFreight.get(term) ?? 0).toBeGreaterThan(50);
    expect(trucks(sim)).toBeLessThan(trucks(control) * 0.6);
    expect(corridor(sim)).toBeLessThan(corridor(control) * 0.9);
  });
});
