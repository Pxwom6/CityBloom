import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { Curve, v2 } from '../src/sim/geom';
import { GRADING, ROAD_TYPES } from '../src/data/roads';
import { HEIGHT_RES, HEIGHT_STEP, MAP_PRESETS, MAP_SIZE, SHORE_HEIGHT } from '../src/data/world';
import { gradeProfile, profileAt } from '../src/sim/world/grading';
import { seatHeight } from '../src/sim/world/earthworks';
import { footprint } from '../src/sim/world/buildings';
import { civicRect } from '../src/sim/world/civic';
import { Terrain } from '../src/sim/terrain/terrain';
import { Rng } from '../src/sim/rng';
import { TICKS_PER_MONTH as TICKS_PER_DAY } from '../src/sim/time';
import { connectPoint, placeAlong, road } from './helpers';

/** A straight 4 m-sampled curve along x from 0 to `len`. */
const line = (len: number) => new Curve(v2(0, 0), v2(len / 2, 0), v2(len, 0), 4);
const steepest = (p: { s: Float32Array; h: Float32Array }) => {
  let g = 0;
  for (let i = 1; i < p.h.length; i++)
    g = Math.max(g, Math.abs(p.h[i]! - p.h[i - 1]!) / (p.s[i]! - p.s[i - 1]!));
  return g;
};

describe('graded road profiles (M13)', () => {
  it('follow ground that is gentle enough, shaving off short bumps', () => {
    // A 10 % slope with a 1.5 m bump 4 m long: the old 16 m check saw 20 % and refused.
    const ground = (x: number) => 10 + x * 0.1 + (Math.abs(x - 100) < 2 ? 1.5 : 0);
    const p = gradeProfile(line(200), (x) => ground(x), 'street', null, null);
    expect(p.fail).toBeUndefined();
    expect(steepest(p)).toBeLessThanOrEqual(ROAD_TYPES.street.maxGrade + 1e-6);
    expect(p.maxCut).toBeLessThan(1.5);
    expect(p.maxFill).toBeLessThan(0.5);
    expect(p.raisedLength).toBe(0);
  });

  it('never climb more than their type allows, splitting cut and fill over a steep slope', () => {
    for (const type of ['street', 'avenue', 'boulevard'] as const) {
      // Ground 6 points steeper than the limit: 12 m to split between cut and fill.
      const slope = ROAD_TYPES[type].maxGrade + 0.06;
      const p = gradeProfile(line(200), (x) => 10 + x * slope, type, null, null);
      expect(p.fail, type).toBeUndefined();
      expect(steepest(p), type).toBeLessThanOrEqual(ROAD_TYPES[type].maxGrade + 1e-6);
      // Both ends are free, so neither takes all the difference.
      expect(p.maxCut, type).toBeGreaterThan(1);
      expect(p.maxFill, type).toBeGreaterThan(1);
      expect(p.maxCut, type).toBeLessThanOrEqual(GRADING.maxCut);
    }
    // Streets may climb what boulevards may not.
    expect(ROAD_TYPES.street.maxGrade).toBeGreaterThan(ROAD_TYPES.avenue.maxGrade);
    expect(ROAD_TYPES.avenue.maxGrade).toBeGreaterThan(ROAD_TYPES.boulevard.maxGrade);
  });

  it('meet the roads they join at their height', () => {
    const p = gradeProfile(line(160), (x) => 20 + 6 * Math.sin(x / 25), 'street', 18, 24);
    expect(p.fail).toBeUndefined();
    expect(p.h[0]).toBeCloseTo(18, 3);
    expect(p.h[p.h.length - 1]).toBeCloseTo(24, 3);
    expect(profileAt(p, 0)).toBeCloseTo(18, 3);
  });

  it('go over a deep valley on a viaduct, and say what to do when the ends are too far apart', () => {
    const valley = (x: number) => (Math.abs(x - 120) < 40 ? 5 : 30);
    const v = gradeProfile(line(240), (x) => valley(x), 'avenue', 30, 30);
    expect(v.fail).toBeUndefined();
    expect(v.raisedLength).toBeGreaterThan(40);
    const far = gradeProfile(line(100), () => 10, 'street', 10, 40);
    expect(far.fail?.reason).toMatch(/Too steep: the ends are 30 m apart/);
    expect(far.fail?.reason).toMatch(/climb 16\s%/);
    expect(far.fail?.reason).toMatch(/longer|wind/);
  });

  it('refuse only a cutting deeper than the limit, saying by how much and what would fix it', () => {
    // A 60 % hill between two roads at its foot.
    const hill = (x: number) => 5 + Math.max(0, 40 - Math.abs(x - 100) * 0.6 * 1.6);
    const p = gradeProfile(line(200), (x) => hill(x), 'street', 5, 5);
    expect(p.fail?.reason).toMatch(/Too steep: .* it would need a \d+ m cutting \(14 m at most\)/);
    expect(p.fail?.reason).toMatch(/Go round the hill, or wind up it/);
  });
});

/** The ridge on the `hill` highlands map (scripts/dev/earthshot.mjs): up to 18 m high. */
function ridgeTown(): { sim: Sim; seg: number; cost: number; earth: number } {
  const sim = Sim.create({ seed: 'hill', preset: 'highlands' });
  sim.testMode = true;
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 300_000 });
  const c = connectPoint(sim);
  road(sim, [c, { x: 560, z: 1030 }], 'avenue');
  road(sim, [
    { x: 560, z: 1030 },
    { x: 560, z: 1000 },
  ]);
  const r = road(sim, [
    { x: 560, z: 1000 },
    { x: 840, z: 1000 },
  ]);
  const info = r.info as { grade: { ground: number; max: number; earth: { cost: number; volume: number } } };
  // The old rule (12 % over 16 m of raw ground) would have refused it.
  expect(info.grade.ground).toBeGreaterThan(0.2);
  expect(info.grade.max).toBeLessThanOrEqual(ROAD_TYPES.street.maxGrade + 0.005);
  return { sim, seg: r.created![0]!, cost: r.cost, earth: info.grade.earth.cost };
}

/** Steepest climb of the ground along a road's centre line over any 16 m. */
function surfaceGrade(sim: Sim, seg: number): number {
  const curve = sim.net.curve(seg);
  let worst = 0;
  for (let s = 0; s + 16 <= curve.length; s += 4) {
    const a = curve.pointAt(s);
    const b = curve.pointAt(s + 16);
    worst = Math.max(worst, Math.abs(sim.terrain.heightAt(b.x, b.z) - sim.terrain.heightAt(a.x, a.z)) / 16);
  }
  return worst;
}

describe('earthworks (M13)', () => {
  it('cut and fill the ground under a street over a ridge, and charge for the earth moved', () => {
    const { sim, seg, cost, earth } = ridgeTown();
    // The road surface (draped on the reshaped ground) climbs within the street's limit.
    expect(surfaceGrade(sim, seg)).toBeLessThan(ROAD_TYPES.street.maxGrade + 0.02);
    const d = sim.state.terrainDelta;
    let cut = 0;
    let fill = 0;
    for (let i = 0; i < d.length; i++) {
      if (d[i]! < -0.5) cut++;
      if (d[i]! > 0.5) fill++;
      // Only near the roads: nothing beyond the ridge street's reach moved.
      if (d[i]) {
        const x = (i % HEIGHT_RES) * HEIGHT_STEP;
        const z = Math.floor(i / HEIGHT_RES) * HEIGHT_STEP;
        let near = Infinity;
        for (const id of sim.state.net.segments.keys())
          near = Math.min(near, sim.net.curve(id).project({ x, z }).d);
        expect(near).toBeLessThan(60);
      }
    }
    expect(cut).toBeGreaterThan(20);
    expect(fill).toBeGreaterThan(5);
    expect(earth).toBeGreaterThan(500);
    expect(cost).toBe(Math.round(sim.net.curve(seg).length * ROAD_TYPES.street.costPerMetre) + earth);
    // Height = seed terrain + saved delta, everywhere.
    const fresh = new Terrain('hill', 'highlands');
    for (let i = 0; i < d.length; i += 97)
      expect(sim.terrain.heights[i]).toBeCloseTo(fresh.heights[i]! + d[i]!, 4);
  });

  it('undo puts the ground back exactly and refunds the earthworks', () => {
    const { sim, cost } = ridgeTown();
    const before = Sim.create({ seed: 'hill', preset: 'highlands' });
    const t = sim.state.treasury;
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.treasury - t).toBe(cost);
    // Only the first two roads' earthworks remain: rebuild those on a fresh map to compare.
    before.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 300_000 });
    road(before, [connectPoint(before), { x: 560, z: 1030 }], 'avenue');
    road(before, [
      { x: 560, z: 1030 },
      { x: 560, z: 1000 },
    ]);
    expect([...sim.state.terrainDelta]).toEqual([...before.state.terrainDelta]);
    expect([...sim.terrain.heights]).toEqual([...before.terrain.heights]);
  });

  it('terrain edits survive save and load exactly, and the city plays on', () => {
    const { sim } = ridgeTown();
    sim.advance(120);
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    loaded.testMode = true;
    expect(loaded.hash()).toBe(sim.hash());
    expect([...loaded.terrain.heights]).toEqual([...sim.terrain.heights]);
    sim.advance(600);
    loaded.advance(600);
    expect(loaded.hash()).toBe(sim.hash());
  });

  it('saves from before M13 load with their terrain unchanged and play on', () => {
    // The playtest city (save version 10): no terrain delta, so the seed's terrain as it was.
    const save = decodeSave(readFileSync('Saves/Ashton.citybloom'));
    expect(save.version).toBeLessThan(12);
    const sim = Sim.fromSave(save);
    sim.testMode = true;
    const fresh = new Terrain(sim.state.options.seed, sim.state.options.preset, sim.state.options.terrain);
    expect(sim.state.terrainDelta.every((v) => v === 0)).toBe(true);
    expect([...sim.terrain.heights]).toEqual([...fresh.heights]);
    const pop = sim.state.totals.population;
    expect(pop).toBeGreaterThan(1000);
    sim.advance(TICKS_PER_DAY);
    expect(sim.state.totals.population).toBeGreaterThan(pop * 0.9);
    // Its buildings stand where they did.
    for (const b of sim.state.buildings.values())
      expect(b.y).toBeCloseTo(
        seatHeight((x, z) => sim.terrain.heightAt(x, z), footprint(b), false),
        4,
      );
  });

  it('buildings beside new earthworks settle onto the ground: nothing floats or sinks', () => {
    const { sim } = ridgeTown();
    sim.dispatch({
      type: 'zone',
      zone: 'R',
      area: { kind: 'brush', points: [v2(570, 960), v2(830, 960)], radius: 40 },
    });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.advance(TICKS_PER_DAY * 2);
    expect(sim.state.buildings.size).toBeGreaterThan(5);
    // A second street over the ridge just behind the homes: its earthworks reach their lots.
    road(sim, [
      { x: 560, z: 1000 },
      { x: 560, z: 930 },
    ]);
    road(sim, [
      { x: 560, z: 930 },
      { x: 840, z: 930 },
    ]);
    const h = (x: number, z: number) => sim.terrain.heightAt(x, z);
    for (const b of sim.state.buildings.values())
      expect(b.y).toBeCloseTo(seatHeight(h, footprint(b), false), 4);
    // Every occupied lot is still buildable ground.
    for (const block of sim.state.net.blocks.values())
      for (let i = 0; i < block.bld.length; i++)
        if (block.bld[i]) expect(sim.net.cellStaticValid(block.id, i)).toBe(true);
  });

  it('civic buildings on uneven ground stand on a level pad, undone with them', () => {
    const { sim, seg } = ridgeTown();
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    const before = sim.terrain.heights.slice();
    const id = placeAlong(sim, 'firestation', seg);
    const c = sim.state.civics.get(id)!;
    const r = civicRect(c);
    const h = (x: number, z: number) => sim.terrain.heightAt(x, z);
    expect(c.y).toBeCloseTo(seatHeight(h, r, true), 4);
    // Level under its footprint.
    let lo = Infinity;
    let hi = -Infinity;
    for (const u of [-0.9, 0, 0.9])
      for (const w of [-0.9, 0, 0.9]) {
        const x = r.x + u * r.hw * Math.cos(r.angle) - w * r.hd * Math.sin(r.angle);
        const z = r.z + u * r.hw * Math.sin(r.angle) + w * r.hd * Math.cos(r.angle);
        lo = Math.min(lo, h(x, z));
        hi = Math.max(hi, h(x, z));
      }
    const changed = sim.terrain.heights.some((v, i) => v !== before[i]);
    if (changed) expect(hi - lo).toBeLessThan(0.6);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect([...sim.terrain.heights]).toEqual([...before]);
  });

  it('upgrading regrades to the new type, or says why it is too steep', () => {
    const { sim, seg } = ridgeTown();
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    const boulevard = sim.preview({ type: 'upgradeRoad', seg, road: 'boulevard' });
    // The ridge street climbs 16 %; a boulevard may climb 8 %: regraded with more earthworks, or
    // refused with the reason.
    if (boulevard.ok) {
      expect((boulevard.info as { earth: { cost: number } | null }).earth!.cost).toBeGreaterThan(0);
      expect(sim.dispatch({ type: 'upgradeRoad', seg, road: 'boulevard' }).ok).toBe(true);
      expect(surfaceGrade(sim, seg)).toBeLessThan(ROAD_TYPES.boulevard.maxGrade + 0.02);
    } else expect(boulevard.reason).toMatch(/steep/i);
    const avenue = sim.preview({ type: 'upgradeRoad', seg, road: 'avenue' });
    expect(avenue.ok || /steep/i.test(avenue.reason)).toBe(true);
  });
});

describe('sampled street placements across every map preset (M13 done criterion)', () => {
  it('are refused as too steep only on truly extreme ground', () => {
    let placed = 0;
    let steepRefused = 0;
    for (const preset of MAP_PRESETS.map((p) => p.id)) {
      const sim = Sim.create({ seed: 'grade-test', preset });
      sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 10_000_000 });
      const rng = Rng.fromSeed(`grade-test:${preset}`);
      let n = 0;
      for (let guard = 0; n < 60 && guard < 2000; guard++) {
        const a = { x: rng.range(80, MAP_SIZE - 80), z: rng.range(80, MAP_SIZE - 80) };
        const ang = rng.range(0, Math.PI * 2);
        const len = rng.range(60, 300);
        const b = { x: a.x + Math.cos(ang) * len, z: a.z + Math.sin(ang) * len };
        if (Math.min(a.x, b.x) < 60 || b.z < 40 || b.x > MAP_SIZE - 40 || b.z > MAP_SIZE - 40) continue;
        let wet = false;
        let worst = 0;
        const hs: number[] = [];
        for (let t = 0; t <= 1.0001; t += 4 / len) {
          const hh = sim.terrain.heightAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
          if (hh < SHORE_HEIGHT + 0.5) wet = true;
          hs.push(hh);
        }
        if (wet) continue;
        const w = Math.max(1, Math.round(50 / (len / (hs.length - 1))));
        for (let i = 0; i + w < hs.length; i++)
          worst = Math.max(worst, Math.abs(hs[i + w]! - hs[i]!) / ((w * len) / (hs.length - 1)));
        n++;
        placed++;
        const r = sim.preview({ type: 'buildRoad', road: 'street', points: [a, b] });
        if (!r.ok && /steep/i.test(r.reason)) {
          steepRefused++;
          // Extreme ground only: a steepest 50 m of 35 % or more.
          expect(worst, `${preset}: ${r.reason}`).toBeGreaterThanOrEqual(0.35);
        }
      }
    }
    expect(placed).toBe(240);
    expect(steepRefused / placed).toBeLessThan(0.05);
  });
});
