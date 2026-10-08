import { describe, expect, it } from 'vitest';
import type { RoadTypeId } from '../src/data/roads';
import type { Command, CommandResult } from '../src/sim/commands';
import type { Vec2 } from '../src/sim/geom';
import type { Sim } from '../src/sim/sim';
import { advise } from '../src/sim/systems/advisors';
import { snapPoint, type SnapResult } from '../src/tools/snap';
import { buildTown, connectPoint, newSim, placeAlong, road } from './helpers';

/**
 * P1: a road end meant to join a road but landing short of it was silent. Ends that land near a
 * road they could join snap to it, the preview says when a road joins nothing or only roads that
 * can't reach the highway, and the city knows its islands.
 */

const at = (c: Vec2, dx: number, dz: number): Vec2 => ({ x: c.x + dx, z: c.z + dz });

/** A connected street east from the highway, and one turning south from its end: a corner and a dead end. */
function ell(type: RoadTypeId = 'street'): { sim: Sim; c: Vec2 } {
  const sim = newSim();
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  const c = connectPoint(sim);
  road(sim, [c, at(c, 300, 0)], type);
  road(sim, [at(c, 300, 0), at(c, 300, 200)], type);
  return { sim, c };
}

/** Draw a street as the road tool does: both ends snapped, the end with the way it arrives. */
function drawLikeTool(
  sim: Sim,
  a: Vec2,
  b: Vec2,
  type: RoadTypeId = 'street',
): { s: SnapResult; e: SnapResult; pre: CommandResult; res: CommandResult } {
  const s = snapPoint(sim.net, a, { from: null, scale: 1, near: true });
  const e = snapPoint(sim.net, b, { from: s, scale: 1, near: true, arriving: s });
  const cmd: Command = {
    type: 'buildRoad',
    road: type,
    points: [
      { x: s.x, z: s.z },
      { x: e.x, z: e.z },
    ],
  };
  const pre = sim.preview(cmd);
  const res = sim.dispatch(cmd);
  return { s, e, pre, res };
}

const link = (r: CommandResult) => (r.info as { link?: string } | undefined)?.link;
const made = (r: CommandResult): number[] => (r.ok ? (r.created ?? []) : []);

describe('road ends that miss (P1)', () => {
  for (const type of ['street', 'avenue'] as const)
    for (const n of [3, 10, 18])
      it(`join ${type === 'avenue' ? 'an' : 'a'} ${type}'s dead end, corner and middle from ${n} m away`, () => {
        const cases: [string, (c: Vec2) => [Vec2, Vec2], 'node' | 'segment'][] = [
          ['dead end', (c) => [at(c, 300, 320), at(c, 300, 200 + n)], 'node'],
          ['corner', (c) => [at(c, 420, -120), at(c, 300 + n / Math.SQRT2, -n / Math.SQRT2)], 'node'],
          ['middle', (c) => [at(c, 150, -150), at(c, 150, -n)], 'segment'],
        ];
        for (const [what, ends, kind] of cases) {
          const { sim, c } = ell(type);
          const [a, b] = ends(c);
          const { e, pre, res } = drawLikeTool(sim, a, b);
          expect(res.ok, `${what}: ${res.ok ? '' : res.reason}`).toBe(true);
          expect(e.kind, what).toBe(kind);
          expect(link(pre), what).toBe('highway');
          expect(sim.isSegmentConnected(made(res).at(-1)!), what).toBe(true);
        }
      });

  it('leave an end further out free, and say it joins nothing', () => {
    const { sim, c } = ell();
    const { e, pre, res } = drawLikeTool(sim, at(c, 150, -150), at(c, 150, -26));
    expect(['node', 'segment']).not.toContain(e.kind);
    expect(res.ok).toBe(true);
    expect(link(pre)).toBe('none');
    expect(sim.isSegmentConnected(made(res)[0]!)).toBe(false);
  });

  it('never grab a road the new one runs alongside, or one a road merely starts beside', () => {
    const { sim, c } = ell();
    // Nearly parallel, ending 10 m to the side of the street: not a join.
    const e = snapPoint(sim.net, at(c, 150, -10), {
      from: { ...at(c, 60, -17), kind: 'free' },
      scale: 1,
      near: true,
      arriving: at(c, 60, -17),
    });
    expect(['node', 'segment']).not.toContain(e.kind);
    // A first click 17 m beside a street's middle isn't a loose end: left where it is.
    const s = snapPoint(sim.net, at(c, 150, -17), { from: null, scale: 1, near: true });
    expect(['node', 'segment']).not.toContain(s.kind);
  });

  it('leave it to the player when two roads compete', () => {
    const sim = newSim();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    const c = connectPoint(sim);
    road(sim, [c, at(c, 300, 0)]);
    road(sim, [at(c, 100, 0), at(c, 100, -200)]);
    road(sim, [at(c, 136, 0), at(c, 136, -200)]);
    const e = snapPoint(sim.net, at(c, 118, -100), {
      from: { ...at(c, 118, -260), kind: 'free' },
      scale: 1,
      near: true,
      arriving: at(c, 118, -260),
    });
    expect(['node', 'segment']).not.toContain(e.kind);
  });

  it('start from a loose end close by', () => {
    const sim = newSim();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    const c = connectPoint(sim);
    road(sim, [at(c, 100, -100), at(c, 100, -300)]);
    for (const n of [3, 10, 18])
      expect(
        snapPoint(sim.net, at(c, 100, -100 + n), { from: null, scale: 1, near: true }).kind,
        `${n} m`,
      ).toBe('node');
    expect(snapPoint(sim.net, at(c, 100, -75), { from: null, scale: 1, near: true }).kind).not.toBe('node');
  });

  it('say whether a road reaches the highway', () => {
    const { sim, c } = ell();
    const pv = (a: Vec2, b: Vec2, type: RoadTypeId = 'street') =>
      link(sim.preview({ type: 'buildRoad', road: type, points: [a, b] }));
    expect(pv(at(c, 150, -80), at(c, 150, 80))).toBe('highway');
    expect(pv(at(c, 500, -300), at(c, 700, -300))).toBe('none');
    road(sim, [at(c, 500, -300), at(c, 700, -300)]);
    expect(pv(at(c, 600, -300), at(c, 600, -500))).toBe('island');
    expect(pv(at(c, 500, -400), at(c, 700, -400), 'rail')).toBeUndefined();
  });

  it('know the islands, and forget one once it is joined up', () => {
    const sim = newSim();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    buildTown(sim);
    expect(sim.roadIslands()).toEqual([]);
    const c = connectPoint(sim);
    const ivy = road(sim, [at(c, 120, -260), at(c, 360, -260)]).created!;
    const islands = sim.roadIslands();
    expect(islands.length).toBe(1);
    expect(islands[0]!.segs.sort()).toEqual([...ivy].sort());
    const curve = sim.net.curve(islands[0]!.segs[0]!);
    expect(curve.project(islands[0]!.at).d).toBeLessThan(0.5);
    // Joining it to a street that reaches the highway: no islands.
    const x = c.x + (480 * 1) / 5;
    road(sim, [{ x, z: c.z - 160 }, at(c, 120, -260)]);
    expect(sim.roadIslands()).toEqual([]);
    // Bulldozing the link again cuts it off; undo joins it back.
    const link = sim.net.nearestSegment({ x: (x + c.x + 120) / 2, z: c.z - 210 }, 3)!.seg;
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'segment', id: link } }).ok).toBe(true);
    expect(sim.roadIslands().length).toBe(1);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.roadIslands()).toEqual([]);
  });

  it('get an advisor who names them, more urgently once they hold something', () => {
    const sim = newSim();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    buildTown(sim);
    sim.advance(60);
    const c = connectPoint(sim);
    const island = () => advise(sim).find((a) => a.advisor === 'transport' && a.segs?.length);
    expect(island()).toBeUndefined();
    const ivy = road(sim, [at(c, 120, -300), at(c, 400, -300)]).created!;
    expect(island()?.severity).toBe(1);
    expect(island()?.segs).toEqual(expect.arrayContaining(ivy));
    expect(island()?.title).toMatch(/can.t reach the highway/);
    sim.dispatch({
      type: 'zone',
      zone: 'R',
      area: { kind: 'brush', points: [at(c, 130, -300), at(c, 390, -300)], radius: 30 },
    });
    expect(island()?.severity).toBe(2);
    placeAlong(sim, 'primary', ivy[0]!);
    expect(island()?.severity).toBe(3);
  });

  it('a new city with only the highway and the regional railway is told to build a road, not that it has one cut off', () => {
    const sim = newSim();
    sim.advance(60);
    expect(advise(sim).some((a) => a.title === 'No road to the highway')).toBe(false);
    road(sim, [at(connectPoint(sim), 400, -300), at(connectPoint(sim), 600, -300)]);
    sim.advance(60);
    expect(advise(sim).some((a) => a.title === 'No road to the highway')).toBe(true);
  });

  it('a first street from the highway is never called cut off, even before the hour turns', () => {
    // Paused, as a new city starts: the totals the advisor used to read update hourly.
    const sim = newSim();
    const c = connectPoint(sim);
    road(sim, [c, at(c, 120, -200)]);
    expect(advise(sim).some((a) => a.title === 'No road to the highway')).toBe(false);
    expect(advise(sim).some((a) => a.segs?.length)).toBe(false);
  });
});
