/**
 * The zone brush's front row (phase 6 end): lots grow only from the row of cells against the kerb, so a
 * stroke painted beside a street rather than on it (as a finger paints on a phone) zoned the rows behind
 * and left paint that never grew. The zone tool now paints the front row in front of such a stroke
 * (`kerbPoint`, `ZoneTool.paintKerb`); the sim's own rules are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { kerbPoint } from '../src/tools/zoneTool';
import { CELL, ROWS } from '../src/data/zones';
import { roadHalfWidth } from '../src/data/roads';
import type { Vec2 } from '../src/sim/geom';
import { connectPoint, countBuildings, newSim, placeAlong, road } from './helpers';
import { TICKS_PER_MONTH } from '../src/sim/time';

const HW = roadHalfWidth('street');

describe('kerbPoint', () => {
  it('finds the front row in line with a point whose brush reaches the rows behind but not the front', () => {
    // A street along z = 0; a point 35 m north with a 24 m brush reaches 11–59 m: rows 1–3, not row 0.
    const q = kerbPoint({ x: 100, z: -35 }, 24, { x: 100, z: 0 }, 35, HW);
    expect(q).not.toBeNull();
    expect(q!.x).toBeCloseTo(100);
    expect(q!.z).toBeCloseTo(-(HW + CELL / 2));
  });

  it('leaves alone a brush that reaches the front row itself, or doesn’t reach the road’s rows at all', () => {
    expect(kerbPoint({ x: 0, z: -12 }, 24, { x: 0, z: 0 }, 12, HW)).toBeNull();
    const far = HW + (ROWS - 0.5) * CELL + 24 + 1;
    expect(kerbPoint({ x: 0, z: -far }, 24, { x: 0, z: 0 }, far, HW)).toBeNull();
  });
});

describe('a stroke painted beside a street (seed phone, the phase 6 playthrough’s town)', () => {
  function town() {
    const sim = newSim({ seed: 'phone' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    const c = connectPoint(sim);
    const r = road(sim, [c, { x: c.x + 116, z: c.z }, { x: c.x + 230, z: c.z }]);
    const seg = r.created![0]!;
    // Power and water at the street's far end, south (the homes go north).
    const south = road(sim, [
      { x: c.x + 230, z: c.z },
      { x: c.x + 230, z: c.z + 200 },
    ]).created![0]!;
    placeAlong(sim, 'coal', south);
    placeAlong(sim, 'pump', south);
    placeAlong(sim, 'septic', south);
    return { sim, c, seg };
  }
  const stroke = (c: Vec2): Vec2[] => [
    { x: c.x + 16, z: c.z - 35 },
    { x: c.x + 216, z: c.z - 35 },
  ];
  const frontRowZoned = (sim: ReturnType<typeof newSim>, seg: number) => {
    const s = sim.state.net.segments.get(seg)!;
    let n = 0;
    for (const id of [s.left, s.right]) {
      const b = id ? sim.state.net.blocks.get(id) : undefined;
      if (b) for (let col = 0; col < b.cols; col++) if (b.zone[col * ROWS]) n++;
    }
    return n;
  };

  it('grows nothing from the brush alone: the row against the kerb stays unzoned', () => {
    const { sim, c, seg } = town();
    sim.dispatch({ type: 'zone', zone: 'R', area: { kind: 'brush', points: stroke(c), radius: 24 } });
    expect(frontRowZoned(sim, seg)).toBe(0);
    sim.advance(TICKS_PER_MONTH * 3);
    expect(countBuildings(sim, (b) => b.zone === 1)).toBe(0);
  });

  it('grows homes once the tool paints the front row in front of the stroke', () => {
    const { sim, c, seg } = town();
    const pts = stroke(c);
    sim.dispatch({ type: 'zone', zone: 'R', area: { kind: 'brush', points: pts, radius: 24 } });
    // What the zone tool sends beside the stroke: a thin line along the front row.
    const kerb = pts.map((p) => {
      const hit = sim.net.nearestSegment(p, 24 + ROWS * CELL + 12)!;
      return kerbPoint(p, 24, hit, hit.d, HW)!;
    });
    expect(kerb.every(Boolean)).toBe(true);
    sim.dispatch({ type: 'zone', zone: 'R', area: { kind: 'brush', points: kerb, radius: CELL / 2 + 1 } });
    expect(frontRowZoned(sim, seg)).toBeGreaterThan(10);
    sim.advance(TICKS_PER_MONTH * 3);
    expect(countBuildings(sim, (b) => b.zone === 1)).toBeGreaterThan(5);
  });
});
