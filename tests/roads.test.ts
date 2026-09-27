import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { ROAD_TYPES } from '../src/data/roads';
import { deckAt } from '../src/sim/world/bridge';
import { ROWS } from '../src/data/zones';

/** What a built or previewed road paid for earthworks (M13). */
const earthCost = (r: { info?: unknown }) =>
  (r.info as { grade?: { earth: { cost: number } | null } } | undefined)?.grade?.earth?.cost ?? 0;
import {
  cellsOf,
  connectPoint,
  newSim,
  nodeDegree,
  overlappingValidCells,
  road,
  validCells,
} from './helpers';

describe('highway connection', () => {
  it('exists at the west edge and cannot be bulldozed', () => {
    const sim = newSim();
    const { outside, connect, segment } = sim.state.highway;
    expect(sim.state.net.nodes.get(outside)!.x).toBeLessThan(0);
    expect(sim.state.net.nodes.get(connect)!.x).toBeGreaterThan(0);
    expect(sim.state.net.segments.get(segment)!.type).toBe('highway');
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'segment', id: segment } }).ok).toBe(false);
  });
});

describe('building roads', () => {
  it('builds a straight street off the highway, charges for it and creates zone blocks', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    const before = sim.state.treasury;
    const r = road(sim, [c, { x: c.x + 300, z: c.z }]);
    // The road by the metre, plus the earthworks that lay it into the ground (M13).
    expect(r.cost).toBe(
      Math.round(sim.net.curve(r.created![0]!).length * ROAD_TYPES.street.costPerMetre) + earthCost(r),
    );
    expect(sim.state.treasury).toBe(before - r.cost);
    expect(r.cost).toBeGreaterThan(2900);
    const segs = r.created!;
    expect(segs.length).toBe(1);
    const seg = sim.state.net.segments.get(segs[0]!)!;
    expect(seg.left).toBeGreaterThan(0);
    expect(seg.right).toBeGreaterThan(0);
    const left = sim.state.net.blocks.get(seg.left)!;
    expect(left.cols).toBe(Math.floor(sim.net.curve(seg.id).length / 8));
    const valid = left.valid.reduce((s, v) => s + v, 0);
    expect(valid).toBeGreaterThan(left.cols * ROWS * 0.6);
    expect(nodeDegree(sim, sim.state.highway.connect)).toBe(2);
  });

  it('builds curved roads whose zone cells never overlap', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 200, z: c.z }]);
    road(sim, [
      { x: c.x + 200, z: c.z },
      { x: c.x + 330, z: c.z },
      { x: c.x + 360, z: c.z + 130 },
    ]);
    const seg = [...sim.state.net.segments.values()].at(-1)!;
    const block = sim.state.net.blocks.get(seg.left)!;
    const inner = sim.state.net.blocks.get(seg.right)!;
    expect(block.valid.reduce((s, v) => s + v, 0)).toBeGreaterThan(10);
    expect(inner.valid.reduce((s, v) => s + v, 0)).toBeGreaterThan(5);
    expect(overlappingValidCells(sim)).toBe(0);
  });

  it('crossing an existing road creates a four-way intersection and splits both roads', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 400, z: c.z }]);
    const segsBefore = sim.state.net.segments.size;
    road(sim, [
      { x: c.x + 200, z: c.z - 150 },
      { x: c.x + 200, z: c.z + 150 },
    ]);
    // original split in two, new road split in two
    expect(sim.state.net.segments.size).toBe(segsBefore - 1 + 2 + 2);
    const four = [...sim.state.net.nodes.values()].filter((n) => nodeDegree(sim, n.id) === 4);
    expect(four.length).toBe(1);
    expect(four[0]!.x).toBeCloseTo(c.x + 200, 3);
    expect(overlappingValidCells(sim)).toBe(0);
    // No valid cell overlaps any road corridor.
    for (const cell of validCells(sim)) expect(sim.net.cellStaticValid(cell.block, cell.idx)).toBe(true);
  });

  it('ending on an existing road makes a T-junction', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 400, z: c.z }]);
    road(sim, [
      { x: c.x + 150, z: c.z - 200 },
      { x: c.x + 150, z: c.z },
    ]);
    const three = [...sim.state.net.nodes.values()].filter((n) => nodeDegree(sim, n.id) === 3);
    expect(three.length).toBe(1);
  });

  it('a road drawn along the dead ends of several streets joins each of them', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 480, z: c.z }]);
    // Drawn by hand, the middle streets end a little short of where the closing road will run.
    const endZ = [160, 158.5, 161.5, 160];
    [96, 192, 288, 384].forEach((dx, i) =>
      road(sim, [
        { x: c.x + dx, z: c.z },
        { x: c.x + dx, z: c.z - endZ[i]! },
      ]),
    );
    // Closing the grid along the ends: the middle ends lie on the new road and become T-junctions.
    const r = road(sim, [
      { x: c.x + 96, z: c.z - 160 },
      { x: c.x + 384, z: c.z - 160 },
    ]);
    expect(r.created!.length).toBe(3);
    const ends = [96, 192, 288, 384].map((dx) => sim.net.nearestNode({ x: c.x + dx, z: c.z - 160 }, 3)!);
    expect(ends.map((n) => nodeDegree(sim, n.id))).toEqual([2, 3, 3, 2]);
  });

  it('rejects invalid roads with a reason and charges nothing', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    const t0 = sim.state.treasury;
    const bad = (points: { x: number; z: number }[], re: RegExp, type: 'street' | 'avenue' = 'street') => {
      const r = sim.dispatch({ type: 'buildRoad', road: type, points });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(re);
    };
    bad([c, { x: c.x + 5, z: c.z }], /short/i);
    bad(
      [
        { x: 100, z: 100 },
        { x: -50, z: 100 },
      ],
      /city limits/i,
    );
    road(sim, [c, { x: c.x + 300, z: c.z }]);
    bad(
      [
        { x: c.x + 50, z: c.z + 6 },
        { x: c.x + 250, z: c.z + 6 },
      ],
      /close|overlap|exists/i,
    );
    bad(
      [
        { x: c.x + 300, z: c.z },
        { x: c.x + 120, z: c.z + 25 },
      ],
      /angle/i,
    );
    bad(
      [
        { x: c.x + 100, z: c.z + 100 },
        { x: c.x + 130, z: c.z + 100 },
        { x: c.x + 100, z: c.z + 120 },
      ],
      /tight/i,
    );
    // Water: find the river and try to cross it.
    let wx = -1;
    for (let x = 900; x < 2000; x += 4)
      if (sim.terrain.isWater(x, 1500)) {
        wx = x;
        break;
      }
    expect(wx).toBeGreaterThan(0);
    // A road that stops in the river, or a dirt road across it, is refused (bridges need
    // ramps on dry land and at least a street).
    bad(
      [
        { x: wx - 120, z: 1500 },
        { x: wx + 6, z: 1500 },
      ],
      /water/i,
    );
    const affordable = [
      { x: c.x + 60, z: c.z + 80 },
      { x: c.x + 260, z: c.z + 80 },
    ];
    expect(sim.preview({ type: 'buildRoad', road: 'street', points: affordable }).ok).toBe(true);
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: -sim.state.treasury + 100 });
    bad(affordable, /money/i);
    expect(sim.state.treasury).toBe(100);
    expect(t0).toBeGreaterThan(0);
  });

  it('preview never changes state', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    const h = sim.hash();
    const p = sim.preview({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 250, z: c.z }] });
    expect(p.ok).toBe(true);
    expect(p.ok && p.cost).toBeGreaterThan(0);
    expect(sim.hash()).toBe(h);
  });
});

describe('bulldoze and undo', () => {
  it('bulldozing refunds a quarter and removes blocks and orphan nodes', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    const r = road(sim, [c, { x: c.x + 300, z: c.z }]);
    const seg = sim.state.net.segments.get(r.created![0]!)!;
    const t = sim.state.treasury;
    const res = sim.dispatch({ type: 'bulldoze', target: { kind: 'segment', id: seg.id } });
    expect(res.ok).toBe(true);
    // A quarter of the road itself back; earthworks aren't refunded.
    expect(sim.state.treasury - t).toBe(Math.round((r.cost - earthCost(r)) * 0.25));
    expect(sim.state.net.segments.has(seg.id)).toBe(false);
    expect(sim.state.net.blocks.has(seg.left)).toBe(false);
    expect(sim.state.net.nodes.has(seg.b)).toBe(false);
    expect(sim.state.net.nodes.has(sim.state.highway.connect)).toBe(true);
  });

  it('undo removes the last road with a full refund, re-merging split roads with their zones', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 400, z: c.z }]);
    const mainSeg = [...sim.state.net.segments.values()].at(-1)!;
    sim.dispatch({ type: 'zone', zone: 'R', area: { kind: 'segment', id: mainSeg.id } });
    const zonedBefore = [...sim.state.net.blocks.values()].reduce(
      (s, b) => s + b.zone.filter((z) => z === 1).length,
      0,
    );
    const hashBefore = sim.hash();
    const t = sim.state.treasury;
    road(sim, [
      { x: c.x + 200, z: c.z - 150 },
      { x: c.x + 200, z: c.z + 150 },
    ]);
    expect(sim.state.net.segments.has(mainSeg.id)).toBe(false);
    const u = sim.dispatch({ type: 'undo' });
    expect(u.ok).toBe(true);
    expect(sim.state.treasury).toBe(t);
    expect(sim.state.net.segments.has(mainSeg.id)).toBe(true);
    const zonedAfter = [...sim.state.net.blocks.values()].reduce(
      (s, b) => s + b.zone.filter((z) => z === 1).length,
      0,
    );
    // Cells under the crossing road were lost when it was built; everything else comes back.
    expect(zonedAfter).toBeGreaterThan(zonedBefore - 48);
    expect(sim.state.net.nodes.size).toBe(3);
    expect(overlappingValidCells(sim)).toBe(0);
    expect(hashBefore).toBeTruthy();
  });
});

describe('zoning', () => {
  it('paints only valid cells, and dezoning clears them', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    const r = road(sim, [c, { x: c.x + 300, z: c.z }]);
    const seg = sim.state.net.segments.get(r.created![0]!)!;
    const z = sim.dispatch({
      type: 'zone',
      zone: 'R',
      area: {
        kind: 'brush',
        points: [
          { x: c.x + 50, z: c.z - 20 },
          { x: c.x + 250, z: c.z - 20 },
        ],
        radius: 20,
      },
    });
    expect(z.ok).toBe(true);
    const painted = cellsOf(z);
    expect(painted).toBeGreaterThan(30);
    for (const b of sim.state.net.blocks.values()) {
      for (let i = 0; i < b.zone.length; i++) if (b.zone[i]) expect(b.valid[i]).toBe(1);
    }
    const fill = sim.dispatch({ type: 'zone', zone: 'C', area: { kind: 'segment', id: seg.id } });
    expect(fill.ok).toBe(true);
    const all = sim.dispatch({ type: 'zone', zone: 'none', area: { kind: 'segment', id: seg.id } });
    expect(cellsOf(all)).toBeGreaterThan(painted);
    for (const b of sim.state.net.blocks.values()) expect(b.zone.every((v) => v === 0)).toBe(true);
    sim.dispatch({ type: 'undo' });
    expect([...sim.state.net.blocks.values()].some((b) => b.zone.some((v) => v === 2))).toBe(true);
  });

  it('zoning survives when a new road splits the zoned road', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 400, z: c.z }]);
    const seg = [...sim.state.net.segments.values()].at(-1)!;
    sim.dispatch({ type: 'zone', zone: 'I', area: { kind: 'segment', id: seg.id } });
    const before = [...sim.state.net.blocks.values()].reduce(
      (s, b) => s + b.zone.filter((z) => z === 3).length,
      0,
    );
    road(sim, [
      { x: c.x + 200, z: c.z - 150 },
      { x: c.x + 200, z: c.z + 150 },
    ]);
    const after = [...sim.state.net.blocks.values()].reduce(
      (s, b) => s + b.zone.filter((z) => z === 3).length,
      0,
    );
    expect(after).toBeGreaterThan(before - 48);
    expect(after).toBeLessThan(before);
  });
});

describe('determinism with roads and zones', () => {
  it('replay and save/load reproduce the state hash', () => {
    const opts = { seed: 'citybloom', preset: 'river' as const };
    const sim = Sim.create(opts);
    const c = connectPoint(sim);
    sim.advance(5);
    road(sim, [c, { x: c.x + 300, z: c.z }]);
    sim.advance(3);
    road(sim, [
      { x: c.x + 300, z: c.z },
      { x: c.x + 420, z: c.z },
      { x: c.x + 450, z: c.z + 120 },
    ]);
    road(
      sim,
      [
        { x: c.x + 150, z: c.z - 150 },
        { x: c.x + 150, z: c.z + 150 },
      ],
      'avenue',
    );
    sim.dispatch({
      type: 'zone',
      zone: 'R',
      area: { kind: 'brush', points: [{ x: c.x + 100, z: c.z + 30 }], radius: 60 },
    });
    sim.advance(10);
    const replayed = Sim.replay(opts, sim.log, sim.tick);
    expect(replayed.hash()).toBe(sim.hash());
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    // The loaded sim's derived caches behave the same.
    const cmd = {
      type: 'buildRoad' as const,
      road: 'street' as const,
      points: [
        { x: c.x + 250, z: c.z - 100 },
        { x: c.x + 250, z: c.z + 100 },
      ],
    };
    expect(loaded.dispatch(cmd).ok).toBe(sim.dispatch(cmd).ok);
    expect(loaded.hash()).toBe(sim.hash());
  });
});

describe('bridges', () => {
  it('cross water on a raised deck, cost more, and need land for their ramps', () => {
    const sim = newSim();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    let wx = -1;
    for (let x = 900; x < 2000; x += 4)
      if (sim.terrain.isWater(x, 1500)) {
        wx = x;
        break;
      }
    let ex = wx;
    while (sim.terrain.isWater(ex, 1500)) ex += 4;
    const span = ex - wx;
    expect(span).toBeGreaterThan(20);
    const across = [
      { x: wx - 130, z: 1500 },
      { x: ex + 130, z: 1500 },
    ];
    expect(sim.preview({ type: 'buildRoad', road: 'dirt', points: across }).ok).toBe(false);
    const land = sim.preview({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: wx - 400, z: 1500 },
        { x: wx - 130, z: 1500 },
      ],
    });
    const r = sim.dispatch({ type: 'buildRoad', road: 'street', points: across });
    expect(r.ok).toBe(true);
    // Per metre, the bridge costs several times a road on land (earthworks aside).
    const len = across[1]!.x - across[0]!.x;
    expect(r.ok && land.ok && (r.cost - earthCost(r)) / len).toBeGreaterThan(
      ((land.ok ? land.cost - earthCost(land) : 0) / 270) * 1.8,
    );
    const seg = r.ok ? r.created![0]! : -1;
    const deck = sim.deck(seg)!;
    expect(deck).not.toBeNull();
    expect(deck.overWater).toBeGreaterThan(span * 0.8);
    // The deck clears the water in the middle and meets the ground at the ends.
    const curve = sim.net.curve(seg);
    const midS = (wx + ex) / 2 - across[0]!.x;
    expect(deckAt(deck, midS)).toBeGreaterThan(4);
    const a = curve.pointAt(0);
    expect(Math.abs(deckAt(deck, 0) - sim.terrain.heightAt(a.x, a.z))).toBeLessThan(0.5);
    // The river doesn't split towns any more: the bridge carries traffic like any road.
    expect(sim.graph().segSeconds.get(seg)).toBeGreaterThan(0);
  });
});
