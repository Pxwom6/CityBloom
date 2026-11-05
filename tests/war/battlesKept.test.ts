import { describe, expect, it } from 'vitest';
import { KEEP_BATTLES, KEEP_REPLAYS, battlesToDrop, type BattleRecord } from '../../src/client/battles';

/**
 * M39 step 7's review: what a browser keeps of battles. The city's own battles and the region's replays
 * it has watched are counted apart, so watching the region's never pushes the city's own out.
 */
const rec = (id: string, n: number, over: Partial<BattleRecord> = {}): BattleRecord =>
  ({
    id,
    city: 'Faytown',
    other: 'Adaville',
    tick: 0,
    input: {} as never,
    townKey: `replay:${id}`,
    savedAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    ...over,
  }) as BattleRecord;

const own = (n: number) => rec(`def-${n}`, n);
const watched = (n: number, over: Partial<BattleRecord> = {}) =>
  rec(`rep-1-b${n}`, n, { region: { expect: null }, ...over });

describe('which battles a browser lets go', () => {
  it('watching many replays removes none of the city’s own battles', () => {
    const mine = Array.from({ length: KEEP_BATTLES }, (_, k) => own(k));
    // Twenty replays watched (the region lists that many), each the newest when it was made.
    const reps = Array.from({ length: 20 }, (_, k) => watched(100 + k));
    const { records, towns } = battlesToDrop([...mine, ...reps], 'Faytown');
    expect(records.some((r) => r.id.startsWith('def-'))).toBe(false);
    expect(records.filter((r) => r.id.startsWith('rep-'))).toHaveLength(20 - KEEP_REPLAYS);
    // The oldest replays go, with their own copies of the town.
    expect(records.map((r) => r.id)).toEqual(
      reps
        .slice(0, 20 - KEEP_REPLAYS)
        .map((r) => r.id)
        .reverse(),
    );
    expect(towns.sort()).toEqual(records.map((r) => r.townKey!).sort());
  });

  it('keeps the newest of the city’s own battles as before, and the towns only they are shown in', () => {
    const mine = Array.from({ length: KEEP_BATTLES + 3 }, (_, k) => own(k));
    const { records, towns } = battlesToDrop(mine, 'Faytown');
    expect(records.map((r) => r.id).sort()).toEqual(['def-0', 'def-1', 'def-2']);
    expect(towns.sort()).toEqual(['replay:def-0', 'replay:def-1', 'replay:def-2']);
  });

  it('does not touch another city’s battles', () => {
    const other = Array.from({ length: KEEP_BATTLES + 5 }, (_, k) =>
      rec(`def-${k}`, k, { city: 'Elsewhere' }),
    );
    expect(battlesToDrop(other, 'Faytown').records).toEqual([]);
  });

  it('keeps the town a replay of a battle the city fought is shown in: it is the battle’s own copy', () => {
    const fought = own(1);
    // The replay is shown in the town already kept for the battle it fought, not a second copy.
    const reps = Array.from({ length: KEEP_REPLAYS + 1 }, (_, k) =>
      watched(10 + k, { townKey: k === 0 ? fought.townKey : `replay:rep-${k}` }),
    );
    // The oldest replay goes (it is the one in the battle's own town): the town stays for the battle.
    const kept = battlesToDrop([fought, ...reps], 'Faytown');
    expect(kept.records.map((r) => r.id)).toEqual([reps[0]!.id]);
    expect(kept.towns).toEqual([]);
    // And when the battle itself is the one to go, the town stays while a replay still shows it.
    const many = Array.from({ length: KEEP_BATTLES + 1 }, (_, k) => own(k));
    const shown = watched(500, { townKey: many[0]!.townKey });
    const out = battlesToDrop([...many, shown], 'Faytown');
    expect(out.records.map((r) => r.id)).toEqual(['def-0']);
    expect(out.towns).toEqual([]);
  });

  it('leaves alone battles still being sent to the region', () => {
    const waiting = Array.from({ length: KEEP_BATTLES + 4 }, (_, k) =>
      rec(`exp-${k}`, k, { postTo: 2, posted: false }),
    );
    expect(battlesToDrop(waiting, 'Faytown').records).toEqual([]);
  });
});
