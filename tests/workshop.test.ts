import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CIVIC_DEFS } from '../src/data/civic';
import { EXACT } from '../src/models/check';
import { CUSTOM, DEFAULT_NAME, budgetOf, canHaveLook, checkCustom } from '../src/models/customCheck';
import { CIVIC_HEIGHTS } from '../src/models/heights';
import { ROLE_WORDS, playerSpec, playerSpecMarkdown, withPlayerSpec } from '../src/models/playerSpec';
import { SPEC_V6 } from '../src/models/specText';
import {
  PLAYER_ROLES,
  buildingPrompt,
  cleanIdea,
  teacherNotes,
  workshopPrompt,
  workshopTarget,
  workshopTargets,
} from '../src/models/workshop';
import { mistakeModels, testModels } from '../scripts/lib/makeGlb';

/**
 * M47, the Workshop's data: the prompt it writes for a player's building (the owner's spec word for
 * word, the site, the budget, the roles), a teacher's note for each common mistake (each tested with a
 * model that makes it), and the plain-words spec generated from the check's own numbers.
 */
describe('M47 the Workshop', () => {
  it('hands players the owner’s spec word for word, as the prompt files carry it', () => {
    const block = (file: string) => {
      const md = readFileSync(file, 'utf8');
      const a = md.indexOf('```text\nCitybloom model spec (v6).') + '```text\n'.length;
      return md.slice(a, md.indexOf('```', a)).trimEnd();
    };
    expect(block('docs/models/PROMPTS-5.md')).toBe(SPEC_V6);
    expect(block('docs/models/PROMPTS-WAR.md')).toBe(SPEC_V6);
  });

  it('offers the four landmarks and every building that takes a look, each with its site, budget and height', () => {
    const all = workshopTargets();
    expect(all.slice(0, 4).map((t) => t.id)).toEqual(['landmark1', 'landmark2', 'landmark3', 'landmark4']);
    const looks = CIVIC_DEFS.filter((d) => canHaveLook(d.id) && !d.military).map((d) => d.id);
    expect(
      all
        .slice(4)
        .map((t) => t.id)
        .sort(),
    ).toEqual([...looks].sort());
    for (const t of all) {
      expect(t.budget).toBe(budgetOf(t.target));
      expect(t.height[0]).toBeLessThan(t.height[1]);
      if (t.target.kind === 'look') expect(CIVIC_HEIGHTS[t.id], `${t.id} has a height`).toBeGreaterThan(0);
    }
    expect(workshopTarget({ kind: 'landmark', size: 2 })).toMatchObject({
      site: { w: 16, d: 16 },
      budget: 1500,
      file: 'landmark2.glb',
    });
  });

  it('writes the whole prompt: the spec, the site, the budget, the file name and the roles', () => {
    const t = workshopTarget({ kind: 'landmark', size: 2 });
    const p = workshopPrompt(t, 'A round bandstand with a striped roof', 'Bandstand');
    expect(p.startsWith(SPEC_V6)).toBe(true);
    expect(p).toContain(
      'Citybloom model, following the model spec (v6) and style reference: Bandstand. Save as landmark2.glb.',
    );
    expect(p).toContain(
      'Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z.',
    );
    expect(p).toContain('Budget 1,500 triangles.');
    expect(p).toContain('A round bandstand with a striped roof');
    for (const r of PLAYER_ROLES) expect(p).toContain(r);
    expect(p).not.toContain('light,');
    // A building's look takes its own site and budget, and a starter description when none is given.
    const fire = workshopTarget({ kind: 'look', def: 'firestation' });
    expect(buildingPrompt(fire)).toContain(`Site ${fire.site.w} x ${fire.site.d} m`);
    expect(buildingPrompt(fire)).toContain('fire station');
    // What a player types is one plain paragraph.
    expect(cleanIdea('a `tower`\n\twith\u0000 bells')).toBe('a tower with bells');
    expect(cleanIdea('x'.repeat(900))).toHaveLength(600);
  });

  it('gives each common mistake its own plain-words fix', () => {
    const want = {
      centimetres: 'scale',
      backwards: 'backwards',
      floating: 'floating',
      triangles: 'triangles',
      unnamed: 'unnamed',
      colours: 'colours',
    } as const;
    for (const [name, bytes] of Object.entries(mistakeModels())) {
      const r = checkCustom(bytes, { kind: 'landmark', size: 2 }).result;
      expect(r.ok, name).toBe(false);
      const notes = teacherNotes(r.problems, r.site);
      expect(
        notes.map((n) => n.kind),
        name,
      ).toEqual([want[name as keyof typeof want]]);
      for (const n of notes) {
        expect(n.why.length, `${name}: why`).toBeGreaterThan(20);
        expect(n.fix.length, `${name}: fix`).toBeGreaterThan(0);
      }
    }
    // The good model passes, and the other refusals have notes of their own too.
    expect(checkCustom(testModels().good, { kind: 'landmark', size: 2 }).result.ok).toBe(true);
    const kinds = (b: Uint8Array) => {
      const r = checkCustom(b, { kind: 'landmark', size: 2 }).result;
      return teacherNotes(r.problems, r.site).map((n) => n.kind);
    };
    const m = testModels();
    expect(kinds(m.tooWide)).toContain('size');
    expect(kinds(m.outside)).toContain('links');
    expect(kinds(m.textured)).toContain('textures');
    expect(kinds(m.tooBig)).toContain('file');
    expect(DEFAULT_NAME.test('Cube.001')).toBe(true);
    expect(DEFAULT_NAME.test('door')).toBe(false);
  });

  it('keeps the plain-words spec to the check’s own numbers, and the guide to the spec', () => {
    const md = playerSpecMarkdown();
    expect(md).toContain(`within ${Math.round(EXACT * 100)} cm`);
    expect(md).toContain(`At most ${CUSTOM.maxBytes / 1_048_576} MB`);
    for (const [i, b] of CUSTOM.landmarkBudgets.entries())
      expect(md).toContain(
        `${i + 1}×${i + 1}: ${(i + 1) * 8} × ${(i + 1) * 8} m, ${b.toLocaleString('en-US')} triangles`,
      );
    for (const r of PLAYER_ROLES) {
      expect(ROLE_WORDS[r as keyof typeof ROLE_WORDS], r).toBeTruthy();
      expect(md).toContain(`**${r}**`);
    }
    expect(playerSpec().length).toBeGreaterThanOrEqual(6);
    const guide = readFileSync('docs/making-buildings.md', 'utf8');
    expect(withPlayerSpec(guide), 'run npx tsx scripts/docs/modelSpec.ts').toBe(guide);
  });
});
