/**
 * Visible cars on a road that's rebuilt or split under them (phase 6 end): the frame grouped them into
 * lanes by reading their road's curve before dropping the cars whose road had gone, and threw "no
 * curve N" in the render loop (a phone's player drew a street across a busy one).
 */
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/client/world';
import { TrafficRenderer } from '../src/render/traffic';
import { TICKS_PER_HOUR } from '../src/sim/time';
import { buildTown, newSim, serveTown } from './helpers';

describe('visible cars when their road goes', () => {
  it('drops the cars on a road split under them without throwing', () => {
    const sim = newSim({ seed: 'carsgone' });
    buildTown(sim);
    serveTown(sim);
    for (let d = 0; d < 6; d++) sim.advance(TICKS_PER_HOUR * 24);
    // The rush hour: commuters on the roads.
    sim.advance(TICKS_PER_HOUR * ((24 + 8 - ((sim.tick / TICKS_PER_HOUR) % 24)) % 24));
    const world = new ClientWorld(sim.snapshot());
    world.applyFrame(sim.collectFrame());
    const cars = new TrafficRenderer(world, () => 0);
    let tick = sim.tick;
    for (let k = 0; k < 120; k++) cars.update((tick += 2));
    const onRoad = () =>
      cars.cars.filter((c) => c.leg < c.legs.length && !c.ring).map((c) => ({ seg: c.legs[c.leg]!.seg }));
    const before = onRoad();
    expect(before.length, 'cars out at the rush hour').toBeGreaterThan(4);
    // Every road a car is on, split by a street drawn across its middle.
    const roads = new Set(before.map((c) => c.seg));
    for (const id of roads) {
      const s = sim.state.net.segments.get(id);
      if (!s || s.type === 'highway') continue;
      const a = sim.state.net.nodes.get(s.a)!;
      const b = sim.state.net.nodes.get(s.b)!;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const dx = b.z - a.z;
      const dz = a.x - b.x;
      const n = Math.hypot(dx, dz) || 1;
      sim.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: mx - (dx / n) * 30, z: mz - (dz / n) * 30 },
          { x: mx + (dx / n) * 30, z: mz + (dz / n) * 30 },
        ],
      });
    }
    world.applyFrame(sim.collectFrame());
    const gone = before.filter((c) => !world.netState.segments.has(c.seg)).length;
    expect(gone, 'cars whose road was split').toBeGreaterThan(0);
    expect(() => {
      for (let k = 0; k < 30; k++) cars.update((tick += 2));
    }).not.toThrow();
    expect(onRoad().every((c) => world.netState.segments.has(c.seg))).toBe(true);
  });
});
