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
    expect(ring.vc).toBeLessThan(1);
    expect(ring.delay).toBeLessThan(ctl.delay / 3);
    expect(ring.commute).toBeLessThan(ctl.commute * 0.92);
    // As many people cross it as before.
    const through = (s: Sim) =>
      s.net.segmentsAt(node).reduce((a, id) => a + (s.state.traffic.get(id) ?? 0), 0);
    expect(through(sim)).toBeGreaterThan(through(control) * 0.9);
  });
});

/**
 * P5: a crossroads east of the highway, its west and north–south roads long and plain; its east
 * arm built by `east` from the junction `j`.
 */
function cross(type: 'street' | 'avenue', east: (sim: Sim, j: { x: number; z: number }) => void) {
  const sim = newSim({ seed: 'p5' });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
  const c = connectPoint(sim);
  const j = { x: c.x + 300, z: c.z };
  road(sim, [c, j], type);
  road(
    sim,
    [
      { x: j.x, z: j.z - 200 },
      { x: j.x, z: j.z + 200 },
    ],
    type,
  );
  east(sim, j);
  const node = sim.net.nearestNode(j, 2)!.id;
  expect(sim.net.segmentsAt(node)).toHaveLength(4);
  return { sim, j, node };
}

const at = (j: { x: number; z: number }, dx: number, dz = 0) => ({ x: j.x + dx, z: j.z + dz });
const info = (r: { ok: boolean; info?: unknown }) => (r.info ?? {}) as Record<string, unknown>;

describe('roundabouts near bends and tight junctions (P5)', () => {
  it('take a bend inside the old margin as a bend, not the next junction', () => {
    // The east road bends 30 m out: the old rule wanted 34 m to "the next junction".
    const { sim, node } = cross('street', (sim, j) => {
      road(sim, [j, at(j, 30)]);
      road(sim, [at(j, 30), at(j, 150, 120)]);
    });
    const pre = sim.preview({ type: 'roundabout', node });
    expect(pre.ok, pre.ok ? '' : pre.reason).toBe(true);
    expect(info(pre).radius).toBe(14);
    expect(sim.dispatch({ type: 'roundabout', node }).ok).toBe(true);
    expect(sim.state.net.nodes.get(node)!.roundabout).toBe(14);
  });

  it('fit a bigger ring past a bend than past a junction as far', () => {
    const bend = cross('street', (sim, j) => {
      road(sim, [j, at(j, 46)]);
      road(sim, [at(j, 46), at(j, 180, 120)]);
    });
    expect(bend.sim.dispatch({ type: 'roundabout', node: bend.node, radius: 30 }).ok).toBe(true);
    expect(bend.sim.state.net.nodes.get(bend.node)!.roundabout).toBe(30);
    const junction = cross('street', (sim, j) => {
      road(sim, [j, at(j, 200)]);
      road(sim, [at(j, 46, -100), at(j, 46, 100)]);
    });
    expect(junction.sim.dispatch({ type: 'roundabout', node: junction.node, radius: 30 }).ok).toBe(false);
  });

  it('give a cramped crossroads a smaller ring, and never shrink a size the player asked for', () => {
    // A cross street 30 m east: the usual 14 m ring needs 34 m.
    const { sim, node } = cross('street', (sim, j) => {
      road(sim, [j, at(j, 200)]);
      road(sim, [at(j, 30, -100), at(j, 30, 100)]);
    });
    const auto = sim.preview({ type: 'roundabout', node });
    expect(auto.ok, auto.ok ? '' : auto.reason).toBe(true);
    expect(info(auto).radius).toBe(10);
    const asked = sim.preview({ type: 'roundabout', node, radius: 14 });
    expect(asked.ok).toBe(false);
    expect(info(asked).fits).toBe(10);
    expect(sim.preview({ type: 'roundabout', node, radius: 10 }).ok).toBe(true);
    // An avenue crossroads with a dead-end stub 30 m long on its east side.
    const av = cross('avenue', (sim, j) => road(sim, [j, at(j, 30)], 'avenue'));
    const r = av.sim.preview({ type: 'roundabout', node: av.node });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    expect(info(r).radius as number).toBeLessThan(18);
  });

  it('refuse with the road that is too short, what is in the way and how much room is missing', () => {
    const { sim, node, j } = cross('street', (sim, j) => {
      road(sim, [j, at(j, 200)]);
      road(sim, [at(j, 20, -100), at(j, 20, 100)]);
    });
    const r = sim.preview({ type: 'roundabout', node });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/east/);
    expect(r.reason).toMatch(/junction/);
    expect(r.reason).toMatch(/20 m/);
    expect(r.reason).toMatch(/26 m/);
    const short = info(r).short as {
      seg: number;
      have: number;
      need: number;
      missing: number;
      at: { x: number };
    };
    expect(short.have).toBeCloseTo(20, 0);
    expect(short.need).toBe(26);
    expect(short.missing).toBe(6);
    expect(sim.net.segmentsAt(node)).toContain(short.seg);
    expect(r.at!.x).toBeCloseTo(j.x + 20, 0);
  });

  it('build mini roundabouts, and keep them through save and load', () => {
    const { sim, node } = cross('street', (sim, j) => road(sim, [j, at(j, 200)]));
    expect(sim.preview({ type: 'roundabout', node, radius: 3 }).info).toMatchObject({ radius: 6 });
    const before = sim.state.treasury;
    expect(sim.dispatch({ type: 'roundabout', node, radius: 6 }).ok).toBe(true);
    expect(sim.state.net.nodes.get(node)!.roundabout).toBe(6);
    expect(before - sim.state.treasury).toBe(Math.round(2 * Math.PI * 6 * JUNCTION.costPerMetre));
    const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(back.hash()).toBe(sim.hash());
    expect(back.state.net.nodes.get(node)!.roundabout).toBe(6);
    const av = cross('avenue', (sim, j) => road(sim, [j, at(j, 200)], 'avenue'));
    expect(av.sim.preview({ type: 'roundabout', node: av.node, radius: 6 }).info).toMatchObject({
      radius: 10,
    });
    expect(sim.preview({ type: 'roundabout', node: sim.state.highway.connect, radius: Number.NaN }).ok).toBe(
      false,
    );
  });

  it('take in a bend inside the ring, rebuilding the road into it straight', () => {
    // The east road bends 12 m out: no ring fits without taking the bend in.
    const { sim, node, j } = cross('street', (sim, j) => {
      road(sim, [j, at(j, 12)]);
      road(sim, [at(j, 12), at(j, 130, 90)]);
    });
    const hash = sim.hash();
    const twin = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    twin.testMode = true;
    const pre = sim.preview({ type: 'roundabout', node });
    expect(pre.ok, pre.ok ? '' : pre.reason).toBe(true);
    expect(info(pre).straightened).toBe(1);
    const before = sim.state.treasury;
    const res = sim.dispatch({ type: 'roundabout', node });
    expect(res.ok).toBe(true);
    const r = sim.state.net.nodes.get(node)!.roundabout!;
    expect(before - sim.state.treasury).toBe(Math.round(2 * Math.PI * r * JUNCTION.costPerMetre));
    // Every road into the ring now runs at least its outer edge plus 6 m before anything else.
    for (const id of sim.net.segmentsAt(node))
      expect(sim.net.curve(id).length).toBeGreaterThanOrEqual(r + 12 - 0.01);
    const near = sim.net
      .nodesIn({ minX: j.x - r - 11, minZ: j.z - r - 11, maxX: j.x + r + 11, maxZ: j.z + r + 11 })
      .filter((n) => Math.hypot(n.x - j.x, n.z - j.z) < r + 11);
    expect(near.map((n) => n.id)).toEqual([node]);
    // The far end of the old road is still reached from the ring.
    const far = sim.net.nearestNode(at(j, 130, 90), 1)!.id;
    expect(sim.roadIslands()).toEqual([]);
    expect(sim.net.segmentsAt(far).length).toBe(1);
    // Undone and redone exactly; the same command does the same on a copy.
    const after = sim.hash();
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.hash()).toBe(hash);
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    expect(sim.hash()).toBe(after);
    expect(twin.dispatch({ type: 'roundabout', node }).ok).toBe(true);
    expect(twin.hash()).toBe(after);
  });

  it('prefer a smaller ring that leaves the road alone to taking a bend in', () => {
    const { sim, node } = cross('street', (sim, j) => {
      road(sim, [j, at(j, 20)]);
      road(sim, [at(j, 20), at(j, 140, 90)]);
    });
    const pre = sim.preview({ type: 'roundabout', node });
    expect(pre.ok, pre.ok ? '' : pre.reason).toBe(true);
    expect(info(pre)).toMatchObject({ radius: 8, straightened: 0 });
  });
});

describe('roundabouts whose bends loop round to each other (PR #14 review)', () => {
  it('refuse rather than take in two bends on the same road', () => {
    // A road leaves the junction north-east and comes back into it from the south-east: 50 m out
    // to a bend, round a curve that bulges out to 56 m, and 50 m in from another bend. A ring 80 m
    // across needs 52 m of clear road, so both bends are inside it, and both would be cut on the
    // one curve (the first cut takes the curve away from under the second).
    const sim = newSim({ seed: 'p5' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
    const c = connectPoint(sim);
    const j = { x: c.x + 300, z: c.z };
    road(sim, [c, j]);
    road(sim, [j, at(j, 38, -32)]);
    road(sim, [at(j, 38, -32), at(j, 74), at(j, 38, 32)]);
    road(sim, [at(j, 38, 32), j]);
    const node = sim.net.nearestNode(j, 2)!.id;
    expect(sim.net.segmentsAt(node).length).toBe(3);
    const hash = sim.hash();
    const treasury = sim.state.treasury;
    const cmd = { type: 'roundabout', node, radius: 40 } as const;
    let res: ReturnType<Sim['dispatch']> | undefined;
    expect(() => (res = sim.dispatch(cmd))).not.toThrow();
    expect(res!.ok).toBe(false);
    // Nothing changed: no road cut, no money spent.
    expect(sim.hash()).toBe(hash);
    expect(sim.state.treasury).toBe(treasury);
    // The preview says the same as the command.
    expect(sim.preview(cmd).ok).toBe(false);
  });

  it('still take in two bends on different roads', () => {
    // East and north each bend 13 m out, onto roads of their own.
    const sim = newSim({ seed: 'p5' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
    const c = connectPoint(sim);
    const j = { x: c.x + 300, z: c.z };
    road(sim, [c, j]);
    road(sim, [j, at(j, 13)]);
    road(sim, [at(j, 13), at(j, 130, 90)]);
    road(sim, [j, at(j, 0, -13)]);
    road(sim, [at(j, 0, -13), at(j, 90, -130)]);
    const node = sim.net.nearestNode(j, 2)!.id;
    const res = sim.dispatch({ type: 'roundabout', node });
    expect(res.ok, res.ok ? '' : res.reason).toBe(true);
    expect(info(res).straightened).toBe(2);
    expect(sim.roadIslands()).toEqual([]);
  });
});
