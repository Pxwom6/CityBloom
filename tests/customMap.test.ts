import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { HEIGHT_RES, HEIGHT_STEP, MAP_PRESETS } from '../src/data/world';
import { SAVE_VERSION, migrations, type SaveFile } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import {
  checkMap,
  mapFromGenerator,
  packHeights,
  unpackHeights,
  type MapData,
} from '../src/sim/terrain/customMap';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, serveTown } from './helpers';

/** A copy of a map with its heights changed by `f(x, z, h)`. */
function reshape(map: MapData, f: (x: number, z: number, h: number) => number): MapData {
  const h = unpackHeights(map.heights);
  for (let j = 0; j < HEIGHT_RES; j++)
    for (let i = 0; i < HEIGHT_RES; i++) {
      const k = j * HEIGHT_RES + i;
      h[k] = f(i * HEIGHT_STEP, j * HEIGHT_STEP, h[k]!);
    }
  return { ...map, heights: packHeights(h) };
}

describe('custom maps (M24)', () => {
  it('packs heights to the centimetre', () => {
    const h = new Float32Array(HEIGHT_RES * HEIGHT_RES);
    for (let k = 0; k < h.length; k++)
      h[k] = Math.sin(k * 0.013) * 25 + (k % 7) * 0.37 + Math.floor(k / 9000) * 30;
    const back = unpackHeights(packHeights(h));
    let worst = 0;
    for (let k = 0; k < h.length; k++) worst = Math.max(worst, Math.abs(back[k]! - h[k]!));
    expect(worst).toBeLessThan(0.0051); // half a centimetre, and float rounding
  });

  it('a map made from the generator plays like the generated map', () => {
    const map = mapFromGenerator('citybloom', 'river', 'Test');
    const a = Sim.create({ seed: 'citybloom', preset: 'river' });
    const b = Sim.create({ cityName: 'On a map' }, map);
    let worst = 0;
    for (let k = 0; k < a.terrain.heights.length; k++)
      worst = Math.max(worst, Math.abs(a.terrain.heights[k]! - b.terrain.heights[k]!));
    expect(worst).toBeLessThan(0.006);
    expect([...b.state.trees]).toEqual([...a.state.trees]);
    expect([...b.terrain.ore]).toEqual([...a.terrain.ore]);
    const hw = (s: Sim) => s.state.net.nodes.get(s.state.highway.connect)!;
    expect(hw(b).z).toBe(hw(a).z);
    expect(b.state.railway).not.toBeNull();
    expect(b.state.map?.name).toBe('Test');
  });

  it('every generated map passes the playability check; flooded or cliff-bound starts fail', () => {
    for (const p of MAP_PRESETS)
      for (const seed of ['citybloom', 'hill', 'port']) {
        const r = checkMap(mapFromGenerator(seed, p.id, 'x'));
        expect(r.ok, `${seed} ${p.id}: ${r.problems.map((x) => x.text).join('; ')}`).toBe(true);
        expect(r.startArea).toBeGreaterThan(20);
      }
    const base = mapFromGenerator('citybloom', 'river', 'x');
    const hz = base.highwayZ;
    const flooded = reshape(base, (x, z, h) => (x < 200 && Math.abs(z - hz) < 150 ? -4 : h));
    const wet = checkMap(flooded);
    expect(wet.ok).toBe(false);
    expect(wet.problems[0]!.text).toMatch(/under water/);
    // A sawtooth of steep ridges over the whole start area.
    const rough = reshape(base, (x, z, h) =>
      Math.hypot(x, z - hz) < 700 ? h + (Math.floor(x / 8 + z / 8) % 2) * 6 : h,
    );
    const r = checkMap(rough);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.text).join(' ')).toMatch(/steep|buildable land/);
    // The railway and resources only warn.
    const noRail = checkMap({
      ...base,
      railZ: null,
      ore: new Uint8Array(base.ore.length),
      oil: new Uint8Array(base.oil.length),
    });
    expect(noRail.ok).toBe(true);
    expect(noRail.warnings.map((w) => w.text).join(' ')).toMatch(/No railway.*No ore/);
  });

  it('a city grows on a reshaped map, keeps the map in its save and loads exactly', () => {
    // A lake in the middle of the map and a plateau to the south.
    const base = mapFromGenerator('flatland', 'lakes', 'Lake and plateau', true);
    const map = reshape(base, (x, z, h) => {
      const d = Math.hypot(x - 1300, z - 1000);
      if (d < 220) return -4 + (d / 220) * 3;
      if (z > 1500 && x > 600) return h + 12;
      return h;
    });
    expect(checkMap(map).ok).toBe(true);
    const sim = Sim.create({ cityName: 'Lakeside' }, map);
    sim.testMode = true;
    expect(sim.terrain.isWater(1300, 1000)).toBe(true);
    expect(sim.terrain.heightAt(1000, 1800)).toBeCloseTo(18, 1);
    expect(sim.state.weather.climate).toBe('continental');
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    console.log(`[customMap] Lakeside after two months: ${sim.state.totals.population} residents`);
    expect(sim.state.totals.population).toBeGreaterThan(200);
    const json = JSON.parse(JSON.stringify(sim.save())) as SaveFile;
    const back = Sim.fromSave(json);
    expect(back.hash()).toBe(sim.hash());
    expect(back.terrain.heightAt(1000, 1800)).toBe(sim.terrain.heightAt(1000, 1800));
    back.advance(TICKS_PER_MONTH);
    sim.advance(TICKS_PER_MONTH);
    expect(back.hash()).toBe(sim.hash());
  });

  it(`saves from before v${SAVE_VERSION} load on a generated map`, () => {
    const sim = Sim.create({ seed: 'citybloom', preset: 'river' });
    buildTown(sim);
    const save = JSON.parse(JSON.stringify(sim.save())) as SaveFile;
    const st = save.state as Record<string, unknown>;
    delete st.map;
    st.version = 21;
    save.version = 21;
    expect(migrations[21]).toBeTypeOf('function');
    const back = Sim.fromSave(save);
    expect(back.state.map).toBeNull();
    expect(back.state.version).toBe(SAVE_VERSION);
    back.advance(TICKS_PER_MONTH);
    expect(back.state.totals.population).toBeGreaterThan(0);
    // The version-10 playtest city too, through every migration.
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    expect(old.state.map).toBeNull();
    const pop = old.state.totals.population;
    old.advance(TICKS_PER_MONTH);
    expect(old.state.totals.population).toBeGreaterThan(pop * 0.9);
    const again = Sim.fromSave(JSON.parse(JSON.stringify(old.save())) as SaveFile);
    expect(again.hash()).toBe(old.hash());
  });
});
