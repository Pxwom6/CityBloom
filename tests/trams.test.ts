import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TRAM } from '../src/data/balance';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { connectPoint, newSim, placeAlong, road } from './helpers';
import { tramCorridor } from './railTown';
import { twoDistricts } from './trafficTown';

describe('trams (M20)', () => {
  it('track goes on streets, avenues and boulevards, and stays through splits, upgrades and undo', () => {
    const sim = newSim({ seed: 'tram' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
    const c = connectPoint(sim);
    const street = road(sim, [c, { x: c.x + 300, z: c.z }]).created![0]!;
    const dirt = road(
      sim,
      [
        { x: c.x + 100, z: c.z + 100 },
        { x: c.x + 300, z: c.z + 100 },
      ],
      'dirt',
    ).created![0]!;
    expect(sim.dispatch({ type: 'setTram', seg: dirt, on: true })).toMatchObject({ ok: false });
    const before = sim.state.treasury;
    const r = sim.dispatch({ type: 'setTram', seg: street, on: true });
    expect(r.ok).toBe(true);
    expect(before - sim.state.treasury).toBe(Math.round(sim.net.curve(street).length * TRAM.trackCost));
    expect(sim.dispatch({ type: 'setTram', seg: street, on: true })).toMatchObject({ ok: false });
    expect(sim.tramGraph().segSeconds.has(street)).toBe(true);
    expect(sim.graph().segSeconds.has(street)).toBe(true);
    // A side street splits it: both halves keep their track.
    road(sim, [
      { x: c.x + 150, z: c.z },
      { x: c.x + 150, z: c.z - 120 },
    ]);
    const halves = [...sim.state.net.segments.values()].filter(
      (s) => s.type === 'street' && Math.abs(sim.net.curve(s.id).pointAt(1).z - c.z) < 0.5,
    );
    expect(halves).toHaveLength(2);
    expect(halves.every((s) => s.tram)).toBe(true);
    // An avenue keeps it; a dirt road can't have it.
    const h = halves[0]!.id;
    expect(sim.dispatch({ type: 'upgradeRoad', seg: h, road: 'avenue' }).ok).toBe(true);
    expect(sim.state.net.segments.get(h)!.tram).toBe(true);
    expect(sim.dispatch({ type: 'upgradeRoad', seg: h, road: 'dirt' })).toMatchObject({ ok: false });
    // Taking it up is free, and undo lays it again.
    const t0 = sim.state.treasury;
    expect(sim.dispatch({ type: 'setTram', seg: h, on: false }).ok).toBe(true);
    expect(sim.state.treasury).toBe(t0);
    expect(sim.state.net.segments.get(h)!.tram).toBeUndefined();
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.net.segments.get(h)!.tram).toBe(true);
    // A drag is one undo step.
    const other = halves[1]!.id;
    sim.dispatch({ type: 'setTram', seg: h, on: false, stroke: 7 });
    sim.dispatch({ type: 'setTram', seg: other, on: false, stroke: 7 });
    expect(sim.history.undo[sim.history.undo.length - 1]!.label).toBe('tram track');
    sim.dispatch({ type: 'undo' });
    expect(sim.state.net.segments.get(h)!.tram && sim.state.net.segments.get(other)!.tram).toBe(true);
    // Saved and loaded, exactly.
    const again = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(again.hash()).toBe(sim.hash());
    expect(again.state.net.segments.get(h)!.tram).toBe(true);
  });

  it('tram stops go on tracked roads, depots face one, and a depot runs its stops as one loop', () => {
    const sim = newSim({ seed: 'tram2' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
    const c = connectPoint(sim);
    const main = road(sim, [c, { x: c.x + 600, z: c.z }]).created!;
    const stop = (x: number) => sim.dispatch({ type: 'placeStop', x: c.x + x, z: c.z + 6, tram: true });
    expect(stop(100)).toMatchObject({ ok: false });
    expect(() => placeAlong(sim, 'tramdepot', main[0]!)).toThrow();
    for (const id of main) sim.dispatch({ type: 'setTram', seg: id, on: true });
    const depot = placeAlong(sim, 'tramdepot', main[0]!);
    const stops = [100, 300, 500].map((x) => stop(x));
    expect(stops.every((r) => r.ok)).toBe(true);
    // A bus stop can stand beside a tram stop; buses and trams don't share stops.
    expect(sim.dispatch({ type: 'placeStop', x: c.x + 300, z: c.z - 6 }).ok).toBe(true);
    const trams = sim.lines().filter((l) => l.mode === 'tram');
    expect(trams).toHaveLength(1);
    expect(trams[0]!.depot).toBe(depot);
    expect(trams[0]!.stops).toHaveLength(3);
    expect(sim.lines().filter((l) => l.mode === 'bus')).toHaveLength(0);
    // Take up the track under a stop: that stop goes (no track to move to nearby).
    const under = sim.state.transit.stops.get((stops[2] as { created: number[] }).created[0]!)!;
    sim.dispatch({ type: 'setTram', seg: under.seg, on: false });
    const left = [...sim.state.transit.stops.values()].filter((s) => s.tram);
    expect(left.every((s) => sim.state.net.segments.get(s.seg)!.tram)).toBe(true);
    expect(left.length).toBeLessThan(3);
  });

  it('a tram line through the jammed link takes commuters out of their cars', () => {
    const sim = newSim({ seed: 'tram3' });
    const t = twoDistricts(sim, 'street');
    sim.advance(5 * TICKS_PER_MONTH);
    sim.finishMatching();
    const control = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    tramCorridor(sim, t.c);
    sim.advance(3 * TICKS_PER_MONTH);
    control.advance(3 * TICKS_PER_MONTH);
    const link = (s: Sim) => s.state.traffic.get(t.link) ?? 0;
    const line = sim.lines().find((l) => l.mode === 'tram')!;
    expect(line).toBeDefined();
    const riders = sim.state.transit.riders.get(line.depot) ?? 0;
    expect(riders).toBeGreaterThan(300);
    expect(link(sim)).toBeLessThan(link(control) * 0.9);
  });
});
