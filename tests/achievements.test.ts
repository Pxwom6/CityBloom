import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/data/achievements';

describe('achievements', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(ACHIEVEMENTS.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every achievement a name and a blurb', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.trim(), a.id).not.toBe('');
      expect(a.blurb.trim(), a.id).not.toBe('');
    }
  });

  it('checks every achievement in progress.ts', () => {
    const source = readFileSync('src/sim/systems/progress.ts', 'utf8');
    for (const a of ACHIEVEMENTS) {
      expect(source, a.id).toMatch(new RegExp(`^\\s*${a.id}: \\(sim\\) =>`, 'm'));
    }
  });
});
