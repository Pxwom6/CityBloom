import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { SAVE_VERSION, migrations } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { partHashes } from '../../src/sim/sync';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { newSim } from '../helpers';

/**
 * M38, save v31: the war economy appears when it is first used, so a v30 war city loads as it was and
 * plays on exactly as it did. The fixture is a war city saved at the M37 tip (v30): a weapons lab
 * with a tier researched and one queued, and a treaty paying tribute after a war.
 *
 * Its war with a neighbour is still open, so from step 6 on it grows weary and its approval (and what
 * hangs on it: demand, the chronicle) moves: the golden below was rewritten once for that, and only
 * those parts and the war's own (the weariness it now keeps) differ.
 */
const V30 = 'tests/fixtures/war/v30-war.citybloom';
/** What that save plays on to: the parts of its state after two months, but the version. `GOLDEN=write` rewrites it. */
const GOLDEN = 'tests/fixtures/war/v30-war.json';
const M = TICKS_PER_MONTH;

/** The v30 war save, loaded and played on two months: its parts but the version. */
function v30Parts(): Record<string, string> {
  const sim = Sim.fromSave(decodeSave(new Uint8Array(readFileSync(V30))));
  sim.advance(2 * M);
  const parts = partHashes(sim);
  delete parts.version;
  return parts;
}

describe('M38: save v31', () => {
  it('has an identity migration from v30', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(31);
    const state = { x: 1 };
    expect(migrations[30]).toBeTypeOf('function');
    expect(migrations[30]!(state)).toBe(state);
  });

  it('a v30 war save (research, a treaty) loads without a war economy and plays on as it did', () => {
    const save = decodeSave(new Uint8Array(readFileSync(V30)));
    expect(save.version).toBe(30);
    const sim = Sim.fromSave(save);
    expect(sim.state.version).toBe(SAVE_VERSION);
    expect(sim.state.war!.economy).toBeUndefined();
    expect(sim.state.war!.research?.done).toEqual(['logistics1']);
    expect(sim.state.war!.diplomacy!.pacts.some((p) => p.term.k === 'tribute')).toBe(true);
    const now = v30Parts();
    if (process.env.GOLDEN === 'write') writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
    expect(now).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
    // Nothing in play makes a stake, a loan, aid, an arms deal or a sanction on its own: the one thing
    // that appears is war weariness (M38 step 6), because this city's war is open and wears on it.
    const again = Sim.fromSave(save);
    again.advance(2 * M);
    const e = again.state.war!.economy!;
    expect({ ...e, weariness: undefined }).toEqual({ stakes: {}, loans: [], aid: {}, weariness: undefined });
    expect(e.weariness).toBeGreaterThan(0);
  });

  it('a save relabelled as v30 loads the same', () => {
    const sim = newSim({ rivals: true, disasters: false });
    sim.advance(M);
    const file = sim.save('2026-10-29') as { version: number };
    file.version = 30;
    const old = Sim.fromSave(file as never);
    expect(old.state.version).toBe(SAVE_VERSION);
    expect(old.hash()).toBe(sim.hash());
  });
});
