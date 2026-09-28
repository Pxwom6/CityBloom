import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { GRADE_SEP, ROAD_TYPES } from '../src/data/roads';
import { Curve, v2 } from '../src/sim/geom';
import { Sim } from '../src/sim/sim';
import { junctionKind } from '../src/sim/systems/traffic';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { gradeProfile, profileAt } from '../src/sim/world/grading';
import { connectPoint, newSim, road } from './helpers';
import { mainStreetTown } from './bypassTown';

const line = (L: number) => new Curve(v2(0, 0), v2(L / 2, 0), v2(L, 0));

function town(seed = 'hwy') {
  const sim = newSim({ seed });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
  const c = connectPoint(sim);
  const at = (dx: number, dz: number) => ({ x: c.x + dx, z: c.z + dz });
  return { sim, c, at };
}

/** Height of a segment's surface at arc length s (its deck where it has one). */
function surface(sim: Sim, seg: number, s: number): number {
  const sg = sim.state.net.segments.get(seg)!;
  if (sg.deck) return profileAt({ step: 4, h: sg.deck }, s);
  const p = sim.net.curve(seg).pointAt(s);
  return sim.terrain.heightAt(p.x, p.z);
}

describe('grading over and under other roads (M19)', () => {
  it('climbs over a road on a deck within its grade limit, and dips under a viaduct', () => {
    const over = gradeProfile(line(400), () => 10, 'motorway', 10, 10, [{ s: 200, half: 10, min: 17.5 }]);
    expect(over.fail).toBeUndefined();
    expect(profileAt(over, 200)).toBeGreaterThanOrEqual(17.5 - 1e-3);
    expect(over.grade).toBeLessThanOrEqual(ROAD_TYPES.motorway.maxGrade + 1e-3);
    // On a deck over the road below, on an embankment either side, and at grade further out.
    expect(over.raised[50]).toBe(1);
    expect(over.raised[40]).toBe(0);
    expect(profileAt(over, 20)).toBeCloseTo(10, 1);
    const under = gradeProfile(line(300), () => 10, 'street', 10, 10, [{ s: 150, half: 12, max: 8 }]);
    expect(under.fail).toBeUndefined();
    expect(profileAt(under, 150)).toBeLessThanOrEqual(8 + 1e-3);
    expect(under.raisedLength).toBe(0);
    // Too short to climb over it between two joined ends.
    const short = gradeProfile(line(120), () => 10, 'motorway', 10, 10, [{ s: 60, half: 10, min: 17.5 }]);
    expect(short.fail?.reason).toMatch(/Too steep to pass over/);
  });
});

describe('the city highway (M19)', () => {
  it('passes over the roads it crosses and meets them only by ramps', () => {
    const { sim, at } = town();
    const street = road(sim, [at(400, -200), at(400, 200)]).created!;
    const segs = sim.state.net.segments.size;
    const hw = road(sim, [at(250, 60), at(700, 60)], 'motorway').created!;
    // The street isn't split: no junction where they cross.
    expect(sim.state.net.segments.size).toBe(segs + hw.length);
    expect(sim.state.net.segments.has(street[0]!)).toBe(true);
    const streetNodes = new Set([sim.net.segment(street[0]!).a, sim.net.segment(street[0]!).b]);
    for (const id of hw) {
      const s = sim.net.segment(id);
      expect(streetNodes.has(s.a) || streetNodes.has(s.b)).toBe(false);
      expect(s.left).toBe(0);
      expect(s.right).toBe(0);
    }
    // Over the street with room beneath.
    const over = sim.net.nearestSegment(at(400, 60), 2, (id) => hw.includes(id))!;
    expect(hw).toContain(over.seg);
    const under = sim.net.nearestSegment(at(400, 60), 2, (id) => id === street[0])!;
    expect(surface(sim, over.seg, over.s)).toBeGreaterThanOrEqual(
      surface(sim, street[0]!, under.s) + GRADE_SEP.clearance - 0.05,
    );
    // Local roads can't end on it, and it can't end on them.
    expect(
      sim.preview({ type: 'buildRoad', road: 'street', points: [at(560, 60), at(560, 200)] }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/ramp/) });
    expect(
      sim.preview({ type: 'buildRoad', road: 'motorway', points: [at(200, -120), at(400, -120)] }),
    ).toMatchObject({ ok: false });
    // A ramp off it onto a street, one-way the way it was drawn.
    road(sim, [at(820, -150), at(820, 150)]);
    const ramp = road(sim, [at(700, 60), at(780, 60), at(820, 0)], 'ramp').created!;
    const rs = sim.net.segment(ramp[0]!);
    expect(rs.oneway).toBe(1);
    expect(sim.net.node(rs.a).x).toBeLessThan(sim.net.node(rs.b).x);
    expect(sim.dispatch({ type: 'setOneWay', seg: ramp[0]!, dir: 0 })).toMatchObject({ ok: false });
    expect(junctionKind(sim, rs.a)).toBe('none');
    // A street built across it later goes over it.
    const cross = road(sim, [at(560, -150), at(560, 200)]).created!;
    expect(cross).toHaveLength(1);
    const deck = sim.net.segment(cross[0]!).deck;
    const below = sim.net.nearestSegment(at(560, 60), 2, (id) => hw.includes(id))!;
    expect(deck && Math.max(...deck)).toBeGreaterThanOrEqual(
      surface(sim, below.seg, below.s) + GRADE_SEP.clearance - 0.05,
    );
    // Local roads and highways don't turn into each other.
    expect(sim.dispatch({ type: 'upgradeRoad', seg: street[0]!, road: 'motorway' })).toMatchObject({
      ok: false,
    });
    expect(sim.dispatch({ type: 'upgradeRoad', seg: hw[0]!, road: 'avenue' })).toMatchObject({ ok: false });
    // No zoning along it.
    const z = sim.dispatch({
      type: 'zone',
      zone: 'R',
      area: { kind: 'brush', points: [at(260, 60), at(340, 60)], radius: 30 },
    });
    expect(z.ok ? (z.info as { cells: number }).cells : 0).toBe(0);
    // All of it survives a save.
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    expect(loaded.net.segment(cross[0]!).deck).toEqual(deck);
  });

  it('joins the regional highway where it ends (the interchange); older saves have none', () => {
    const { sim, at } = town('hwy2');
    road(sim, [at(0, 0), at(200, 0)], 'avenue');
    const hw = road(sim, [at(0, 0), at(80, 160), at(200, 220)], 'motorway').created!;
    const n = sim.state.highway.connect;
    expect(sim.net.segmentsAt(n).some((id) => hw.includes(id))).toBe(true);
    expect(junctionKind(sim, n)).toBe('none');
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    expect(
      [...old.state.net.segments.values()].some(
        (s) => !ROAD_TYPES[s.type].access && s.type !== 'highway' && s.type !== 'mainline',
      ),
    ).toBe(false);
  });

  it('as a bypass, takes through traffic off the main street', () => {
    // A suburb, a centre and an industrial estate on one main street: commuters from the suburb
    // and trucks from the estate all drive through the centre.
    // Without neighbours (M23): out-of-town jobs slow the suburb's growth past the 5,000 this needs.
    const sim = newSim({ seed: 'bypass', region: false });
    const t = mainStreetTown(sim);
    sim.advance(6 * TICKS_PER_MONTH);
    expect(sim.state.totals.population).toBeGreaterThan(5_000);
    sim.finishMatching();
    const control = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    const ids = t.bypass();
    sim.advance(3 * TICKS_PER_MONTH);
    control.advance(3 * TICKS_PER_MONTH);
    const centre = (s: Sim) => s.state.traffic.get(t.centre) ?? 0;
    const onBypass = Math.max(
      ...ids
        .filter((id) => sim.state.net.segments.get(id)?.type === 'motorway')
        .map((id) => sim.state.traffic.get(id) ?? 0),
    );
    // A fifth or more of the centre's traffic moves onto the bypass, and commutes get shorter.
    expect(centre(sim)).toBeLessThan(centre(control) * 0.8);
    expect(onBypass).toBeGreaterThan(1_000);
    const commute = (s: Sim) =>
      [...s.state.buildings.values()].reduce((a, b) => a + b.commute * b.employed, 0) /
      Math.max(
        1,
        [...s.state.buildings.values()].reduce((a, b) => a + b.employed, 0),
      );
    expect(commute(sim)).toBeLessThan(commute(control));
  });
});
