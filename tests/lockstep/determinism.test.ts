import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { SCENARIO } from '../../src/data/scenarios';
import { runDeterminism } from './determinism';
import { ALL_KINDS } from './scriptedTown';

/**
 * The cross-browser run's script, in Node (F13): it must issue every kind of command, or the
 * browsers never compare what that kind does. The cross-browser test checks the same, but only where
 * Playwright's browsers run; this keeps a new kind from slipping past the unit tests. Ten months
 * cover the script's every scripted month (the rest only grows the town).
 */
describe('the cross-browser determinism script', () => {
  it('uses every kind of command', () => {
    const id = 'cleanslate';
    const save = decodeSave(new Uint8Array(readFileSync(`public/scenarios/${SCENARIO.get(id)!.save}`)));
    const r = runDeterminism(10, { id, save });
    expect(r.used).toEqual([...ALL_KINDS].sort());
  });
});
