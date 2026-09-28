import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { CHRONICLE_SERIES, monthFigures } from '../src/sim/systems/chronicle';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { connectPoint, newSim, placeAlong, road } from './helpers';
import { trainCorridor } from './railTown';
import { twoDistricts } from './trafficTown';

describe('trains (M20)', () => {
  it('the regional railway comes in on the west edge, in new cities and in older saves', () => {
    const sim = newSim({ seed: 'tr' });
    const r = sim.state.railway!;
    expect(r).not.toBeNull();
    expect(sim.net.segment(r.segment).type).toBe('mainline');
    const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const at = sim.state.net.nodes.get(r.connect)!;
    expect(at.x).toBe(hw.x);
    expect(Math.abs(at.z - hw.z)).toBeGreaterThanOrEqual(260);
    // The playtest city (save version 10) gets one where it fits, and plays on.
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    expect(old.state.railway).not.toBeNull();
    const link = old.state.net.nodes.get(old.state.railway!.connect)!;
    for (const seg of old.state.net.segments.values()) {
      if (seg.id === old.state.railway!.segment) continue;
      expect(old.net.curve(seg.id).project(link).d).toBeGreaterThan(20);
    }
    old.testMode = true;
    old.advance(TICKS_PER_MONTH / 4);
    // Saved again and loaded, exactly.
    const again = Sim.fromSave(JSON.parse(JSON.stringify(old.save())));
    expect(again.hash()).toBe(old.hash());
  });

  it('stations face a railway, and those on connected track run one line calling at each in turn', () => {
    const sim = newSim({ seed: 'tr2' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
    const c = connectPoint(sim);
    const street = road(sim, [c, { x: c.x + 300, z: c.z }]).created!;
    // A station beside a road isn't a station.
    expect(() => placeAlong(sim, 'station', street[0]!)).toThrow();
    const track = road(
      sim,
      [
        { x: c.x + 60, z: c.z + 160 },
        { x: c.x + 900, z: c.z + 160 },
      ],
      'rail',
    ).created!;
    const segAt = (x: number) => sim.net.nearestSegment({ x: c.x + x, z: c.z + 160 }, 4)!.seg;
    const a = placeAlong(sim, 'station', segAt(120));
    expect(sim.lines().filter((l) => l.mode === 'train')).toHaveLength(0);
    const b = placeAlong(sim, 'station', segAt(800));
    const mid = placeAlong(sim, 'station', segAt(480));
    const lines = sim.lines().filter((l) => l.mode === 'train');
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.shuttle).toBe(true);
    expect(line.buses).toBeGreaterThanOrEqual(3);
    // In order along the track, whichever end it starts from.
    const order = line.stops.join(',');
    expect([`${a},${mid},${b}`, `${b},${mid},${a}`]).toContain(order);
    expect(line.stopTime[1]!).toBeLessThan(line.stopTime[2]!);
    // A station on track of its own joins no line.
    const lone = road(
      sim,
      [
        { x: c.x + 60, z: c.z + 400 },
        { x: c.x + 400, z: c.z + 400 },
      ],
      'rail',
    ).created!;
    placeAlong(sim, 'station', lone[0]!);
    expect(sim.lines().filter((l) => l.mode === 'train')).toHaveLength(1);
    void track;
  });

  it('a train line beside a jammed link takes commuters out of their cars', () => {
    // Homes west, jobs east, and one dirt road between them (the M6 jam town).
    const sim = newSim({ seed: 'rail' });
    const t = twoDistricts(sim, 'dirt');
    sim.advance(5 * TICKS_PER_MONTH);
    sim.finishMatching();
    const control = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    trainCorridor(sim, t.c);
    sim.advance(3 * TICKS_PER_MONTH);
    control.advance(3 * TICKS_PER_MONTH);
    const link = (s: Sim) => s.state.traffic.get(t.link) ?? 0;
    const riders = [...sim.state.transit.riders.values()].reduce((a, b) => a + b, 0);
    const commute = (s: Sim) => monthFigures(s)[CHRONICLE_SERIES.indexOf('traffic')]!;
    // The link carries a sixth or more fewer cars, hundreds ride the train, and commutes shorten.
    expect(link(control)).toBeGreaterThan(1_500);
    expect(link(sim)).toBeLessThan(link(control) * 0.85);
    expect(riders).toBeGreaterThan(400);
    expect(commute(sim)).toBeLessThan(commute(control));
  });
});
