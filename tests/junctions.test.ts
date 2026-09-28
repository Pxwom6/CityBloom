import { describe, expect, it } from 'vitest';
import { JUNCTION } from '../src/data/balance';
import { Sim } from '../src/sim/sim';
import { CHRONICLE_SERIES, monthFigures } from '../src/sim/systems/chronicle';
import { junctionDelay, junctionKind, junctionVC, segVC } from '../src/sim/systems/traffic';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { connectPoint, newSim, road } from './helpers';
import { crossroadsTown } from './junctionTown';

/** Two avenues crossing east of the highway, with nothing else near. */
function crossing(seed = 'jx') {
  const sim = newSim({ seed });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
  const c = connectPoint(sim);
  const j = { x: c.x + 300, z: c.z };
  road(sim, [c, { x: j.x + 200, z: j.z }], 'avenue');
  road(
    sim,
    [
      { x: j.x, z: j.z - 200 },
      { x: j.x, z: j.z + 200 },
    ],
    'avenue',
  );
  const node = sim.net.nearestNode(j, 2)!.id;
  return { sim, c, j, node };
}

const commute = (sim: Sim) => monthFigures(sim)[CHRONICLE_SERIES.indexOf('traffic')]!;

describe('junctions and roundabouts (M19)', () => {
  it('a busy crossroads jams before its roads do, and a roundabout passes more', () => {
    const { sim, node } = crossing();
    const arms = sim.net.segmentsAt(node);
    expect(arms).toHaveLength(4);
    for (const id of arms) sim.state.traffic.set(id, 7000);
    expect(junctionKind(sim, node)).toBe('plain');
    const plain = junctionVC(sim, node, 1);
    expect(plain).toBeGreaterThan(1);
    // Each avenue on its own still has room.
    for (const id of arms) expect(segVC(sim, id, 1)).toBeLessThan(1);
    const jammed = junctionDelay(sim, node, 1);
    expect(jammed).toBeGreaterThan(60);
    // A bend where two roads meet costs nothing.
    const bend = [...sim.state.net.nodes.values()].find((n) => sim.net.segmentsAt(n.id).length === 2);
    if (bend) expect(junctionDelay(sim, bend.id, 1)).toBe(0);

    const r = sim.dispatch({ type: 'roundabout', node });
    if (!r.ok) throw new Error(r.reason);
    expect(junctionKind(sim, node)).toBe('roundabout');
    const ring = junctionVC(sim, node, 1);
    expect(ring).toBeCloseTo((plain * JUNCTION.plainShare) / JUNCTION.roundaboutShare, 5);
    expect(ring).toBeLessThan(1);
    expect(junctionDelay(sim, node, 1)).toBeLessThan(10);
    // Quiet, a roundabout costs a second more than a plain junction: everyone slows for it.
    for (const id of arms) sim.state.traffic.set(id, 100);
    expect(junctionDelay(sim, node, 1)).toBeCloseTo(JUNCTION.roundaboutDelay, 0);
  });

  it('goes on a junction or a road, keeps roads out of its ring, and can be taken out or undone', () => {
    const { sim, c, j, node } = crossing('jx2');
    const t0 = sim.state.treasury;
    const r = sim.dispatch({ type: 'roundabout', node, radius: 18 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.created).toEqual([node]);
    expect(sim.state.net.nodes.get(node)!.roundabout).toBe(18);
    expect(sim.state.treasury).toBe(t0 - r.cost);
    expect(sim.dispatch({ type: 'roundabout', node })).toMatchObject({ ok: false });
    // A road straight through the ring is refused; one ending at the roundabout is not.
    const through = sim.preview({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: j.x - 60, z: j.z - 12 },
        { x: j.x + 60, z: j.z - 12 },
      ],
    });
    expect(through).toMatchObject({ ok: false });
    // On a road: the road is split and the ring sits on the new node.
    const segs = sim.state.net.segments.size;
    const mid = sim.dispatch({ type: 'roundabout', at: { x: c.x + 120, z: c.z } });
    if (!mid.ok) throw new Error(mid.reason);
    expect(sim.state.net.segments.size).toBe(segs + 1);
    expect(sim.net.segmentsAt(mid.created![0]!)).toHaveLength(2);
    // Too near another roundabout, on the regional highway, or too close to the next junction.
    expect(sim.dispatch({ type: 'roundabout', at: { x: j.x, z: j.z + 40 } })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: 'roundabout', node: sim.state.highway.connect })).toMatchObject({
      ok: false,
    });
    road(
      sim,
      [
        { x: j.x + 150, z: j.z },
        { x: j.x + 150, z: j.z + 80 },
      ],
      'street',
    );
    expect(sim.dispatch({ type: 'roundabout', at: { x: j.x + 150, z: j.z + 70 } })).toMatchObject({
      ok: false,
    });
    // Out again, with some money back; undo puts it back.
    const before = sim.state.treasury;
    expect(sim.dispatch({ type: 'removeRoundabout', node }).ok).toBe(true);
    expect(sim.state.net.nodes.get(node)!.roundabout).toBeUndefined();
    expect(sim.state.treasury).toBeGreaterThan(before);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.net.nodes.get(node)!.roundabout).toBe(18);
    // Kept through save and load.
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    expect(loaded.state.net.nodes.get(node)!.roundabout).toBe(18);
  });

  it('relieves a jammed crossroads: the queue clears and commutes get shorter', () => {
    // Homes west and north of one crossroads, jobs east and south: every commute crosses it.
    const sim = newSim({ seed: 'cross' });
    const { node } = crossroadsTown(sim);
    sim.advance(5 * TICKS_PER_MONTH);
    const jammed = junctionVC(sim, node, 1);
    expect(sim.state.totals.population).toBeGreaterThan(7_000);
    expect(jammed).toBeGreaterThan(1);
    // The same city twice from here: one gets a roundabout, the other is left alone.
    sim.finishMatching();
    const control = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    const r = sim.dispatch({ type: 'roundabout', node });
    if (!r.ok) throw new Error(r.reason);
    sim.advance(2 * TICKS_PER_MONTH);
    control.advance(2 * TICKS_PER_MONTH);
    const ring = { vc: junctionVC(sim, node, 1), delay: junctionDelay(sim, node, 1), commute: commute(sim) };
    const ctl = {
      vc: junctionVC(control, node, 1),
      delay: junctionDelay(control, node, 1),
      commute: commute(control),
    };
    // The junction goes from over capacity to under it, the wait through it from tens of seconds
    // to a few, and the town's average commute drops.
    expect(ctl.vc).toBeGreaterThan(1);
    expect(ring.vc).toBeLessThan(0.8);
    expect(ring.delay).toBeLessThan(ctl.delay / 3);
    expect(ring.commute).toBeLessThan(ctl.commute * 0.92);
    // As many people cross it as before.
    const through = (s: Sim) =>
      s.net.segmentsAt(node).reduce((a, id) => a + (s.state.traffic.get(id) ?? 0), 0);
    expect(through(sim)).toBeGreaterThan(through(control) * 0.9);
  });
});
