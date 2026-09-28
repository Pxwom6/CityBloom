import { describe, expect, it } from 'vitest';
import { GRADE_SEP, ROAD_TYPES, isRail } from '../src/data/roads';
import { Sim } from '../src/sim/sim';
import { junctionKind } from '../src/sim/systems/traffic';
import { profileAt } from '../src/sim/world/grading';
import { connectPoint, newSim, road } from './helpers';

function town(seed = 'rail') {
  const sim = newSim({ seed });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
  const c = connectPoint(sim);
  const at = (dx: number, dz: number) => ({ x: c.x + dx, z: c.z + dz });
  return { sim, c, at };
}

const nodesOf = (sim: Sim, ids: number[]) =>
  new Set(ids.flatMap((id) => [sim.net.segment(id).a, sim.net.segment(id).b]));

describe('railways in the network (M20)', () => {
  it('cross streets on the level, pass over bigger roads, and stay out of the road graph', () => {
    const { sim, at } = town();
    road(sim, [at(0, 0), at(700, 0)], 'boulevard');
    const street = road(sim, [at(60, -400), at(60, 0)]).created!;
    const big = [...sim.state.net.segments.values()].filter((s) => s.type === 'boulevard').map((s) => s.id);
    // A railway across the street, then on over the boulevard.
    const segs0 = sim.state.net.segments.size;
    const rail = road(sim, [at(0, -300), at(700, 400)], 'rail').created!;
    expect(rail.length).toBeGreaterThanOrEqual(2);
    // The street is split where the railway crosses it: a level crossing.
    const crossing = [...sim.state.net.nodes.values()].find(
      (n) => Math.abs(n.x - at(60, 0).x) < 2 && Math.abs(n.z - at(0, -240).z) < 2,
    );
    expect(crossing).toBeDefined();
    expect(junctionKind(sim, crossing!.id)).toBe('crossing');
    expect(sim.state.net.segments.size).toBeGreaterThan(segs0 + rail.length - 1);
    // The boulevard isn't split: the railway passes over it on a deck.
    for (const id of big) expect(sim.state.net.segments.has(id)).toBe(true);
    const bridge = rail.find((id) => sim.net.segment(id).deck);
    expect(bridge).toBeDefined();
    const bc = sim.net.curve(bridge!);
    let top = -Infinity;
    for (let s = 0; s < bc.length; s += 2)
      top = Math.max(top, profileAt({ step: 4, h: sim.net.segment(bridge!).deck! }, s));
    expect(top).toBeGreaterThan(sim.terrain.heightAt(at(300, 0).x, at(300, 0).z) + GRADE_SEP.clearance - 1);
    // Cars can't drive the railway; trains have a graph of their own, with no roads in it.
    const g = sim.graph();
    for (let k = 0; k < g.seg.length; k++) expect(sim.net.segment(g.seg[k]!).type).not.toBe('rail');
    const rg = sim.railGraph();
    expect(rg.seg.length).toBeGreaterThan(0);
    for (let k = 0; k < rg.seg.length; k++) expect(isRail(sim.net.segment(rg.seg[k]!).type)).toBe(true);
    // Street traffic still crosses at the level crossing.
    const north = sim.net.nearestSegment(at(60, -350), 2)!.seg;
    const south = sim.net.nearestSegment(at(60, -100), 2)!.seg;
    expect(g.componentOfNode(sim.net.segment(north).a)).toBe(g.componentOfNode(sim.net.segment(south).b));
    void street;
    // No zoning along a railway.
    expect(rail.every((id) => sim.net.segment(id).left === 0 && sim.net.segment(id).right === 0)).toBe(true);
  });

  it('keep to wide curves and gentle grades, never end on a road, and join other railways', () => {
    const { sim, at } = town('rail2');
    road(sim, [at(0, 0), at(600, 0)], 'avenue');
    road(sim, [at(300, -300), at(300, 0)]);
    // Too tight a bend.
    expect(
      sim.preview({ type: 'buildRoad', road: 'rail', points: [at(100, -200), at(140, -200), at(140, -160)] }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/radius of 100 m/) });
    // Ending on a street, or starting on the avenue.
    expect(
      sim.preview({ type: 'buildRoad', road: 'rail', points: [at(100, -150), at(300, -150)] }),
    ).toMatchObject({ ok: false });
    expect(
      sim.preview({ type: 'buildRoad', road: 'rail', points: [at(450, 0), at(450, -250)] }),
    ).toMatchObject({ ok: false });
    // A street ending on a railway.
    const rail = road(sim, [at(100, -220), at(560, -220)], 'rail').created!;
    expect(
      sim.preview({ type: 'buildRoad', road: 'street', points: [at(450, -100), at(450, -220)] }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/railway/) });
    // A branch off the railway: a junction of track, at a shallow angle.
    const branch = sim.dispatch({ type: 'buildRoad', road: 'rail', points: [at(400, -220), at(560, -250)] });
    if (!branch.ok) throw new Error(branch.reason);
    const railNodes = nodesOf(
      sim,
      [...sim.state.net.segments.values()].filter((s) => s.type === 'rail').map((s) => s.id),
    );
    expect([...railNodes].some((n) => sim.net.segmentsAt(n).length === 3)).toBe(true);
    // No corners where two lengths of track meet.
    expect(
      sim.preview({ type: 'buildRoad', road: 'rail', points: [at(560, -220), at(560, -420)] }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/corner/) });
    // Railways can't be one-way, upgraded to a road, or take a roundabout.
    const any = [...sim.state.net.segments.values()].find((s) => s.type === 'rail')!;
    expect(sim.dispatch({ type: 'upgradeRoad', seg: any.id, road: 'street' })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: 'roundabout', node: any.a })).toMatchObject({ ok: false });
    void rail;
    expect(ROAD_TYPES.rail.maxGrade).toBeLessThan(0.05);
    // Saved and loaded exactly.
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
  });
});
