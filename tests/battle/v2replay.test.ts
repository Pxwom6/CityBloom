import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Battle } from '../../src/sim/battle/battle';
import { checkBattleInput } from '../../src/sim/battle/check';
import { TAG, type BattleInput } from '../../src/sim/battle/types';
import { input, lineLayout, TOWN, units } from './handmade';

/**
 * Battles kept from M35–M36 (version 2) play as they did (`docs/plans/M37-design.md`, step 0): a
 * replay kept on a page, or a friend's battle waiting in the region room, must give the same result
 * after battles move on. The inputs are stored as they were made; `GOLDEN=write` rewrites them (only
 * at the M36 tip; then `npx prettier --write` it).
 */
const FILE = 'tests/fixtures/war/battle-v2.json';

function made(): BattleInput[] {
  const bunkers = [0, 1].map((k) => ({
    id: 30 + k,
    tags: TAG.civic | TAG.military | TAG.defence,
    x: 600 + k * 40,
    z: 520,
    r: 6,
    hp: 600,
    gun: 3,
    range: 140,
    against: ['land' as const, 'air' as const],
  }));
  const out: BattleInput[] = [];
  for (const stance of ['bold', 'cautious'] as const) {
    const defenders = [
      ...units('tank', 2, { x: 900, z: 540 }, 0),
      ...units('infantry', 3, { x: 880, z: 520 }, 0),
    ];
    const force = [
      ...units('tank', 3),
      ...units('artillery', 2),
      ...units('infantry', 4),
      ...units('helicopter', 2),
      ...units('fighter', 1),
      ...units('drone', 2),
      ...units('transport', 1),
    ];
    const i = input(lineLayout([...TOWN, ...bunkers], defenders, 1), force, { stance });
    i.id = `v2-${stance}`;
    i.seed = `v2-${stance}`;
    out.push(i);
  }
  return out;
}

describe('battles kept from M35–M36 (version 2)', () => {
  it('play to the same result', () => {
    if (process.env.GOLDEN === 'write') {
      const kept = made().map((i) => ({ input: i, result: Battle.run(structuredClone(i)).result() }));
      writeFileSync(FILE, `${JSON.stringify(kept)}\n`);
    }
    const kept = JSON.parse(readFileSync(FILE, 'utf8')) as {
      input: BattleInput;
      result: ReturnType<Battle['result']>;
    }[];
    expect(kept.length).toBe(2);
    for (const k of kept) {
      expect(k.input.v).toBe(2);
      expect(checkBattleInput(k.input)).toBeNull();
      expect(Battle.run(structuredClone(k.input)).result()).toEqual(k.result);
    }
  });
});
