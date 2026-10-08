import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/client/world';
import { TICKS_PER_HOUR } from '../src/sim/time';
import { buildTown, connectPoint, newSim, road, serveTown } from './helpers';

/**
 * PR #14 review: the client worked out cut-off roads (P1) again on every network update, and most
 * of those only touch zone blocks (a building grows or goes on every lot change). They're worked out
 * when a road or junction changes, and not otherwise.
 */
describe('cut-off roads on the client', () => {
  it('are worked out again when roads change, not when only blocks do', () => {
    const sim = newSim({ seed: 'islands' });
    buildTown(sim);
    serveTown(sim);
    // A street off on its own, so there's an island to find.
    const c = connectPoint(sim);
    road(sim, [
      { x: c.x + 200, z: c.z + 420 },
      { x: c.x + 360, z: c.z + 420 },
    ]);
    const world = new ClientWorld(sim.snapshot());
    world.applyFrame(sim.collectFrame());
    const first = world.roadIslands();
    expect(first.list.length).toBe(1);
    const roads = world.roadsVersion;

    // A few days of growth: lots fill, which reaches the client as block-only network updates.
    let blockOnly = 0;
    for (let h = 0; h < 24 * 6; h++) {
      sim.advance(TICKS_PER_HOUR);
      const f = sim.collectFrame();
      if (f.net && !f.net.segments.length && !f.net.nodes.length && !f.net.removedSegments.length)
        blockOnly++;
      world.applyFrame(f);
    }
    expect(blockOnly).toBeGreaterThan(0);
    expect(world.roadsVersion).toBe(roads);
    expect(world.roadIslands()).toBe(first);

    // A road joining it to the avenue is a change it has to see.
    road(sim, [
      { x: c.x + 340, z: c.z + 420 },
      { x: c.x + 340, z: c.z },
    ]);
    world.applyFrame(sim.collectFrame());
    expect(world.roadsVersion).toBeGreaterThan(roads);
    const after = world.roadIslands();
    expect(after).not.toBe(first);
    expect(after.list.length).toBe(0);
  });
});
