import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Cities made here carry the M36 tip's save version (29), so their hashes, which include it, can be
// compared with that tip's: the version is the one thing a later milestone may move.
vi.mock('../../src/sim/save', async (original) => ({
  ...(await original<typeof import('../../src/sim/save')>()),
  SAVE_VERSION: 29,
}));
import { decodeSave } from '../../src/client/saves';
import { SCENARIO } from '../../src/data/scenarios';
import { runDeterminism } from '../lockstep/determinism';
import { Sim } from '../../src/sim/sim';
import { partHashes } from '../../src/sim/sync';
import { TICKS_PER_MONTH } from '../../src/sim/time';

/**
 * M37 must leave M34–M36 as they were (`docs/plans/M37-design.md`, step 0): the cross-browser
 * script's war town, its battles and its diplomacy, as they stood at the M36 tip. New commands go in
 * a section of the script with its own city, so these never move. `GOLDEN=write` rewrites the file
 * (only at a milestone that means to change them, with a DECISIONS entry; then `npx prettier --write` it).
 */
const FILE = 'tests/fixtures/war/m36-war.json';
/** A war city saved at the M36 tip (v29): forces, a war fought and a treaty paying tribute. */
const V29 = 'tests/fixtures/war/v29-war.citybloom';

/** The v29 war save, loaded and played on two months: its parts but the version. */
function v29Parts(): Record<string, string> {
  const sim = Sim.fromSave(decodeSave(new Uint8Array(readFileSync(V29))));
  sim.advance(2 * TICKS_PER_MONTH);
  const parts = partHashes(sim);
  delete parts.version;
  return parts;
}

describe('M34–M36 war play is unchanged', () => {
  it('the scripted war town, its battles and its diplomacy match the M36 tip', () => {
    const id = 'cleanslate';
    const save = decodeSave(new Uint8Array(readFileSync(`public/scenarios/${SCENARIO.get(id)!.save}`)));
    const r = runDeterminism(10, { id, save });
    const now = {
      months: r.months,
      population: r.population,
      war: r.war,
      battle: r.battle,
      diplomacy: r.diplomacy,
      v29: v29Parts(),
    };
    if (process.env.GOLDEN === 'write') writeFileSync(FILE, `${JSON.stringify(now, null, 1)}\n`);
    const golden = JSON.parse(readFileSync(FILE, 'utf8')) as typeof now;
    expect(now.months).toEqual(golden.months);
    expect(now.population).toBe(golden.population);
    expect(now.war).toEqual(golden.war);
    expect(now.battle).toEqual(golden.battle);
    expect(now.diplomacy).toBe(golden.diplomacy);
    // A v29 war save loads and plays on as it did (a newer save version only moves `version`).
    expect(now.v29).toEqual(golden.v29);
  });
});
