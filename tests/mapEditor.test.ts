import { describe, expect, it } from 'vitest';
import type { MapBrush } from '../src/data/mapEditor';
import { GRID_CELL, GRID_RES, MAP_SIZE, SHORE_HEIGHT } from '../src/data/world';
import { decodeMapFile, encodeMapFile } from '../src/client/maps';
import type { Command } from '../src/sim/commands';
import type { SaveFile } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { mapFromGenerator, type MapCheck, type MapData } from '../src/sim/terrain/customMap';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { resourceRichness } from '../src/sim/world/civic';
import { buildTown, serveTown } from './helpers';

let stroke = 1;
/** A drag of the brush along `pts`, applied `passes` times, as one undo step. */
function drag(
  sim: Sim,
  brush: MapBrush,
  pts: [number, number][],
  radius: number,
  passes = 1,
  level?: number,
) {
  const s = stroke++;
  for (let k = 0; k < passes; k++)
    for (let n = 0; n < pts.length; n++) {
      const seg = n === 0 ? [pts[0]!] : [pts[n - 1]!, pts[n]!];
      const cmd: Command = {
        type: 'editMap',
        brush,
        points: seg.map(([x, z]) => ({ x, z })),
        radius,
        stroke: s,
        ...(level !== undefined ? { level } : {}),
      };
      const r = sim.dispatch(cmd);
      if (!r.ok && r.reason !== 'Nothing to change here') throw new Error(r.reason);
    }
}

function editor(): Sim {
  const sim = Sim.create({ editor: true }, mapFromGenerator('blank', 'lakes', 'Riverbend', true));
  sim.testMode = true;
  return sim;
}

/** Everything a player could do in the editor to make a map: a river, a bay, hills, woods, ore, oil. */
function makeMap(sim: Sim): void {
  // A river from north to south, east of the start.
  const river: [number, number][] = [];
  for (let z = 0; z <= MAP_SIZE; z += 128) river.push([1150 + 90 * Math.sin(z / 300), z]);
  drag(sim, 'water', river, 48, 3);
  // A sea bay in the south-east corner, and a lake to the north.
  drag(
    sim,
    'sea',
    [
      [1900, 1700],
      [2040, 1500],
      [2040, 2040],
      [1700, 2040],
    ],
    180,
    3,
  );
  drag(sim, 'water', [[700, 300]], 110, 3);
  // Hills in the north-east, smoothed.
  drag(
    sim,
    'raise',
    [
      [1600, 400],
      [1800, 600],
    ],
    200,
    12,
  );
  drag(sim, 'smooth', [[1700, 500]], 220, 2);
  // Woods, ore under the hills and oil by the bay.
  drag(
    sim,
    'forest',
    [
      [400, 1500],
      [800, 1800],
    ],
    160,
    3,
  );
  drag(sim, 'forest', [[1500, 900]], 120, 2);
  drag(sim, 'ore', [[1650, 500]], 120, 2);
  drag(sim, 'oil', [[1500, 1600]], 100, 2);
  expect(sim.dispatch({ type: 'setMapEntry', entry: 'highway', z: 900 }).ok).toBe(true);
  expect(sim.dispatch({ type: 'setMapEntry', entry: 'rail', z: 1350 }).ok).toBe(true);
  expect(sim.dispatch({ type: 'setMapInfo', name: 'Riverbend', climate: 'temperate' }).ok).toBe(true);
}

describe('map editor (M24)', () => {
  it('is a paused map with no roads: only the editor’s own commands go', () => {
    const sim = editor();
    expect(sim.state.net.nodes.size).toBe(0);
    expect(sim.state.region.neighbours).toHaveLength(0);
    expect(
      sim.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: 100, z: 100 },
          { x: 300, z: 100 },
        ],
      }),
    ).toMatchObject({ ok: false, reason: 'Not in the map editor' });
    sim.advance(100);
    expect(sim.tick).toBe(0);
    // And a city refuses the editor's brushes.
    const city = Sim.create({ seed: 'x' });
    expect(
      city.dispatch({ type: 'editMap', brush: 'raise', points: [{ x: 500, z: 500 }], radius: 64 }),
    ).toMatchObject({
      ok: false,
      reason: 'Only in the map editor',
    });
  });

  it('brushes shape the ground, water, woods and resources, each drag one undo step', () => {
    const sim = editor();
    const h0 = sim.terrain.heightAt(1000, 1000);
    const before = sim.hash();
    drag(
      sim,
      'water',
      [
        [900, 1000],
        [1100, 1000],
      ],
      48,
      3,
    );
    expect(sim.terrain.heightAt(1000, 1000)).toBeLessThan(SHORE_HEIGHT);
    expect(sim.history.undo).toHaveLength(1);
    expect(sim.history.undo[0]!.label).toBe('river and lake');
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.hash()).toBe(before);
    expect(sim.terrain.heightAt(1000, 1000)).toBe(h0);
    drag(sim, 'ore', [[600, 600]], 80, 2);
    const k = Math.floor(600 / GRID_CELL) * GRID_RES + Math.floor(600 / GRID_CELL);
    expect(sim.state.map!.ore[k]).toBeGreaterThan(150);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.map!.ore[k]).toBe(0);
    drag(sim, 'forest', [[600, 600]], 80, 2);
    expect(sim.state.trees[k]).toBeGreaterThan(150);
    drag(sim, 'level', [[1500, 1500]], 80, 4, 20);
    expect(sim.terrain.heightAt(1500, 1500)).toBeCloseTo(20, 1);
    // Entries keep apart and away from the corners.
    expect(
      sim.dispatch({ type: 'setMapEntry', entry: 'rail', z: sim.state.map!.highwayZ + 50 }),
    ).toMatchObject({
      ok: false,
    });
    expect(sim.dispatch({ type: 'setMapEntry', entry: 'highway', z: 20 })).toMatchObject({
      ok: true,
      info: { z: 200 },
    });
  });

  it('a map made in the editor saves, reloads and grows a city', () => {
    const sim = editor();
    makeMap(sim);
    const out = sim.query({ type: 'exportMap' }) as { map: MapData; check: MapCheck };
    console.log(
      `[mapEditor] Riverbend: ${out.check.startArea} ha buildable at the start, ${Math.round(out.check.water * 100)} % water, ${Math.round(out.check.forest * 100)} % forest, ore ${out.check.ore} cells, oil ${out.check.oil}; ${out.check.problems.length} problems, warnings: ${out.check.warnings.map((w) => w.text).join(' | ') || 'none'}`,
    );
    expect(out.check.ok).toBe(true);
    expect(out.check.water).toBeGreaterThan(0.05);
    expect(out.check.ore).toBeGreaterThan(20);
    expect(out.check.oil).toBeGreaterThan(20);
    // Saved as a file, and read back.
    const bytes = encodeMapFile(out.map);
    console.log(`[mapEditor] map file: ${Math.round(bytes.byteLength / 1024)} KB`);
    expect(bytes.byteLength).toBeLessThan(400_000);
    const map = decodeMapFile(bytes);
    expect(map.name).toBe('Riverbend');
    expect([...map.heights]).toEqual([...out.map.heights]);
    expect(() => decodeMapFile(new TextEncoder().encode('{"format":"citybloom-save"}'))).toThrow(
      /not a Citybloom map/,
    );

    // A city on it.
    const city = Sim.create({ cityName: 'Riverbend' }, map);
    city.testMode = true;
    const hw = city.state.net.nodes.get(city.state.highway.connect)!;
    expect(hw.z).toBe(900);
    expect(city.state.railway).not.toBeNull();
    expect(city.state.net.nodes.get(city.state.railway!.connect)!.z).toBe(1350);
    expect(city.terrain.isWater(1150 + 90 * Math.sin(1000 / 300), 1000)).toBe(true);
    expect(city.terrain.isWater(1950, 1950)).toBe(true);
    expect(city.terrain.heightAt(1700, 500)).toBeGreaterThan(city.terrain.heightAt(400, 900) + 15);
    expect(resourceRichness(city, 'ore', { x: 1650, z: 500, hw: 20, hd: 20, angle: 0 })).toBeGreaterThan(0.5);
    expect(
      city.state.trees[Math.floor(1650 / GRID_CELL) * GRID_RES + Math.floor(600 / GRID_CELL)],
    ).toBeGreaterThan(100);
    buildTown(city);
    serveTown(city);
    city.advance(TICKS_PER_MONTH * 3);
    console.log(`[mapEditor] Riverbend after three months: ${city.state.totals.population} residents`);
    expect(city.state.totals.population).toBeGreaterThan(300);
    // The city's save carries the map; it loads and carries on exactly.
    const back = Sim.fromSave(JSON.parse(JSON.stringify(city.save())) as SaveFile);
    expect(back.state.map?.name).toBe('Riverbend');
    expect(back.hash()).toBe(city.hash());
    back.advance(TICKS_PER_MONTH);
    city.advance(TICKS_PER_MONTH);
    expect(back.hash()).toBe(city.hash());
  });

  it('refuses to call an unplayable map playable, and says why', () => {
    const sim = editor();
    const hz = sim.state.map!.highwayZ;
    // Drown the start.
    drag(
      sim,
      'sea',
      [
        [0, hz],
        [400, hz],
      ],
      256,
      4,
    );
    const out = sim.query({ type: 'exportMap' }) as { check: MapCheck };
    expect(out.check.ok).toBe(false);
    expect(out.check.problems.map((p) => p.text).join(' ')).toMatch(/under water|buildable land/);
  });
});
