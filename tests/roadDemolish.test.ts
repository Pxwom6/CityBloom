import { describe, expect, it } from 'vitest';
import type { Command, CommandResult } from '../src/sim/commands';
import type { Sim } from '../src/sim/sim';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { Sim as SimClass } from '../src/sim/sim';
import { Curve, mid, type Vec2 } from '../src/sim/geom';
import { roadHalfWidth } from '../src/data/roads';
import { buildTown, connectPoint, newSim, road, serveTown } from './helpers';

/**
 * P2: building and upgrading roads removed buildings without saying so. Every road preview names
 * the buildings the road would take away, and the command then takes away exactly those.
 */
function grownTown(seed: string): { sim: Sim; streets: number[]; avenue: number[] } {
  const sim = newSim({ seed });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
  const t = buildTown(sim);
  serveTown(sim);
  sim.advance(TICKS_PER_MONTH * 4);
  return { sim, ...t };
}

const named = (r: CommandResult) =>
  r.ok ? ((r.info as { demolished?: number[] }).demolished ?? null) : null;

/** Run a command and report which buildings it removed. */
function removedBy(sim: Sim, cmd: Parameters<Sim['dispatch']>[0]): { res: CommandResult; gone: number[] } {
  const before = [...sim.state.buildings.keys()];
  const res = sim.dispatch(cmd);
  const gone = before.filter((id) => !sim.state.buildings.has(id)).sort((a, b) => a - b);
  return { res, gone };
}

describe('road previews count the buildings they remove (P2)', () => {
  it('an upgrade’s preview names exactly the buildings the upgrade removes, and the rest stay', () => {
    let cases = 0;
    let removed = 0;
    for (const seed of ['citybloom', 'p2a', 'p2b']) {
      const { sim, streets, avenue } = grownTown(seed);
      for (const seg of [...streets, ...avenue]) {
        if (!sim.state.net.segments.has(seg)) continue;
        for (const to of ['avenue', 'boulevard'] as const) {
          if (sim.state.net.segments.get(seg)!.type === to) continue;
          const cmd = { type: 'upgradeRoad', seg, road: to } as const;
          const along = new Set<number>();
          const s = sim.state.net.segments.get(seg)!;
          for (const bid of [s.left, s.right]) {
            const b = bid ? sim.state.net.blocks.get(bid) : undefined;
            if (b) for (const x of b.bld) if (x) along.add(x);
          }
          const pre = sim.preview(cmd);
          expect(pre.ok, `${seed} ${seg} → ${to}`).toBe(true);
          const { res, gone } = removedBy(sim, cmd);
          expect(named(pre), `${seed}: preview of ${seg} → ${to}`).toEqual(gone);
          expect((pre.info as { demolish: number }).demolish).toBe(gone.length);
          expect(named(res)).toEqual(gone);
          // Buildings that can stay, moved back on their lots, stay.
          expect(gone.length).toBeLessThanOrEqual(Math.max(2, along.size * 0.25));
          cases++;
          removed += gone.length;
          expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
        }
      }
    }
    expect(cases).toBeGreaterThan(20);
    // The towns have corner lots a wider road can't keep, so the count is really exercised.
    expect(removed).toBeGreaterThan(5);
  });

  it('a new road’s preview names exactly the buildings it removes', () => {
    let cases = 0;
    for (const seed of ['citybloom', 'p2a']) {
      const { sim } = grownTown(seed);
      const c = connectPoint(sim);
      const at = (dx: number, dz: number) => ({ x: c.x + dx, z: c.z + dz });
      const roads: { road: 'street' | 'avenue'; points: { x: number; z: number }[] }[] = [];
      // Straight cuts through the grown blocks north and south of the avenue, diagonals, and curves.
      for (const dz of [-60, -100, -130, 40, 80])
        for (const road of ['street', 'avenue'] as const)
          roads.push({ road, points: [at(30, dz), at(470, dz)] });
      for (const [a, b] of [
        [at(40, -150), at(300, 60)],
        [at(150, 140), at(450, -40)],
        [at(60, 30), at(420, -120)],
      ])
        roads.push({ road: 'street', points: [a!, b!] });
      for (const [a, m, b] of [
        [at(30, -40), at(240, -160), at(460, -40)],
        [at(30, 60), at(240, 160), at(460, 60)],
      ])
        roads.push({ road: 'street', points: [a!, m!, b!] });
      for (const r of roads) {
        const cmd: Command = { type: 'buildRoad', road: r.road, points: r.points };
        const pre = sim.preview(cmd);
        if (!pre.ok) continue;
        const { res, gone } = removedBy(sim, cmd);
        expect(res.ok).toBe(true);
        expect(named(pre), `${seed}: ${r.road} ${JSON.stringify(r.points)}`).toEqual(gone);
        expect((pre.info as { demolish: number }).demolish).toBe(gone.length);
        if (gone.length) cases++;
        expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
      }
    }
    expect(cases).toBeGreaterThan(5);
  });

  it('a road that starts or ends on a street names the lots its junction takes', () => {
    // Splitting a street gives neither half the column of lots the new junction lands in.
    const { sim } = grownTown('citybloom');
    const c = connectPoint(sim);
    let cases = 0;
    let fromSplits = 0;
    for (let dx = 30; dx <= 470; dx += 11)
      for (const dir of [-1, 1]) {
        const cmd: Command = {
          type: 'buildRoad',
          road: 'street',
          points: [
            { x: c.x + dx, z: c.z },
            { x: c.x + dx, z: c.z + dir * 70 },
          ],
        };
        const pre = sim.preview(cmd);
        if (!pre.ok) continue;
        // What the road's own surface covers, before it's built.
        const [a, b] = cmd.points as [Vec2, Vec2];
        const surface = sim.net.buildingsUnder(new Curve(a, mid(a, b), b), roadHalfWidth('street'));
        const { gone } = removedBy(sim, cmd);
        expect(named(pre), `T at ${dx}, ${dir}`).toEqual(gone);
        if (gone.length > surface.length) fromSplits++;
        cases++;
        expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
      }
    expect(cases).toBeGreaterThan(40);
    expect(fromSplits).toBeGreaterThan(0);
  });

  it('counts lots the earthworks leave too steep, on a ridge', () => {
    // The ridge on the `hill` highlands map (tests/grading.test.ts): homes along a graded street.
    const sim = SimClass.create({ seed: 'hill', preset: 'highlands' });
    sim.testMode = true;
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
    const c = connectPoint(sim);
    road(sim, [c, { x: 560, z: 1030 }], 'avenue');
    road(sim, [
      { x: 560, z: 1030 },
      { x: 560, z: 1000 },
    ]);
    const seg = road(sim, [
      { x: 560, z: 1000 },
      { x: 840, z: 1000 },
    ]).created![0]!;
    sim.dispatch({
      type: 'zone',
      zone: 'R',
      area: {
        kind: 'brush',
        points: [
          { x: 570, z: 1000 },
          { x: 830, z: 1000 },
        ],
        radius: 40,
      },
    });
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 5);
    const cmd: Command = { type: 'upgradeRoad', seg, road: 'boulevard' };
    const pre = sim.preview(cmd);
    expect(pre.ok, pre.ok ? '' : pre.reason).toBe(true);
    expect((pre.info as { earth: { cost: number } }).earth.cost).toBeGreaterThan(0);
    const { gone } = removedBy(sim, cmd);
    expect(named(pre)).toEqual(gone);
  });

  it('a preview changes nothing', () => {
    const { sim, streets, avenue } = grownTown('p2b');
    const c = connectPoint(sim);
    const look = () => ({
      hash: sim.hash(),
      dirty: [sim.net.dirty.nodes.size, sim.net.dirty.segments.size, sim.net.dirty.blocks.size],
      heights: sim.terrain.heights.reduce((a, h, i) => (a + h * ((i % 97) + 1)) % 1e9, 0),
      cells: [...sim.state.net.blocks.values()].map((b) => {
        const p = sim.net.cellCenter(b.id, 0);
        return `${b.id}:${p.x.toFixed(4)},${p.z.toFixed(4)}`;
      }),
      roads: sim.net.segHash.query({ minX: 0, minZ: 0, maxX: 4096, maxZ: 4096 }).length,
    });
    const before = look();
    for (const seg of [...streets, ...avenue])
      for (const to of ['avenue', 'boulevard'] as const) sim.preview({ type: 'upgradeRoad', seg, road: to });
    for (let dx = 30; dx < 470; dx += 37)
      sim.preview({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: c.x + dx, z: c.z - 120 },
          { x: c.x + dx + 40, z: c.z + 120 },
        ],
      });
    expect(look()).toEqual(before);
  });
});
