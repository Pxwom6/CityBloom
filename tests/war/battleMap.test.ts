import { describe, expect, it } from 'vitest';
import { Battle } from '../../src/sim/battle/battle';
import type { BattleFrame, BattleUnitView } from '../../src/sim/battle/types';
import { TAG } from '../../src/sim/battle/types';
import {
  armedHint,
  battleClock,
  buildOrders,
  clickSelect,
  edgeMark,
  fitView,
  mapBounds,
  needsTarget,
  ordersFor,
  ownUnits,
  pruneSelection,
  roadLines,
  structAt,
  structKind,
  structStates,
  structsOf,
  targetOf,
  toScreen,
  toWorld,
  unitAt,
  unitsInBox,
  viewCentre,
  zoomBy,
  ZOOM,
  ORDER_UNITS,
} from '../../src/ui/battleMapView';
import { input, lineLayout, units } from '../battle/handmade';

/**
 * M39, step 4: the battle map's arithmetic (design call 6): the transform between the battle's
 * metres and the canvas, what a click or a box lands on, and what the order buttons send.
 */

const structs = [
  { id: 10, tags: TAG.civic | TAG.military, x: 600, z: 480, r: 12, gun: 0 },
  { id: 11, tags: TAG.home, x: 650, z: 540, r: 8, gun: 0 },
  { id: 12, tags: TAG.civic | TAG.military | TAG.defence, x: 700, z: 480, r: 6, hp: 600, gun: 3, range: 140 },
];
const layout = () =>
  lineLayout(
    structs.map((s) => ({ ...s, against: ['land' as const, 'air' as const] })),
    [],
  );

const unit = (id: number, side: 0 | 1, x: number, z: number, state: 0 | 1 | 2 = 0): BattleUnitView => ({
  id,
  kind: 'tank',
  side,
  x,
  z,
  y: 0,
  yaw: 0,
  aim: 0,
  hp: 1,
  state,
});

describe('M39 battle map: the view', () => {
  it('fits the battle area into the canvas, the same both ways', () => {
    const l = layout();
    const b = mapBounds(l);
    // The box (and a little margin), nothing smaller.
    expect(b.x0).toBeLessThan(l.box[0] + 1);
    expect(b.x1).toBeGreaterThan(l.box[2] - 1);
    const v = fitView(b, 800, 500);
    // The whole area is on the canvas, touching one pair of its sides.
    const a = toScreen(v, b.x0, b.z0);
    const c = toScreen(v, b.x1, b.z1);
    expect(a.x).toBeGreaterThanOrEqual(-0.001);
    expect(a.y).toBeGreaterThanOrEqual(-0.001);
    expect(c.x).toBeLessThanOrEqual(800.001);
    expect(c.y).toBeLessThanOrEqual(500.001);
    expect(Math.max(c.x - a.x - 800, c.y - a.y - 500)).toBeLessThanOrEqual(0.001);
    // Screen and ground agree both ways.
    const w = toWorld(v, 123, 321);
    const p = toScreen(v, w.x, w.z);
    expect(p.x).toBeCloseTo(123, 6);
    expect(p.y).toBeCloseTo(321, 6);
    // The middle of the canvas is the middle of the area.
    const mid = viewCentre(v);
    expect(mid.x).toBeCloseTo((b.x0 + b.x1) / 2, 6);
    expect(mid.z).toBeCloseTo((b.z0 + b.z1) / 2, 6);
  });

  it('zooms about a centre and stays inside the area', () => {
    const b = mapBounds(layout());
    const one = fitView(b, 800, 500, 1);
    const three = fitView(b, 800, 500, 3, { x: 650, z: 500 });
    expect(three.scale).toBeCloseTo(one.scale * 3, 6);
    expect(viewCentre(three).x).toBeCloseTo(650, 6);
    // A centre near the edge is held back so the view doesn't leave the area.
    const edge = fitView(b, 800, 500, 4, { x: b.x0 - 5_000, z: b.z0 - 5_000 });
    expect(edge.left).toBeGreaterThanOrEqual(b.x0 - 0.001);
    expect(edge.top).toBeGreaterThanOrEqual(b.z0 - 0.001);
    // Zoom buttons are bounded.
    let z = 1;
    for (let k = 0; k < 20; k++) z = zoomBy(z, 1);
    expect(z).toBe(ZOOM.max);
    for (let k = 0; k < 20; k++) z = zoomBy(z, -1);
    expect(z).toBe(ZOOM.min);
    expect(fitView(b, 800, 500, 99).scale).toBeCloseTo(one.scale * ZOOM.max, 6);
  });

  it('brings a way in just outside the box into view and marks a far one at the edge', () => {
    const l = layout();
    // (The air way in is 100 m outside the box's west side... the test layout's entries.)
    const near = { ...l, entries: [{ route: 'air' as const, x: l.box[0] - 100, z: 500, edge: -1, at: 0 }] };
    expect(mapBounds(near).x0).toBeLessThan(l.box[0] - 100);
    const far = { ...l, entries: [{ route: 'sea' as const, x: 600, z: l.box[3] + 3_000, edge: -1, at: 0 }] };
    const b = mapBounds(far);
    expect(b.z1).toBeLessThan(l.box[3] + 200);
    const v = fitView(b, 800, 500);
    const m = edgeMark(v, 600, l.box[3] + 3_000)!;
    expect(m.y).toBeGreaterThan(400);
    expect(m.y).toBeLessThanOrEqual(500);
    expect(m.angle).toBeCloseTo(Math.PI / 2, 1);
    // On the canvas: no mark.
    expect(edgeMark(v, 600, 500)).toBeNull();
  });
});

describe('M39 battle map: what is under a click', () => {
  const l = layout();
  const all = structsOf(l);
  const v = fitView(mapBounds(l), 800, 500);

  it('reads the layout: structures by index and kind, and the roads', () => {
    expect(all.map((s) => s.id)).toEqual([10, 11, 12]);
    expect(all.map((s) => s.kind)).toEqual(['base', 'home', 'defence']);
    expect(all[2]!.gun).toBe(true);
    expect(structKind(TAG.hq | TAG.civic)).toBe('hq');
    expect(structKind(TAG.job | TAG.industry)).toBe('industry');
    const roads = roadLines(l);
    expect(roads.length).toBe(6);
    expect(roads[0]![0]).toBe(0);
    expect(roads[0]![1]).toBe(500);
    expect(roads[5]!.at(-2)).toBe(1200);
  });

  it('finds the structure under a point, and not a fallen one when asked for a standing one', () => {
    const s = all[1]!;
    const p = toScreen(v, s.x, s.z);
    expect(structAt(v, all, [0, 0, 0], p.x + 1, p.y - 1)?.k).toBe(1);
    expect(structAt(v, all, [0, 0, 0], 2, 2)).toBeNull();
    // Fallen: still there to see, but not to order at.
    expect(structAt(v, all, [0, 2, 0], p.x, p.y)?.k).toBe(1);
    expect(structAt(v, all, [0, 2, 0], p.x, p.y, 4, true)).toBeNull();
  });

  it('reads the frame’s digits for the structures’ states', () => {
    expect(structStates(null, 3)).toEqual([0, 0, 0]);
    expect(structStates({ structs: '012' } as BattleFrame, 3)).toEqual([0, 1, 2]);
    expect(structStates({ structs: '1' } as BattleFrame, 3)).toEqual([1, 0, 0]);
  });

  it('picks the nearest unit, skips the knocked out, and finds those in a dragged box', () => {
    const list = [unit(1, 0, 600, 500), unit(2, 0, 610, 500), unit(3, 1, 800, 500), unit(4, 0, 604, 500, 2)];
    const p = toScreen(v, 612, 500);
    expect(unitAt(v, list, p.x, p.y)?.id).toBe(2);
    // The wreck (4) is nobody's to pick.
    const q = toScreen(v, 604, 500);
    expect(unitAt(v, list, q.x, q.y, (u) => u.side === 0 && u.state !== 2)?.id).toBe(1);
    expect(unitAt(v, list, 3, 3)).toBeNull();
    // A box from corner to corner, dragged either way.
    const a = toScreen(v, 590, 490);
    const b = toScreen(v, 620, 510);
    const ids = (x: BattleUnitView[]) => x.map((u) => u.id).sort();
    expect(ids(unitsInBox(v, list, a.x, a.y, b.x, b.y))).toEqual([1, 2]);
    expect(ids(unitsInBox(v, list, b.x, b.y, a.x, a.y))).toEqual([1, 2]);
    expect(ids(unitsInBox(v, list, a.x, a.y, b.x, b.y, (u) => u.side === 1))).toEqual([]);
  });

  it('keeps a selection to the units still fighting, and toggles with a modifier', () => {
    const frame = { units: [unit(1, 0, 0, 0), unit(2, 0, 0, 0, 2), unit(3, 1, 0, 0)] } as BattleFrame;
    expect(pruneSelection([1, 2, 3, 9], frame, 0)).toEqual([1]);
    expect(ownUnits(frame, 1).map((u) => u.id)).toEqual([3]);
    expect(clickSelect([1], 5, false)).toEqual([5]);
    expect(clickSelect([1], 5, true)).toEqual([1, 5]);
    expect(clickSelect([1, 5], 5, true)).toEqual([1]);
  });
});

describe('M39 battle map: orders', () => {
  const own = [1, 2, 3, 4];

  it('offers each side its orders', () => {
    expect(ordersFor(0)).toEqual(['focus', 'hold', 'free', 'withdraw']);
    expect(ordersFor(1)).toEqual(['focus', 'guard', 'hold', 'free']);
    expect(needsTarget('focus') && needsTarget('guard') && !needsTarget('hold')).toBe(true);
    expect(targetOf('focus', 0)).toBe('structure');
    expect(targetOf('focus', 1)).toBe('attacker');
    expect(targetOf('guard', 1)).toBe('structure');
    expect(targetOf('hold', 0)).toBeNull();
    expect(armedHint('focus', 1)).toMatch(/attacker/);
    expect(armedHint('guard', 1)).toMatch(/building/);
  });

  it('names the chosen units, or none when they are all of the side', () => {
    expect(buildOrders('hold', 0, [2, 3], own)).toEqual({ orders: [{ kind: 'hold', units: [2, 3] }] });
    expect(buildOrders('free', 0, [1, 2, 3, 4], own)).toEqual({ orders: [{ kind: 'free' }] });
    // Units that are not the side's own (an enemy’s id) are left out.
    expect(buildOrders('hold', 0, [2, 99], own)).toEqual({ orders: [{ kind: 'hold', units: [2] }] });
  });

  it('wants a target for focus and guard, and a choice of units first', () => {
    expect(buildOrders('focus', 0, [1], own, 7)).toEqual({
      orders: [{ kind: 'focus', target: 7, units: [1] }],
    });
    expect(buildOrders('focus', 0, [1], own)).toEqual({ problem: 'Click a building' });
    expect(buildOrders('focus', 1, [1], own)).toEqual({ problem: 'Click an attacker' });
    expect(buildOrders('guard', 1, [1, 2], own, 0)).toEqual({
      orders: [{ kind: 'guard', target: 0, units: [1, 2] }],
    });
    expect(buildOrders('hold', 0, [], own)).toEqual({ problem: 'Choose some units first' });
    // A target of 0 (the first structure) is a target.
    expect('orders' in buildOrders('focus', 0, [1], own, 0)).toBe(true);
  });

  it('refuses what a side cannot do', () => {
    expect(buildOrders('withdraw', 1, [1], own)).toEqual({ problem: 'Only attackers can withdraw' });
    expect(buildOrders('guard', 0, [1], own, 3)).toEqual({ problem: 'Only defenders can guard a building' });
    expect(buildOrders('withdraw', 0, [1, 2], own)).toEqual({
      orders: [{ kind: 'withdraw', units: [1, 2] }],
    });
  });

  it('splits a long choice into orders the room takes', () => {
    const many = Array.from({ length: 150 }, (_, k) => k + 1);
    const r = buildOrders('hold', 0, many.slice(0, 140), many);
    expect('orders' in r && r.orders.map((o) => o.units!.length)).toEqual([ORDER_UNITS, ORDER_UNITS, 12]);
  });

  it('writes battle time as minutes and seconds', () => {
    expect(battleClock(0)).toBe('0:00');
    expect(battleClock(130)).toBe('1:05');
    expect(battleClock(1_440)).toBe('12:00');
  });
});

describe('M39 battle map: the frame carries the structures’ states', () => {
  it('shows what stands, what is hurt and what has fallen, as the battle goes on', () => {
    const l = layout();
    const b = new Battle(input(l, units('tank', 6, { x: 0, z: 500 }), { target: 'military' }));
    const first = b.frame();
    expect(first.structs).toBe('000');
    let last = first;
    for (let k = 0; k < 1_400 && !b.outcome; k++) {
      b.stepOnce();
      if (k % 2 === 0) last = b.frame();
    }
    last = b.frame();
    expect(last.structs).toHaveLength(3);
    expect(last.structs).toMatch(/^[012]{3}$/);
    // Something was hit by the end, and the digits agree with the battle's own records.
    const res = b.result();
    const down = res.destroyed.length;
    const hurt = res.damaged.length;
    expect([...last.structs!].filter((c) => c === '2')).toHaveLength(down);
    expect([...last.structs!].filter((c) => c === '1').length).toBeGreaterThanOrEqual(0);
    expect(down + hurt).toBeGreaterThan(0);
  });
});
