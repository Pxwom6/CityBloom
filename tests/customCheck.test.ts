import { describe, expect, it } from 'vitest';
import { CIVIC } from '../src/data/civic';
import { CIVIC_BUDGETS } from '../src/models/budgets';
import { budgetOf, checkCustom, CUSTOM, externalLinks, targetLabel } from '../src/models/customCheck';
import { readBudgets } from '../scripts/lib/modelPipeline';
import { testModels } from '../scripts/lib/makeGlb';

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
    expect(wide.problems.map((p) => p.words).join('\n')).toMatch(/24 × 24|24 m|site/);
    // The same model is right for a 3×3 landmark.
    expect(checkCustom(m.tooWide, { kind: 'landmark', size: 3 }).result.ok).toBe(true);
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
});
