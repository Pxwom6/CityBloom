import { describe, expect, it } from 'vitest';
import { CIVIC } from '../src/data/civic';
import { CIVIC_BUDGETS } from '../src/models/budgets';
import {
  budgetOf,
  canHaveLook,
  checkCustom,
  CUSTOM,
  externalLinks,
  fitsTarget,
  probeCustom,
  suggestTargets,
  targetLabel,
  targetOfDef,
  targetsFor,
} from '../src/models/customCheck';
import { readBudgets } from '../scripts/lib/modelPipeline';
import { goodModelParts, testModels, writeGlb } from '../scripts/lib/makeGlb';

/**
 * M46: a player's own model is checked as the game's own are (spec v6, the site and budget of what
 * it's for), plus a 1 MB cap and nothing inside it pointing outside. A good model in the game's style
 * passes as a landmark of its size and as the look of a civic building with the same site, and comes
 * back baked; the bad ones are refused, each with its reason in words.
 */
const m = testModels();

describe('M46 checking a player’s model', () => {
  it('passes the good model as a 2×2 landmark and as a new look for the pocket park, baked', () => {
    const asLandmark = checkCustom(m.good, { kind: 'landmark', size: 2 }).result;
    expect(asLandmark.problems).toEqual([]);
    expect(asLandmark.ok).toBe(true);
    expect(asLandmark.baked).not.toBeNull();
    expect(asLandmark.site).toEqual({ w: 16, d: 16 });
    expect(asLandmark.report!.triangles).toBeLessThanOrEqual(budgetOf({ kind: 'landmark', size: 2 }));
    const asLook = checkCustom(m.good, { kind: 'look', def: 'park_small' }).result;
    expect(asLook.ok).toBe(true);
    expect(targetLabel({ kind: 'look', def: 'park_small' })).toBe('a new look for the pocket park');
  });

  it('refuses a file over 1 MB, one too wide for its site, one pointing outside itself, one with textures', () => {
    const big = checkCustom(m.tooBig, { kind: 'landmark', size: 2 }).result;
    expect(m.tooBig.length).toBeGreaterThan(CUSTOM.maxBytes);
    expect(big.ok).toBe(false);
    expect(big.problems.map((p) => p.words).join('\n')).toMatch(/up to 1 MB/);
    const wide = checkCustom(m.tooWide, { kind: 'landmark', size: 2 }).result;
    expect(wide.ok).toBe(false);
    expect(wide.problems.map((p) => p.words).join('\n')).toMatch(/is 19 × 19 m; its site is 16 × 16 m/);
    // Nor any other size: no landmark is 19 m across.
    expect(checkCustom(m.tooWide, { kind: 'landmark', size: 3 }).result.ok).toBe(false);
    // The same pavilion built 24 m across is right for a 3×3 landmark.
    expect(checkCustom(writeGlb(goodModelParts(24)), { kind: 'landmark', size: 3 }).result.ok).toBe(true);
    const out = checkCustom(m.outside, { kind: 'landmark', size: 2 }).result;
    expect(out.ok).toBe(false);
    expect(out.problems[0]!.words).toMatch(/points to files outside itself \("building\.bin"\)/);
    expect(externalLinks(m.good)).toBeNull();
    const tex = checkCustom(m.textured, { kind: 'landmark', size: 2 }).result;
    expect(tex.ok).toBe(false);
    expect(tex.problems.map((p) => p.words).join('\n')).toMatch(/textures/);
  });

  it('refuses what isn’t a model, and a building that can’t take one, in words', () => {
    const junk = checkCustom(new TextEncoder().encode('hello, this is not a model'), {
      kind: 'landmark',
      size: 1,
    }).result;
    expect(junk.ok).toBe(false);
    expect(junk.problems[0]!.words).toMatch(/GLB/);
    expect(checkCustom(m.good, { kind: 'look', def: 'landmark2' }).result.problems[0]!.words).toMatch(
      /can’t take a model/,
    );
  });

  it('keeps the prompts’ budgets in step (scripts/modelBudgets.ts)', () => {
    const all = readBudgets();
    const want = Object.fromEntries(
      [...CIVIC.keys()].filter((id) => all.has(id)).map((id) => [id, all.get(id)]),
    );
    expect(CIVIC_BUDGETS).toEqual(want);
  });

  it('measures a file before it is checked and suggests what it could be', () => {
    expect(probeCustom(m.good)).toEqual({ w: 16, d: 16, h: 12.5 });
    const t = suggestTargets({ w: 16, d: 16 });
    expect(t[0]).toEqual({ kind: 'landmark', size: 2 });
    // Civic buildings on a 16 m square come next (a wind turbine, the pocket park…), never landmarks or projects.
    expect(t.slice(1).every((x) => x.kind === 'look' && canHaveLook(x.def))).toBe(true);
    expect(t.some((x) => x.kind === 'look' && x.def === 'park_small')).toBe(true);
    // A size nothing fits: the nearest landmark, for the check to explain.
    expect(suggestTargets({ w: 19, d: 19 })).toEqual([{ kind: 'landmark', size: 2 }]);
    expect(suggestTargets({ w: 60, d: 60 })).toEqual([{ kind: 'landmark', size: 4 }]);
    // A file pointing outside itself is refused in plain words before anything is parsed.
    const out = probeCustom(m.outside);
    expect('why' in out && out.why).toMatch(/points to files outside itself/);
    expect('why' in probeCustom(new Uint8Array([1, 2, 3, 4]))).toBe(true);
  });

  it('lets a model serve every target it passes for: the same site, within budget, war apart', () => {
    const r = checkCustom(m.good, { kind: 'landmark', size: 2 }).result;
    const good = {
      target: { kind: 'landmark', size: 2 } as const,
      size: { w: 16, d: 16 },
      tris: r.report!.triangles,
    };
    const all = targetsFor(good);
    expect(all[0]).toEqual(good.target);
    expect(all).toContainEqual({ kind: 'look', def: 'park_small' });
    // Each one it's offered for passes that target's own check.
    for (const t of all) expect(checkCustom(m.good, t).result.ok, JSON.stringify(t)).toBe(true);
    // Military buildings of the same size are checked with the war allowances: never offered.
    expect(fitsTarget(good, { kind: 'look', def: 'bunker' })).toBe(false);
    // Over another target's budget, or another size: not offered.
    expect(fitsTarget({ ...good, tris: 1_000 }, { kind: 'look', def: 'park_small' })).toBe(false);
    expect(fitsTarget({ ...good, tris: 1_000 }, { kind: 'landmark', size: 2 })).toBe(true);
    expect(fitsTarget(good, { kind: 'landmark', size: 3 })).toBe(false);
    expect(targetOfDef('landmark3')).toEqual({ kind: 'landmark', size: 3 });
    expect(targetOfDef('park_small')).toEqual({ kind: 'look', def: 'park_small' });
  });
});
