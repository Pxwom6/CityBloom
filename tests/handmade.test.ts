import { readFileSync } from 'node:fs';
import { Color } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { bakeModel, type BakedModel } from '../src/models/bake';
import { inspectModel } from '../src/models/check';
import { decodeModels, encodeModels } from '../src/models/codec';
import { parseBudgets } from '../src/models/spec';
import { SURF_GRASS, type ModelData } from '../src/render/assets/builder';
import { HandmadeModels, buildHandModel, handmade, nearestPalette } from '../src/render/assets/handmade';
import { PALETTES } from '../src/render/assets/models';
import { VARIANTS, annexPlace, assets } from '../src/render/assets/registry';
import { Arrays, appendModel } from '../src/render/modelMerge';

const budgets = parseBudgets(readFileSync('docs/models/PROMPTS.md', 'utf8'));
const bake = (id: string): BakedModel => {
  const { report, file } = inspectModel(
    readFileSync(`tests/fixtures/models/good/${id}.glb`),
    `${id}.glb`,
    budgets,
  );
  return bakeModel(file!, report);
};
// As the game gets them: through the packed file.
const M = Object.fromEntries(
  decodeModels(
    encodeModels(
      ['R103', 'R001', 'R201', 'police', 'coal', 'landfill', 'convention', 'annex-patrolWing'].map(bake),
    ),
  ).map((m) => [m.id, m]),
) as Record<string, BakedModel>;

const tris = (m: ModelData) => m.pos.length / 9;
const opts = (W: number, D: number, seed = 0) => ({
  W,
  D,
  seed,
  lit: 0.58,
  mirror: true,
  base: PALETTES.pave,
});
/** Vertex extents (of what stands above the lot base, if `above`). */
function box(m: ModelData, above = false) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < m.pos.length; i += 3) {
    if (above && m.pos[i + 1]! <= 0.001) continue;
    for (let k = 0; k < 3; k++) {
      b.min[k] = Math.min(b.min[k]!, m.pos[i + k]!);
      b.max[k] = Math.max(b.max[k]!, m.pos[i + k]!);
    }
  }
  return b;
}
/** The colour a copy's front wall is painted: that of the biggest face looking at the road, by x range. */
function wallColour(m: ModelData, x0: number, x1: number): string {
  let best = '';
  let bestArea = 0;
  for (let t = 0; t < m.pos.length; t += 9) {
    const x = (m.pos[t]! + m.pos[t + 3]! + m.pos[t + 6]!) / 3;
    const y = Math.min(m.pos[t + 1]!, m.pos[t + 4]!, m.pos[t + 7]!);
    if (x < x0 || x > x1 || y < 3.5 || m.nrm[t + 2]! > -0.9) continue;
    const ux = m.pos[t + 3]! - m.pos[t]!;
    const uy = m.pos[t + 4]! - m.pos[t + 1]!;
    const vx = m.pos[t + 6]! - m.pos[t]!;
    const vy = m.pos[t + 7]! - m.pos[t + 1]!;
    const area = Math.abs(ux * vy - uy * vx) / 2;
    if (area <= bestArea) continue;
    bestArea = area;
    // The upper corner's colour (the foot of a wall is darkened).
    const top = [0, 3, 6].reduce((a, k) => (m.pos[t + k + 1]! > m.pos[t + a + 1]! ? k : a), 0);
    best = [0, 1, 2].map((c) => m.col[t + top + c]!.toFixed(3)).join(',');
  }
  return best;
}

describe('a hand-made model on a lot', () => {
  it('stands three abreast on a 24 m lot, each copy painted differently', () => {
    const m = buildHandModel(M.R103!, opts(24, 24));
    const b = box(m);
    // Three 8 m copies across the lot (their cornices and window boxes overhang a little).
    expect(b.min[0]).toBeGreaterThan(-12.7);
    expect(b.min[0]).toBeLessThan(-12);
    expect(b.max[0]).toBeGreaterThan(12);
    // 16 m deep on a 24 m lot: at the front, its steps and awning inside the lot, a yard behind.
    const up = box(m, true);
    expect(up.min[2]).toBeCloseTo(-12 + 0.3, 1);
    expect(up.max[2]).toBeLessThan(12 - 5);
    // The lot base covers the whole lot and reaches down to hide a slope.
    expect([b.min[2], b.max[2], b.min[1]]).toEqual([-12, 12, -5]);
    const paint = [wallColour(m, -12, -4), wallColour(m, -4, 4), wallColour(m, 4, 12)];
    expect(paint.every((p) => p !== '')).toBe(true);
    expect(paint[0]).not.toBe(paint[1]);
    expect(paint[1]).not.toBe(paint[2]);
    // Brick stays brick: every copy's walls are from the brick palette.
    const brick = PALETTES.brick.map((c) => [c.r, c.g, c.b].map((v) => v.toFixed(3)).join(','));
    for (const p of paint) expect(brick).toContain(p);
    expect(m.hand).toBe('R103');
    expect(m.height).toBeCloseTo(25.8, 1);
  });

  it('drops the windows a neighbour in the row hides, and keeps the outer ones', () => {
    const one = buildHandModel(M.R103!, opts(8, 16));
    const two = buildHandModel(M.R103!, opts(16, 16));
    const three = buildHandModel(M.R103!, opts(24, 24));
    // Base: 10 triangles. A lone copy keeps both side walls' windows.
    const alone = tris(one) - 10;
    expect(alone).toBe(M.R103!.counts.near);
    // Each join hides one side of each of the two copies that meet.
    const perSide = (2 * alone - (tris(two) - 10)) / 2;
    expect(perSide).toBeGreaterThan(150);
    expect(tris(three) - 10).toBe(3 * alone - 4 * perSide);
    // Two abreast on a 16 m lot, centred: nothing to spare in depth.
    const b = box(two);
    expect(b.min[0]).toBeLessThan(-8);
    expect(b.max[0]).toBeGreaterThan(8);
    // Nothing of a window is left on the shared wall (x = 0), but the outer walls keep theirs.
    const sideGlass = (m: ModelData, at: number) => {
      let n = 0;
      for (let t = 0; t < m.pos.length; t += 9)
        if (m.win![t / 3] && [0, 3, 6].every((k) => Math.abs(Math.abs(m.pos[t + k]!) - at) < 0.3)) n++;
      return n;
    };
    expect(sideGlass(two, 0)).toBe(0);
    expect(sideGlass(two, 8.16)).toBeGreaterThan(50);
  });

  it('mirrors copies without turning them inside out', () => {
    let mirrored = 0;
    for (let seed = 0; seed < VARIANTS; seed++) {
      const m = buildHandModel(M.R103!, opts(8, 16, seed));
      // The door is left of centre as drawn; mirrored, right of it.
      let doorX = 0;
      let n = 0;
      const door = new Color(...M.R103!.colors[7]!);
      for (let t = 0; t < m.pos.length; t += 9)
        if (Math.abs(m.col[t]! / 0.78 - door.r) < 0.12 && m.pos[t + 1]! < 3.2 && m.nrm[t + 2]! < -0.9) {
          doorX += m.pos[t]!;
          n++;
        }
      if (n && doorX / n > 0) mirrored++;
      // Roof tops still look up, and the front wall still looks at the road.
      for (let t = 0; t < m.pos.length; t += 9) {
        const flat = Math.abs(m.nrm[t + 1]!) > 0.99;
        if (flat && m.pos[t + 1]! > 18.8 && m.pos[t + 1]! < 19 && Math.abs(m.pos[t]!) < 3)
          expect(m.nrm[t + 1]!).toBeGreaterThan(0);
      }
    }
    expect(mirrored).toBeGreaterThan(1);
    expect(mirrored).toBeLessThan(VARIANTS - 1);
  });

  it('has a far and a skyline version in the same paint', () => {
    const m = buildHandModel(M.R201!, opts(16, 24, 3));
    expect(m.far && m.sky).toBeTruthy();
    expect(tris(m.far!)).toBeLessThan(tris(m) * 0.65);
    expect(tris(m.sky!)).toBeLessThan(tris(m.far!));
    expect(m.far!.height).toBe(m.height);
    const colours = (x: ModelData) => {
      const s = new Set<string>();
      for (let i = 0; i < x.pos.length; i += 3)
        if (x.pos[i + 1]! > 3.2 && x.emi[i / 3] === 0 && !x.win![i / 3])
          s.add([0, 1, 2].map((c) => x.col[i + c]!.toFixed(3)).join(','));
      return s;
    };
    const near = colours(m);
    for (const c of colours(m.far!)) expect(near.has(c)).toBe(true);
    for (const c of colours(m.sky!)) expect(near.has(c)).toBe(true);
    // The skyline version needs no plinth sides: far away nothing is seen under a lot.
    expect(box(m.far!).min[1]).toBe(-5);
    expect(box(m.sky!).min[1]).toBeGreaterThanOrEqual(0);
    // Every window is in every version, under the same number.
    expect(new Set(m.sky!.win).size).toBe(new Set(m.win).size);
  });

  it('each copy of a building lights its own windows, the same ones every time', () => {
    const m = buildHandModel(M.R103!, opts(24, 24));
    // 64 windows and a shopfront in each of three copies.
    expect(m.winChance).toHaveLength(65 * 3);
    expect([...m.winChance!].filter((c) => Math.abs(c - 0.9) < 1e-6)).toHaveLength(3);
    const lit = (seed: number, look: boolean | number = false) => {
      const out = new Arrays(false);
      appendModel(out, m, 0, 0, 0, 0, look, undefined, seed);
      const on = new Set<number>();
      for (let i = 0; i < out.n; i++) if (m.win![i] && out.emi[i]! > 0) on.add(m.win![i]!);
      return on;
    };
    const a = lit(101);
    const b = lit(102);
    expect([...lit(101)]).toEqual([...a]);
    expect([...a]).not.toEqual([...b]);
    // About 58 % of the windows that are there (those on the row's party walls aren't).
    const there = new Set([...m.win!].filter((w) => w > 0)).size;
    expect(there).toBe(195 - 4 * 17);
    for (const s of [a, b]) {
      expect(s.size).toBeGreaterThan(there * 0.42);
      expect(s.size).toBeLessThan(there * 0.74);
    }
    // Lit panes glow at 0.6 to 1; an abandoned building is dark.
    expect(lit(101, true).size).toBe(0);
    expect(lit(101, 0.8).size).toBe(0);
  });

  it('plants the game trees where the model marks them, wherever the copy stands', () => {
    const plain = buildHandModel(M.R001!, { ...opts(8, 16), mirror: false });
    expect(plain.trees).toHaveLength(3);
    const [x, y, z] = plain.trees!;
    expect(Math.abs(x!)).toBeLessThan(4);
    expect(y).toBeCloseTo(0.05, 1);
    expect(z!).toBeGreaterThan(4);
    // On a deeper lot the cottage is at the front: its tree moves with it.
    const deep = buildHandModel(M.R001!, { ...opts(8, 24), mirror: false });
    expect(deep.trees![2]).toBeCloseTo(z! - 4, 5);
    // The lot's own grass shows behind it, tagged to follow the seasons.
    const lawn = buildHandModel(M.R001!, { ...opts(8, 24), base: PALETTES.grass, mirror: false });
    expect(lawn.emi[0]).toBe(SURF_GRASS);
    // Mirrored copies carry their trees across.
    const xs = new Set<string>();
    for (let seed = 0; seed < VARIANTS; seed++)
      xs.add(buildHandModel(M.R001!, opts(8, 16, seed)).trees![0]!.toFixed(2));
    expect([...xs].sort()).toEqual([(-x!).toFixed(2), x!.toFixed(2)].sort());
  });
});

describe('palettes', () => {
  it('repaints from the palette nearest the model colour, and leaves its own colours alone', () => {
    expect(nearestPalette('wall', new Color('#a85a44'))).toBe(PALETTES.brick);
    expect(nearestPalette('wall', new Color('#f3e3c3'))).toBe(PALETTES.wallsR);
    expect(nearestPalette('wall', new Color('#ffffff'))).toBe(PALETTES.wallsRich);
    expect(nearestPalette('wall_alt', new Color('#c9c4ba'))).toBe(PALETTES.wallsI);
    expect(nearestPalette('roof', new Color('#5b6470'))).toBe(PALETTES.roofs);
    expect(nearestPalette('awning', new Color('#d9534f'))).toBe(PALETTES.awnings);
    expect(nearestPalette('sign', new Color('#ffcf3f'))).toBe(PALETTES.signs);
    // A fire-engine red wall isn't in any wall palette: it stays as drawn.
    expect(nearestPalette('wall', new Color('#d01010'))).toBeNull();
    // Roles the game doesn't repaint have no palette.
    expect(nearestPalette('trim', new Color('#fbf8f1'))).toBeNull();
  });
});

describe('which buildings wear a hand-made model', () => {
  it('a design fits a lot as wide as it, twice or three times as wide, and no shallower', () => {
    const t = M.R103!;
    expect(HandmadeModels.fits(t, 8, 16)).toBe(true);
    expect(HandmadeModels.fits(t, 16, 16)).toBe(true);
    expect(HandmadeModels.fits(t, 24, 24)).toBe(true);
    expect(HandmadeModels.fits(t, 32, 32)).toBe(false);
    expect(HandmadeModels.fits(t, 12, 16)).toBe(false);
    expect(HandmadeModels.fits(t, 8, 8)).toBe(false);
    expect(HandmadeModels.fits(M.R201!, 16, 24)).toBe(true);
    expect(HandmadeModels.fits(M.R201!, 16, 16)).toBe(false);
    expect(HandmadeModels.fits(M.R201!, 24, 24)).toBe(false);
  });

  it('mixes designs with the generator while a type has fewer than three', () => {
    const h = new HandmadeModels();
    const looks = (n: number) => {
      h.set(Array.from({ length: n }, (_, i) => ({ ...M.R103!, design: i + 1, id: `R103-${i + 1}` })));
      return Array.from({ length: VARIANTS }, (_, look) => h.zoned('R103', 24, 24, look)?.design ?? 0);
    };
    expect(looks(1)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(looks(2)).toEqual([1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
    expect(looks(3)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(looks(4).every((d) => d > 0)).toBe(true);
    // A lot no design fits is generated.
    expect(h.zoned('R103', 8, 8, 0)).toBeNull();
    expect(h.zoned('R102', 24, 24, 0)).toBeNull();
  });
});

describe('the asset registry with hand-made models', () => {
  beforeAll(() => handmade.set(Object.values(M)));

  it('gives zoned buildings hand-made and generated looks, never the same model twice for one key', () => {
    const hand = assets.zoned('R103', 3, 3, 0);
    expect(hand.hand).toBe('R103');
    expect(hand.far && hand.sky && hand.win).toBeTruthy();
    expect(assets.zoned('R103', 3, 3, 0)).toBe(hand);
    const gen = assets.zoned('R103', 3, 3, 1);
    expect(gen.hand).toBeUndefined();
    expect(gen.far).toBeUndefined();
    // A type with no model, or a lot its model doesn't fit: generated.
    expect(assets.zoned('R102', 2, 3, 0).hand).toBeUndefined();
    expect(assets.zoned('R201', 2, 2, 0).hand).toBeUndefined();
    expect(assets.zoned('R201', 2, 3, 0).hand).toBe('R201');
    // Two hand-made looks of one type differ in paint.
    expect(assets.zoned('R103', 3, 3, 2).col).not.toEqual(hand.col);
  });

  it("raises the landfill's mound as it fills", () => {
    const top = (fill: number) => {
      const m = assets.civic('landfill', 0, fill);
      let y = 0;
      // The heap is in the middle of the site; its buildings are along the front.
      for (let i = 0; i < m.pos.length; i += 3)
        if (m.pos[i + 2]! > -8 && Math.abs(m.pos[i]!) < 16) y = Math.max(y, m.pos[i + 1]!);
      return y;
    };
    expect(top(0)).toBeLessThan(2);
    expect(top(0.5)).toBeGreaterThan(5);
    expect(top(0.5)).toBeLessThan(9);
    expect(top(1)).toBeGreaterThan(12.5);
    expect(assets.civic('landfill', 0, 1).hand).toBe('landfill');
  });

  it('sends smoke from the tops of the smoke stacks', () => {
    const m = assets.civic('coal', 0);
    expect(m.stacks).toHaveLength(6);
    expect(m.stacks![1]).toBeGreaterThan(48);
    // A civic site isn't mirrored: the stacks stay at the back right, as the prompt puts them.
    for (const v of [0, 1, 2, 3]) {
      const s = assets.civic('coal', v).stacks!;
      expect(s[0]).toBeGreaterThan(5);
      expect(s[2]).toBeGreaterThan(5);
    }
  });

  it('raises a big project stage by stage inside its hoarding, and finishes it whole', () => {
    const done = assets.civic('convention', 0);
    const h = M.convention!.h;
    expect(done.hand).toBe('convention');
    expect(done.height).toBeCloseTo(h, 1);
    expect(done.trees!.length).toBeGreaterThan(0);
    // Model triangles (not the cranes'): tallest point of anything in a role colour below the cut.
    const raised = [0, 1, 2].map((stage) => assets.civic('convention', 0, 0, [], stage));
    for (const [stage, m] of raised.entries()) {
      // Cranes stand over the site.
      expect(m.height).toBeGreaterThan(30);
      expect(tris(m)).toBeLessThan(tris(done) + 400);
      // Nothing lit, no smoke; trees only once the grounds are laid.
      expect(m.win!.every((w) => w === 0)).toBe(true);
      expect(m.stacks).toHaveLength(0);
      expect(m.trees!.length > 0).toBe(stage === 2);
      expect(m.far && m.sky).toBeTruthy();
    }
    // More of the building each stage.
    const built = (m: ModelData) => {
      let n = 0;
      for (let i = 1; i < m.pos.length; i += 3)
        if (m.pos[i]! > 3 && m.pos[i]! <= h * 0.78 && Math.abs(m.pos[i - 1]!) < 40) n++;
      return n;
    };
    expect(built(raised[0]!)).toBeLessThan(built(raised[1]!));
    expect(built(raised[1]!)).toBeLessThan(built(raised[2]!));
  });

  it('sets add-on annexes into the back corners of a site', () => {
    const bare = assets.civic('police', 0);
    const wing = assets.civic('police', 0, 0, ['patrolWing']);
    const extra = tris(wing) - tris(bare);
    expect(extra).toBe(M['annex-patrolWing']!.counts.near);
    // The first annex stands in the back right corner, its 9 × 8 m whole on a 24 m site.
    const p = annexPlace(24, 24, 0);
    expect(p).toEqual({ x: 12 - 1 - 4, z: 12 - 1 - 4, scale: 8 / 9 });
    // A second goes in the other corner; on a small site they shrink.
    expect(annexPlace(24, 24, 1).x).toBeLessThan(0);
    expect(annexPlace(14, 14, 0).scale).toBeCloseTo(14 / 3 / 9, 5);
    // The third and fourth stand beside the first two, not on top of them.
    expect(annexPlace(48, 48, 2).x).toBeLessThan(annexPlace(48, 48, 0).x - 9);
    // Its windows are lit with the building's.
    expect(wing.winChance!.length).toBeGreaterThan(bare.winChance!.length);
    // A module with no model of its own gets the generated wing.
    const generated = assets.civic('police', 0, 0, ['nosuch']);
    expect(tris(generated)).toBeGreaterThan(tris(bare));
  });
});
