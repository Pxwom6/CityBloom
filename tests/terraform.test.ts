import { describe, expect, it } from 'vitest';
import { TERRAFORM } from '../src/data/terraform';
import { HEIGHT_RES, HEIGHT_STEP, SHORE_HEIGHT } from '../src/data/world';
import type { Command } from '../src/sim/commands';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { groundHeld } from '../src/sim/world/terraform';
import { buildTown, connectPoint, newSim, serveTown } from './helpers';

const tf = (
  mode: 'raise' | 'lower' | 'level' | 'smooth',
  x: number,
  z: number,
  radius = 48,
  extra: Partial<Extract<Command, { type: 'terraform' }>> = {},
): Command => ({ type: 'terraform', mode, points: [{ x, z }], radius, ...extra });

/** Height samples within `r` metres of (x, z). */
function samples(x: number, z: number, r: number): number[] {
  const out: number[] = [];
  for (let j = Math.ceil((z - r) / HEIGHT_STEP); j <= Math.floor((z + r) / HEIGHT_STEP); j++)
    for (let i = Math.ceil((x - r) / HEIGHT_STEP); i <= Math.floor((x + r) / HEIGHT_STEP); i++)
      if (Math.hypot(i * HEIGHT_STEP - x, j * HEIGHT_STEP - z) <= r) out.push(j * HEIGHT_RES + i);
  return out;
}

/** A dry, open spot on the map: no water within `r` metres, nothing built near. */
function openGround(sim: Sim, r = 80): { x: number; z: number } {
  const c = connectPoint(sim);
  for (let x = c.x + 700; x < 1800; x += 40)
    for (const z of [c.z - 500, c.z + 500, c.z - 300, c.z + 300]) {
      const idx = samples(x, z, r);
      if (
        idx.every((i) => sim.terrain.heights[i]! > 2) &&
        idx.every(
          (i) => !groundHeld(sim, (i % HEIGHT_RES) * HEIGHT_STEP, Math.floor(i / HEIGHT_RES) * HEIGHT_STEP),
        )
      )
        return { x, z };
    }
  throw new Error('no open ground');
}

describe('terraforming (M24)', () => {
  it('raises and lowers the ground under the brush, strongest at the centre, and charges by volume', () => {
    const sim = newSim();
    const at = openGround(sim);
    const centre = Math.round(at.z / HEIGHT_STEP) * HEIGHT_RES + Math.round(at.x / HEIGHT_STEP);
    const h0 = sim.terrain.heights[centre]!;
    const money = sim.state.treasury;
    const preview = sim.preview(tf('raise', at.x, at.z));
    expect(preview.ok).toBe(true);
    const r = sim.dispatch(tf('raise', at.x, at.z));
    expect(r.ok).toBe(true);
    const info = (r as unknown as { info: { volume: number; fill: number } }).info;
    expect(r.ok && r.cost).toBe(preview.ok && preview.cost);
    expect(sim.terrain.heights[centre]! - h0).toBeCloseTo(TERRAFORM.step, 1);
    expect(info.fill).toBeGreaterThan(1000);
    expect(r.ok && r.cost).toBe(Math.round(info.volume * TERRAFORM.costPerCubicMetre));
    expect(money - sim.state.treasury).toBe(r.ok && r.cost);
    expect(sim.state.economy.month.landscaping).toBe(-(r.ok ? r.cost : 0));
    // The rim barely moves; beyond it nothing does.
    const rim = samples(at.x, at.z, 60).filter((i) => !samples(at.x, at.z, 44).includes(i));
    for (const i of rim) expect(Math.abs(sim.state.terrainDelta[i]!)).toBeLessThan(0.1);
    sim.dispatch(tf('lower', at.x, at.z));
    sim.dispatch(tf('lower', at.x, at.z));
    expect(sim.terrain.heights[centre]! - h0).toBeCloseTo(-TERRAFORM.step, 1);
    // Saved as deltas: a reload has the same ground.
    const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())) as ReturnType<Sim['save']>);
    expect(back.terrain.heights[centre]).toBe(sim.terrain.heights[centre]);
  });

  it('never digs below the water table, and leaves water alone', () => {
    const sim = newSim();
    const at = openGround(sim);
    const idx = samples(at.x, at.z, 20);
    for (let k = 0; k < 40; k++) sim.dispatch(tf('lower', at.x, at.z, 32));
    for (const i of idx) expect(sim.terrain.heights[i]!).toBeGreaterThanOrEqual(SHORE_HEIGHT);
    // The river: nothing to change.
    let wet: { x: number; z: number } | null = null;
    for (let x = 400; x < 2000 && !wet; x += 16)
      if (samples(x, 1000, 40).every((i) => sim.terrain.heights[i]! < SHORE_HEIGHT)) wet = { x, z: 1000 };
    expect(wet).not.toBeNull();
    const r = sim.dispatch(tf('raise', wet!.x, wet!.z, 32));
    expect(r).toMatchObject({ ok: false, reason: 'Terraforming leaves water alone' });
  });

  it('levels to the height the drag starts at, and smooths rough ground', () => {
    const sim = newSim({ seed: 'hill', preset: 'highlands' });
    // The roughest open spot within reach of the highway.
    const c = connectPoint(sim);
    let best = { x: 0, z: 0, spread: 0 };
    for (let x = c.x + 300; x < 1600; x += 64)
      for (let z = 200; z < 1850; z += 64) {
        const hs = samples(x, z, 40).map((i) => sim.terrain.heights[i]!);
        if (hs.some((h) => h < 2)) continue;
        const spread = Math.max(...hs) - Math.min(...hs);
        if (spread > best.spread) best = { x, z, spread };
      }
    expect(best.spread).toBeGreaterThan(8);
    const core = samples(best.x, best.z, 16);
    const level = sim.terrain.heightAt(best.x, best.z);
    for (let k = 0; k < 4; k++)
      sim.dispatch(tf('level', best.x, best.z, 48, { level, stroke: 7, points: [{ x: best.x, z: best.z }] }));
    for (const i of core) expect(Math.abs(sim.terrain.heights[i]! - level)).toBeLessThan(0.1);
    // One drag, one undo step.
    expect(sim.history.undo).toHaveLength(1);
    expect(sim.history.undo[0]!.label).toBe('levelling');

    const sim2 = newSim({ seed: 'hill', preset: 'highlands' });
    const rough = () => {
      // Mean absolute difference between neighbouring samples.
      let sum = 0;
      let n = 0;
      for (const i of samples(best.x, best.z, 24)) {
        sum += Math.abs(sim2.terrain.heights[i]! - sim2.terrain.heights[i + 1]!);
        sum += Math.abs(sim2.terrain.heights[i]! - sim2.terrain.heights[i + HEIGHT_RES]!);
        n += 2;
      }
      return sum / n;
    };
    const before = rough();
    for (let k = 0; k < 6; k++) sim2.dispatch(tf('smooth', best.x, best.z, 48));
    expect(rough()).toBeLessThan(before * 0.8);
  });

  it('holds the ground buildings and roads stand on, with no cliffs beside them', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH);
    expect(sim.state.buildings.size).toBeGreaterThan(20);
    const seated = new Map([...sim.state.buildings.values()].map((b) => [b.id, b.y]));
    const civics = new Map([...sim.state.civics.values()].map((c) => [c.id, c.y]));
    const c = connectPoint(sim);
    // Hack away at the town with big brushes.
    let changed = 0;
    for (let k = 0; k < 6; k++)
      for (let x = c.x + 40; x < c.x + 520; x += 60)
        for (const z of [c.z - 120, c.z - 40, c.z + 40, c.z + 120]) {
          const r = sim.dispatch(tf(k % 2 ? 'lower' : 'raise', x, z, 64));
          if (r.ok) changed++;
        }
    expect(changed).toBeGreaterThan(0);
    for (const b of sim.state.buildings.values()) if (seated.has(b.id)) expect(b.y).toBe(seated.get(b.id));
    expect(sim.state.buildings.size).toBe(seated.size);
    for (const cv of sim.state.civics.values()) expect(cv.y).toBe(civics.get(cv.id));
    // Next to held ground, never steeper than 1 in 1 where the brush has been.
    let worst = 0;
    for (let j = 1; j < HEIGHT_RES - 1; j++)
      for (let i = 1; i < HEIGHT_RES - 1; i++) {
        const k = j * HEIGHT_RES + i;
        if (!sim.state.terrainDelta[k]) continue;
        for (const n of [k - 1, k + 1, k - HEIGHT_RES, k + HEIGHT_RES]) {
          const x = (n % HEIGHT_RES) * HEIGHT_STEP;
          const z = Math.floor(n / HEIGHT_RES) * HEIGHT_STEP;
          if (!groundHeld(sim, x, z)) continue;
          const pre = sim.terrain.base[k]! - sim.terrain.base[n]!;
          const now = sim.terrain.heights[k]! - sim.terrain.heights[n]!;
          if (Math.abs(now) > Math.abs(pre)) worst = Math.max(worst, Math.abs(now) / HEIGHT_STEP);
        }
      }
    expect(worst).toBeLessThanOrEqual(TERRAFORM.nearSlope + 0.02);
    const r = sim.dispatch(tf('raise', c.x + 200, c.z, 16));
    expect(r).toMatchObject({ ok: false, reason: 'Roads and buildings hold the ground here' });
  });

  it('a drag is one undo step that restores the ground and the money exactly', () => {
    const sim = newSim();
    const at = openGround(sim);
    const before = sim.hash();
    const money = sim.state.treasury;
    for (let k = 0; k < 5; k++)
      expect(
        sim.dispatch({
          type: 'terraform',
          mode: 'raise',
          points: [
            { x: at.x + k * 10, z: at.z },
            { x: at.x + k * 10 + 10, z: at.z },
          ],
          radius: 40,
          stroke: 3,
        }).ok,
      ).toBe(true);
    expect(sim.history.undo).toHaveLength(1);
    expect(sim.history.undo[0]!.label).toBe('raising ground');
    const after = sim.hash();
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.hash()).toBe(before);
    expect(sim.state.treasury).toBe(money);
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    expect(sim.hash()).toBe(after);
  });

  it('refuses when the city cannot pay, and a hillside levelled first takes a street full of lots', () => {
    const mk = () => {
      const s = newSim({ seed: 'hill', preset: 'highlands' });
      s.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
      return s;
    };
    const valid = (sim: Sim) => {
      let n = 0;
      for (const b of sim.state.net.blocks.values()) for (const v of b.valid) n += v;
      return n;
    };
    const plain = mk();
    const c = connectPoint(plain);
    const x = 824;
    const line = [
      { x, z: c.z },
      { x, z: c.z - 400 },
    ];
    expect(plain.dispatch({ type: 'buildRoad', road: 'street', points: line }).ok).toBe(true);
    const levelled = mk();
    let spent = 0;
    for (let z = c.z - 10; z > c.z - 390; z -= 20) {
      const level = levelled.terrain.heightAt(x, z);
      for (const dx of [-48, -16, 16, 48])
        for (let k = 0; k < 3; k++) {
          const r = levelled.dispatch(tf('level', x + dx, z, 40, { level }));
          if (r.ok) spent += r.cost;
        }
    }
    expect(levelled.dispatch({ type: 'buildRoad', road: 'street', points: line }).ok).toBe(true);
    console.log(
      `[terraform] hillside street: ${valid(plain)} buildable lots; levelled first for $${spent.toLocaleString('en-US')}: ${valid(levelled)}`,
    );
    expect(valid(levelled)).toBeGreaterThan(valid(plain) + 100);
    const broke = newSim();
    broke.state.treasury = 10;
    const at = openGround(broke);
    expect(broke.dispatch(tf('raise', at.x, at.z))).toMatchObject({ ok: false, reason: 'Not enough money' });
  });
});
