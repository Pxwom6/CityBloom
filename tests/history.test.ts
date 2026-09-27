import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { HISTORY_LIMIT } from '../src/sim/history';
import { SAVE_VERSION } from '../src/sim/save';
import { TICKS_PER_MONTH as TICKS_PER_DAY } from '../src/sim/time';
import { buildTown, connectPoint, newSim, placeAlong, road, roadsidePose, serveTown } from './helpers';
import { moveFee } from '../src/sim/world/civic';
import { CIVIC } from '../src/data/civic';

/** A served town a day old: roads, zoned lots with buildings, utilities and services. */
function grownTown(): { sim: Sim; streets: number[] } {
  const sim = newSim();
  const town = buildTown(sim);
  serveTown(sim);
  sim.advance(TICKS_PER_DAY);
  return { sim, streets: town.streets };
}

/** Do `cmd`, then undo and redo it, checking the city's hash matches before and after each time. */
function roundTrip(sim: Sim, cmd: Parameters<Sim['dispatch']>[0]) {
  const before = sim.hash();
  const r = sim.dispatch(cmd);
  expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  const after = sim.hash();
  expect(after).not.toBe(before);
  const u = sim.dispatch({ type: 'undo' });
  expect(u.ok, u.ok ? '' : u.reason).toBe(true);
  expect(sim.hash()).toBe(before);
  const d = sim.dispatch({ type: 'redo' });
  expect(d.ok, d.ok ? '' : d.reason).toBe(true);
  expect(sim.hash()).toBe(after);
  return { before, after };
}

describe('undo and redo (M14)', () => {
  it('bulldozing a road restores it with its lots and buildings, exactly, and redoes it exactly', () => {
    const { sim, streets } = grownTown();
    // The side street with the most buildings along it.
    const onSeg = (id: number) => {
      const s = sim.state.net.segments.get(id)!;
      let n = 0;
      for (const bid of [s.left, s.right])
        for (const x of sim.state.net.blocks.get(bid)?.bld ?? []) if (x) n++;
      return n;
    };
    const seg = streets
      .filter((id) => sim.state.net.segments.has(id))
      .sort((a, b) => onSeg(b) - onSeg(a))[0]!;
    expect(onSeg(seg)).toBeGreaterThan(4);
    const buildings = sim.state.buildings.size;
    const t0 = sim.state.treasury;
    roundTrip(sim, { type: 'bulldoze', target: { kind: 'segment', id: seg } });
    // After the redo the road and its buildings are gone again, the refund paid again.
    expect(sim.state.net.segments.has(seg)).toBe(false);
    expect(sim.state.buildings.size).toBeLessThan(buildings);
    expect(sim.state.treasury).toBeGreaterThan(t0);
    // And undone once more, the city plays on as if nothing happened.
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    const twin = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    twin.testMode = true;
    sim.advance(600);
    twin.advance(600);
    expect(twin.hash()).toBe(sim.hash());
  });

  it('bulldozing a civic building restores it with its add-ons', () => {
    const { sim } = grownTown();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 50_000 });
    const fs = [...sim.state.civics.values()].find((c) => c.def === 'landfill')!;
    expect(sim.dispatch({ type: 'addModule', civic: fs.id, module: 'garbageTruck' }).ok).toBe(true);
    sim.advance(120);
    const modules = [...fs.modules];
    roundTrip(sim, { type: 'bulldoze', target: { kind: 'civic', id: fs.id } });
    expect(sim.state.civics.has(fs.id)).toBe(false);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.civics.get(fs.id)!.modules).toEqual(modules);
  });

  it('bulldozing a zoned building, and placing one, undo and redo exactly', () => {
    const { sim } = grownTown();
    const b = [...sim.state.buildings.values()].find((x) => x.state === 1)!;
    roundTrip(sim, { type: 'bulldoze', target: { kind: 'building', id: b.id } });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 50_000 });
    const before = sim.hash();
    const seg = [...sim.state.net.segments.keys()].at(-1)!;
    placeAlong(sim, 'police', seg);
    const after = sim.hash();
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.hash()).toBe(before);
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    expect(sim.hash()).toBe(after);
  });

  it('a zoning stroke undoes and redoes as one step, exactly', () => {
    const sim = newSim();
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 400, z: c.z }]);
    const before = sim.hash();
    const undoSteps = sim.history.undo.length;
    // One drag, painted as several commands.
    for (let k = 0; k < 5; k++)
      sim.dispatch({
        type: 'zone',
        zone: 'R',
        area: { kind: 'brush', points: [{ x: c.x + 40 + k * 60, z: c.z - 20 }], radius: 24 },
        stroke: 7,
      });
    expect(sim.history.undo.length).toBe(undoSteps + 1);
    const after = sim.hash();
    expect(after).not.toBe(before);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.hash()).toBe(before);
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    expect(sim.hash()).toBe(after);
    // Dezoning is undone the same way.
    roundTrip(sim, {
      type: 'zone',
      zone: 'none',
      area: { kind: 'segment', id: [...sim.state.net.segments.keys()].at(-1)! },
    });
  });

  it('road upgrades and new roads undo and redo exactly', () => {
    const { sim, streets } = grownTown();
    const seg = streets.find((id) => sim.state.net.segments.has(id))!;
    roundTrip(sim, { type: 'upgradeRoad', seg, road: 'avenue' });
    const c = connectPoint(sim);
    roundTrip(sim, {
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: c.x + 100, z: c.z - 220 },
        { x: c.x + 400, z: c.z - 220 },
      ],
    });
  });

  it('refuses to undo what later growth depends on, and says why', () => {
    const sim = newSim();
    buildTown(sim, { zone: false });
    serveTown(sim);
    const c = connectPoint(sim);
    // A street along the north ends of the side streets, joining them, zoned in one stroke.
    const r = road(sim, [
      { x: c.x + 96, z: c.z - 160 },
      { x: c.x + 384, z: c.z - 160 },
    ]);
    const segs = r.created!;
    sim.dispatch({
      type: 'zone',
      zone: 'R',
      area: {
        kind: 'brush',
        points: [
          { x: c.x + 100, z: c.z - 185 },
          { x: c.x + 380, z: c.z - 185 },
        ],
        radius: 22,
      },
    });
    sim.advance(TICKS_PER_DAY * 2);
    const blocks = segs.flatMap((id) => {
      const g = sim.state.net.segments.get(id)!;
      return [g.left, g.right].map((bid) => sim.state.net.blocks.get(bid)!).filter((b) => b);
    });
    expect(blocks.some((b) => b.bld.some((x) => x))).toBe(true);
    // Undoing the zoning leaves the lots that have homes on them zoned.
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    for (const b of blocks) for (let i = 0; i < b.bld.length; i++) if (b.bld[i]) expect(b.zone[i]).toBe(1);
    // The road itself now has homes along it: undoing it would demolish them, so it's refused.
    const u = sim.dispatch({ type: 'undo' });
    expect(u.ok).toBe(false);
    expect(!u.ok && u.reason).toMatch(/^Can't undo the road: buildings have grown/);
    for (const id of segs) expect(sim.state.net.segments.has(id)).toBe(true);
  });

  it(`keeps the last ${HISTORY_LIMIT} actions, and a new action clears redo`, () => {
    const sim = newSim();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 900, z: c.z }]);
    for (let k = 0; k < HISTORY_LIMIT + 5; k++)
      sim.dispatch({
        type: 'zone',
        zone: k % 2 ? 'C' : 'R',
        area: { kind: 'brush', points: [{ x: c.x + 30 + k * 20, z: c.z - 20 }], radius: 12 },
      });
    expect(sim.history.undo.length).toBe(HISTORY_LIMIT);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.history.redo.length).toBe(1);
    sim.dispatch({
      type: 'zone',
      zone: 'I',
      area: { kind: 'brush', points: [{ x: c.x + 800, z: c.z + 20 }], radius: 12 },
    });
    expect(sim.history.redo.length).toBe(0);
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(false);
  });

  it('history is not saved; saves from before M14 drop theirs and load', () => {
    const { sim } = grownTown();
    expect(sim.history.undo.length).toBeGreaterThan(0);
    const save = JSON.parse(JSON.stringify(sim.save())) as {
      version: number;
      state: Record<string, unknown>;
    };
    expect(save.version).toBe(SAVE_VERSION);
    expect('undo' in save.state).toBe(false);
    const loaded = Sim.fromSave(save as never);
    expect(loaded.history.undo.length).toBe(0);
    expect(loaded.hash()).toBe(sim.hash());
    // A version-12 save still carries its old undo list.
    const old = {
      ...save,
      version: 12,
      state: { ...save.state, undo: [{ kind: 'road', tick: 0, cost: 0 }] },
    };
    const fromOld = Sim.fromSave(old as never);
    expect(fromOld.hash()).toBe(sim.hash());
    fromOld.advance(60);
  });
});

describe('moving buildings (M14)', () => {
  it('a civic building moves with its add-ons for a small fee, frees its old site, and undoes exactly', () => {
    const { sim, streets } = grownTown();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 100_000 });
    const fs = [...sim.state.civics.values()].find((c) => c.def === 'firestation')!;
    expect(sim.dispatch({ type: 'addModule', civic: fs.id, module: 'engineBay' }).ok).toBe(true);
    const was = { x: fs.x, z: fs.z, angle: fs.angle, side: fs.side, modules: [...fs.modules] };
    // Somewhere else: the far end of a side street.
    const seg = streets.filter((id) => sim.state.net.segments.has(id)).at(-1)!;
    const curve = sim.net.curve(seg);
    let to: ReturnType<typeof roadsidePose> | null = null;
    for (let s = 20; s < curve.length - 20 && !to; s += 8)
      for (const side of [1, -1] as const) {
        const pose = roadsidePose(sim, seg, s, side, 30);
        if (Math.hypot(pose.x - fs.x, pose.z - fs.z) < 80) continue;
        if (sim.preview({ type: 'moveBuilding', id: fs.id, ...pose }).ok) {
          to = pose;
          break;
        }
      }
    expect(to).not.toBeNull();
    const t0 = sim.state.treasury;
    const cmd = { type: 'moveBuilding' as const, id: fs.id, ...to! };
    const pre = sim.preview(cmd);
    const { before, after } = roundTrip(sim, cmd);
    expect(before).not.toBe(after);
    const moved = sim.state.civics.get(fs.id)!;
    expect(Math.hypot(moved.x - was.x, moved.z - was.z)).toBeGreaterThan(80);
    expect(moved.modules).toEqual(was.modules);
    expect(pre.ok && t0 - sim.state.treasury).toBe(pre.ok ? pre.cost : -1);
    expect(pre.ok && pre.cost).toBeGreaterThanOrEqual(moveFee('firestation'));
    expect(moveFee('firestation')).toBeLessThan(CIVIC.get('firestation')!.cost / 5);
    // Its old site can be built on again: another building fits where it stood.
    const again = sim.preview({
      type: 'placeBuilding',
      def: 'firestation',
      x: was.x,
      z: was.z,
      angle: was.angle,
      side: was.side,
    });
    expect(again.ok, again.ok ? '' : again.reason).toBe(true);
  });

  it('refuses a site a new building would be refused, with the same reason', () => {
    const { sim } = grownTown();
    const [a, b] = [...sim.state.civics.values()];
    const r = sim.preview({
      type: 'moveBuilding',
      id: a!.id,
      x: b!.x + 1,
      z: b!.z,
      angle: b!.angle,
      side: b!.side,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/Overlaps/);
    expect(sim.preview({ type: 'moveBuilding', id: 999_999, x: 0, z: 0, angle: 0, side: 1 }).ok).toBe(false);
  });
});
