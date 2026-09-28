import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { routeBetween } from '../src/sim/systems/graph';
import { segSpeed } from '../src/sim/systems/vehicles';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { newSim, road } from './helpers';
import { twoDistricts } from './trafficTown';

/** Homes west, jobs east, joined by one link and (optionally) a bypass to the north. */
function town(seed = 'ow') {
  const sim = newSim({ seed });
  const t = twoDistricts(sim, 'street');
  return { sim, ...t };
}

const legsOn = (legs: { seg: number; s0: number; s1: number }[], seg: number) =>
  legs.filter((l) => l.seg === seg);

describe('one-way roads (M19)', () => {
  it('can be set, reversed and cleared on a road, and undone', () => {
    const { sim, link } = town();
    expect(sim.dispatch({ type: 'setOneWay', seg: link, dir: 1 }).ok).toBe(true);
    expect(sim.state.net.segments.get(link)!.oneway).toBe(1);
    expect(sim.dispatch({ type: 'setOneWay', seg: link, dir: 1 })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: 'setOneWay', seg: link, dir: -1 }).ok).toBe(true);
    expect(sim.state.net.segments.get(link)!.oneway).toBe(-1);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.net.segments.get(link)!.oneway).toBe(1);
    expect(sim.dispatch({ type: 'setOneWay', seg: link, dir: 0 }).ok).toBe(true);
    expect(sim.state.net.segments.get(link)!.oneway).toBeUndefined();
    expect(sim.dispatch({ type: 'setOneWay', seg: sim.state.highway.segment, dir: 1 })).toMatchObject({
      ok: false,
    });
  });

  it('are driven only one way: routes go round, and trips home come back another way', () => {
    const { sim, link, bypass } = town('ow2');
    bypass();
    sim.advance(3 * TICKS_PER_MONTH);
    // East over the link to work; the way back must use the bypass.
    expect(sim.dispatch({ type: 'setOneWay', seg: link, dir: 1 }).ok).toBe(true);
    const g = sim.graph();
    const net = sim.state.net;
    const sg = net.segments.get(link)!;
    const len = sim.net.curve(link).length;
    // From the middle of the link, a car can only carry on east.
    const west = [...net.segments.values()].find((s) => s.b === sg.a && s.type === 'avenue' && s.id !== link);
    expect(west).toBeDefined();
    const r = routeBetween(g, sim.net, { seg: link, s: len / 2 }, { seg: west!.id, s: 5 }, (s) =>
      segSpeed(sim, s),
    );
    expect(r).not.toBeNull();
    expect(legsOn(r!, link)[0]!.s1).toBeGreaterThan(len / 2 - 1);
    // Let the assignment settle, then look at the trips the cars follow.
    sim.advance(2 * TICKS_PER_MONTH);
    sim.finishMatching();
    const trips = sim.trafficData().trips.filter((t) => t.purpose === 'work');
    const over = trips.filter((t) => legsOn(t.legs, link).length);
    expect(over.length).toBeGreaterThan(0);
    for (const t of over) {
      // Every leg along the link runs a → b, and the way home never uses it.
      for (const l of legsOn(t.legs, link)) expect(l.s1).toBeGreaterThan(l.s0);
      expect(t.back).toBeDefined();
      expect(legsOn(t.back!, link)).toEqual([]);
    }
    // Nobody is stranded: commuters still get to work and back.
    expect(sim.state.totals.population).toBeGreaterThan(1_000);
  });

  it('keep their direction when split by a crossing road, and through save and load', () => {
    const { sim, link, c } = town('ow3');
    sim.dispatch({ type: 'setOneWay', seg: link, dir: -1 });
    // A street across the middle of the link splits it.
    road(
      sim,
      [
        { x: c.x + 290, z: c.z - 60 },
        { x: c.x + 290, z: c.z + 60 },
      ],
      'street',
    );
    expect(sim.state.net.segments.has(link)).toBe(false);
    const halves = [...sim.state.net.segments.values()].filter(
      (s) =>
        s.type === 'street' &&
        Math.abs(sim.net.curve(s.id).pointAt(sim.net.curve(s.id).length / 2).z - c.z) < 2,
    );
    expect(halves.length).toBeGreaterThanOrEqual(2);
    for (const h of halves) expect(h.oneway).toBe(-1);
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    for (const h of halves) expect(loaded.state.net.segments.get(h.id)!.oneway).toBe(-1);
  });

  it('are drawn in the direction of the stroke, and older saves load with two-way roads', () => {
    const { sim, c } = town('ow4');
    const r = sim.dispatch({
      type: 'buildRoad',
      road: 'street',
      oneway: true,
      points: [
        { x: c.x + 560, z: c.z - 300 },
        { x: c.x + 700, z: c.z - 300 },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    const seg = sim.state.net.segments.get(r.created![0]!)!;
    expect(seg.oneway).toBe(1);
    expect(sim.state.net.nodes.get(seg.a)!.x).toBeLessThan(sim.state.net.nodes.get(seg.b)!.x);
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    expect([...old.state.net.segments.values()].some((s) => s.oneway)).toBe(false);
    old.testMode = true;
    old.advance(TICKS_PER_MONTH / 2);
  });
});
