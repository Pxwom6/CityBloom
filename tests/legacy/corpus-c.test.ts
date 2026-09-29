import { describe, expect, it } from 'vitest';
import { CORPUS, playLegacy, suddenDrops } from './harness';

// A quarter of the legacy corpus (the four files run side by side); see harness.ts.
const PART = CORPUS.filter((_, k) => k % 4 === 2);

describe('legacy saves (Phase 2 review), part 3 of 4', () => {
  for (const file of PART)
    it(
      `${file} loads whole and plays two years`,
      { timeout: file.includes('no-rail') ? 900_000 : 300_000 },
      () => {
        const p = playLegacy(file);
        const first = p.months[0]!;
        const last = p.months[p.months.length - 1]!;
        console.log(
          `[legacy] ${file.split('/').pop()} v${p.version}: ${first.population} → ${last.population} residents, approval ${Math.round(first.approval * 100)} → ${Math.round(last.approval * 100)} %, $${Math.round(first.treasury)} → $${Math.round(last.treasury)}`,
        );
        expect(suddenDrops(p.months), file).toEqual([]);
        // Still a town two years on.
        expect(last.population).toBeGreaterThan(first.population * 0.6);
      },
    );
});
