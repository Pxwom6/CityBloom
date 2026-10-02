import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { ZONED_DEFS } from '../src/data/buildings';
import { CIVIC } from '../src/data/civic';
import { IN_FAR, ModelBuilder, NEAR_ONLY, type ModelData } from '../src/render/assets/builder';
import { buildZonedModel } from '../src/render/assets/models';
import { VARIANTS, assets } from '../src/render/assets/registry';

/** M28: the generator's buildings, refreshed, each with far and skyline versions. */
const tris = (m: ModelData) => m.pos.length / 9;
const GREY = new Color('#888888');

describe('generated buildings (M28)', () => {
  it('every zoned building has far and skyline versions, each no heavier than the one before', () => {
    let near = 0;
    let far = 0;
    let sky = 0;
    for (const def of ZONED_DEFS.values())
      for (let v = 0; v < VARIANTS; v++) {
        const m = buildZonedModel(def, def.w, def.d, v);
        expect(m.far, def.id).toBeDefined();
        expect(m.sky, def.id).toBeDefined();
        expect(tris(m.far!)).toBeLessThanOrEqual(tris(m));
        expect(tris(m.sky!)).toBeLessThanOrEqual(tris(m.far!));
        // The same building from further off: as tall, the same windows lit.
        expect(m.far!.height).toBe(m.height);
        expect(m.sky!.shade!.length).toBe(tris(m.sky!));
        near += tris(m);
        far += tris(m.far!);
        sky += tris(m.sky!);
      }
    // Far leaves out the fine detail (most of a generated building is its windows, which stay);
    // the skyline also merges runs of alike windows along a band (about 15 % fewer triangles than
    // far since offices light fewer than half their windows at night, so runs are shorter).
    expect(far).toBeLessThan(near);
    expect(sky).toBeLessThan(far * 0.9);
  });

  it("civic buildings and rubble have distant versions too (the generator's ones)", () => {
    for (const def of CIVIC.values()) {
      const m = assets.civic(def.id, 0, 0, [], undefined);
      expect(m.far, def.id).toBeDefined();
      expect(m.sky, def.id).toBeDefined();
    }
    expect(assets.rubble(2, 2, 0).far).toBeDefined();
  });

  it('a detail block keeps its triangles out of the coarser levels', () => {
    const m = new ModelBuilder();
    m.box(0, 1, 0, 1, 0, 1, GREY);
    m.detail(IN_FAR, () => {
      m.box(2, 3, 0, 1, 0, 1, GREY);
      m.detail(NEAR_ONLY, () => m.box(4, 5, 0, 1, 0, 1, GREY));
    });
    const out = m.build();
    expect([tris(out), tris(out.far!), tris(out.sky!)]).toEqual([30, 20, 10]);
  });

  it('two types on the same lot with the same variant are not the same building', () => {
    // Medium- and high-wealth offices on a 16×24 m lot used to come out identical.
    const a = buildZonedModel(ZONED_DEFS.get('C201')!, 2, 3, 0);
    const b = buildZonedModel(ZONED_DEFS.get('C211')!, 2, 3, 0);
    const same = a.pos.length === b.pos.length && a.pos.every((x, i) => x === b.pos[i]);
    expect(same).toBe(false);
  });

  it('towers come in several silhouettes', () => {
    // The heights of the top and the number of separate blocks vary across the looks.
    const heights = new Set<number>();
    const counts = new Set<number>();
    for (const id of ['R201', 'R212', 'C201', 'C222'])
      for (let v = 0; v < VARIANTS; v++) {
        const def = ZONED_DEFS.get(id)!;
        const m = buildZonedModel(def, 3, 3, v);
        heights.add(Math.round(m.height));
        counts.add(tris(m));
      }
    expect(heights.size).toBeGreaterThan(12);
    expect(counts.size).toBeGreaterThan(30);
  });
});
