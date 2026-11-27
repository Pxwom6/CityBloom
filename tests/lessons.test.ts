/** Learn's lessons (M42): every lesson's town opens as a current save and its steps are short and named. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { LESSONS } from '../src/client/lessons';
import { decodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { SAVE_VERSION } from '../src/sim/save';
import { TICKS_PER_HOUR } from '../src/sim/time';

describe('Learn', () => {
  it('covers what the brief asks, war marked opt-in and making buildings with the Workshop (M47)', () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      'traffic',
      'money',
      'services',
      'disasters',
      'districts',
      'friends',
      'war',
      'buildings',
    ]);
    expect(LESSONS.find((l) => l.id === 'war')!.optIn).toBeTruthy();
    // Ready since M47: the Workshop's lesson, on a town of its own.
    expect(LESSONS.find((l) => l.id === 'buildings')!).toMatchObject({ save: 'buildings.citybloom' });
    expect(LESSONS.every((l) => !l.soon)).toBe(true);
    for (const l of LESSONS) expect(l.minutes).toBeGreaterThanOrEqual(2);
  });

  it('gives every ready lesson a town that opens, short steps and a last card', () => {
    for (const l of LESSONS.filter((x) => !x.soon)) {
      const ids = l.steps.map((s) => s.id);
      expect(new Set(ids).size, l.id).toBe(ids.length);
      expect(ids.at(-1)).toBe('lessonDone');
      for (const s of l.steps)
        for (const x of s.text.split(/(?<=[.!?:])\s+/))
          expect(x.split(/\s+/).length, `${l.id}/${s.id}: ${x}`).toBeLessThanOrEqual(25);
      const file = `public/lessons/${l.save}`;
      expect(existsSync(file), file).toBe(true);
      const save = decodeSave(readFileSync(file));
      expect(save.version).toBe(SAVE_VERSION);
      const sim = Sim.fromSave(save);
      expect(sim.state.totals.population, l.id).toBeGreaterThan(100);
      sim.testMode = true;
      sim.advance(TICKS_PER_HOUR);
    }
  });
});
