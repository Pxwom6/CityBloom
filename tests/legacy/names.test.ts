import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { STREET_SUFFIX } from '../../src/data/streetNames';
import { SAVE_VERSION, migrations, readSaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { checkInvariants } from '../../src/sim/invariants';
import { CORPUS } from './harness';

/**
 * P10: street names are saved from v24. A city saved before that is given, for every road, the
 * name the client used to work out for it (a hash of the lowest segment id in the street), so
 * its player sees the names they always have, repeats and all.
 *
 * The goldens below are an FNV-1a hash of the lines `id:name` (ids ascending, joined by newlines)
 * made by running the client's old naming code, as it stood at save v23, over each file's network:
 * `[segments, hash]`. The migration is checked against them, not against itself.
 */
const GOLDEN: Record<string, [number, string]> = {
  'Saves/Ashton.citybloom': [28, '5d0b637a'],
  'Saves/Legacy-no-rail.citybloom': [429, 'a246f0e0'],
  'Saves/legacy/v10-coast.citybloom': [15, 'd6e6ce59'],
  'Saves/legacy/v10-highlands.citybloom': [29, '6fe24acf'],
  'Saves/legacy/v10-lakes.citybloom': [15, '0b75f16b'],
  'Saves/legacy/v10-river.citybloom': [29, '6a445714'],
  'Saves/legacy/v11-coast.citybloom': [15, 'd6e6ce59'],
  'Saves/legacy/v11-highlands.citybloom': [29, '6fe24acf'],
  'Saves/legacy/v11-lakes.citybloom': [15, '0b75f16b'],
  'Saves/legacy/v11-river.citybloom': [29, '87bd60fc'],
  'Saves/legacy/v12-coast.citybloom': [15, 'd6e6ce59'],
  'Saves/legacy/v12-highlands.citybloom': [29, '6fe24acf'],
  'Saves/legacy/v12-lakes.citybloom': [15, '0b75f16b'],
  'Saves/legacy/v12-river.citybloom': [29, 'c2f022eb'],
  'Saves/legacy/v13-coast.citybloom': [15, 'd6e6ce59'],
  'Saves/legacy/v13-highlands.citybloom': [29, '6fe24acf'],
  'Saves/legacy/v13-lakes.citybloom': [15, '0b75f16b'],
  'Saves/legacy/v13-river.citybloom': [29, 'c2f022eb'],
  'Saves/legacy/v14-coast.citybloom': [15, 'd6e6ce59'],
  'Saves/legacy/v14-highlands.citybloom': [29, '6fe24acf'],
  'Saves/legacy/v14-lakes.citybloom': [15, '0b75f16b'],
  'Saves/legacy/v14-river.citybloom': [29, 'c2f022eb'],
  'Saves/legacy/v15-coast.citybloom': [15, 'd6e6ce59'],
  'Saves/legacy/v15-highlands.citybloom': [29, '9acb62ba'],
  'Saves/legacy/v15-lakes.citybloom': [17, '8c2cd46f'],
  'Saves/legacy/v15-river.citybloom': [29, '802784cf'],
  'Saves/legacy/v16-coast.citybloom': [15, 'd6e6ce59'],
  'Saves/legacy/v16-highlands.citybloom': [29, '9acb62ba'],
  'Saves/legacy/v16-lakes.citybloom': [17, '8c2cd46f'],
  'Saves/legacy/v16-river.citybloom': [29, '802784cf'],
  'Saves/legacy/v17-coast.citybloom': [15, 'd6e6ce59'],
  'Saves/legacy/v17-highlands.citybloom': [29, '9acb62ba'],
  'Saves/legacy/v17-lakes.citybloom': [17, '8c2cd46f'],
  'Saves/legacy/v17-river.citybloom': [29, '6fb8991e'],
  'Saves/legacy/v18-coast.citybloom': [16, '7fcbcbb2'],
  'Saves/legacy/v18-highlands.citybloom': [30, '45cc6d4f'],
  'Saves/legacy/v18-lakes.citybloom': [18, '1926d0e8'],
  'Saves/legacy/v18-river.citybloom': [30, '4c96911d'],
  'Saves/legacy/v19-coast.citybloom': [16, '7fcbcbb2'],
  'Saves/legacy/v19-highlands.citybloom': [30, '45cc6d4f'],
  'Saves/legacy/v19-lakes.citybloom': [18, '1926d0e8'],
  'Saves/legacy/v19-river.citybloom': [30, '4c96911d'],
  'Saves/legacy/v20-coast.citybloom': [16, '7fcbcbb2'],
  'Saves/legacy/v20-highlands.citybloom': [30, '8db8b554'],
  'Saves/legacy/v20-lakes.citybloom': [18, '003ded88'],
  'Saves/legacy/v20-river.citybloom': [30, 'ab9803e4'],
  'Saves/legacy/v21-coast.citybloom': [30, '40543b5b'],
  'Saves/legacy/v21-highlands.citybloom': [30, '84ae142c'],
  'Saves/legacy/v21-lakes.citybloom': [35, '9af1c565'],
  'Saves/legacy/v21-river.citybloom': [30, '555304c9'],
  'public/demo.citybloom': [156, '794fba85'],
  'public/scenarios/brink.citybloom': [71, 'd8b3cfd4'],
  'public/scenarios/cleanslate.citybloom': [29, '4517cb00'],
  'public/scenarios/crossroads.citybloom': [51, 'b1391381'],
  'public/scenarios/flood.citybloom': [154, '6a15398c'],
  'public/scenarios/gridlock.citybloom': [24, '6fc35c79'],
  'public/scenarios/harbour.citybloom': [113, '070bb9fa'],
  'public/scenarios/market.citybloom': [44, 'df0bc562'],
  'public/scenarios/railhead.citybloom': [41, 'd30f8609'],
  'public/scenarios/resort.citybloom': [120, 'c968ed95'],
  'public/scenarios/smokestack.citybloom': [29, '00a240c2'],
  'public/scenarios/stadium.citybloom': [181, '72ee011b'],
  'public/scenarios/terraces.citybloom': [48, '16aa4191'],
  'public/scenarios/vote.citybloom': [61, 'd3207145'],
  'public/scenarios/winter.citybloom': [37, 'de62e5dd'],
};

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/** The names a save has once migrated (not `Sim.fromSave`, which also lays a railway on an old city). */
function migratedNames(file: string): Map<number, string> {
  const state = readSaveFile(decodeSave(readFileSync(file)));
  expect(state.version).toBe(SAVE_VERSION);
  const out = new Map<number, string>();
  for (const id of [...state.net.segments.keys()].sort((a, b) => a - b))
    out.set(id, state.net.segments.get(id)!.name!);
  return out;
}

describe('P10: saves from before street names keep the names they had', () => {
  it('the goldens cover every corpus save', () => {
    for (const file of CORPUS) expect(GOLDEN[file], file).toBeDefined();
  });

  for (const [file, [count, hash]] of Object.entries(GOLDEN)) {
    it(`${file}: ${count} roads, named as the client named them`, () => {
      const names = migratedNames(file);
      expect(names.size).toBe(count);
      expect(fnv([...names].map(([id, name]) => `${id}:${name}`).join('\n'))).toBe(hash);
    });
  }

  it('v19-lakes, spelt out', () => {
    expect([...migratedNames('Saves/legacy/v19-lakes.citybloom')].map(([id, n]) => `${id}:${n}`)).toEqual([
      '3:Regional Highway',
      '6:Hawthorn Main Line',
      '16:Poppy Avenue',
      '23:Sorrel Road',
      '27:Sorrel Road',
      '31:Poppy Avenue',
      '34:Poppy Avenue',
      '38:Birch Street',
      '42:Birch Street',
      '46:Poppy Avenue',
      '53:Hawthorn Row',
      '57:Hawthorn Row',
      '61:Poppy Avenue',
      '64:Poppy Avenue',
      '68:Oak Row',
      '72:Oak Row',
      '259:Tannery Terrace',
      '264:Juniper Way',
    ]);
  });

  it('every road in the corpus is named with a suffix for its type', () => {
    for (const file of CORPUS) {
      const state = readSaveFile(decodeSave(readFileSync(file)));
      for (const seg of state.net.segments.values()) {
        const name = seg.name ?? '';
        const ok = STREET_SUFFIX[seg.type].some((suffix) => name.endsWith(` ${suffix}`) || name === suffix);
        expect(ok, `${file}: segment ${seg.id} (${seg.type}) is called "${name}"`).toBe(true);
      }
    }
  });

  it('the v23 step names a copy and leaves the state it was given alone', () => {
    const sim = Sim.create({ seed: 'names', preset: 'river' });
    const state = JSON.parse(JSON.stringify(sim.save().state)) as {
      net: { segments: { $m: [number, { name?: string }][] } };
    };
    for (const [, seg] of state.net.segments.$m) delete seg.name;
    const before = JSON.stringify(state);
    const out = migrations[23]!(state as never) as unknown as typeof state;
    expect(JSON.stringify(state) === before, 'the input state was changed').toBe(true);
    expect(out.net.segments.$m.length).toBe(state.net.segments.$m.length);
    for (const [, seg] of out.net.segments.$m) expect(seg.name).toBeTruthy();
  });

  it('a city with no railway gets one on loading, and it is named', () => {
    const sim = Sim.fromSave(decodeSave(readFileSync('Saves/Legacy-no-rail.citybloom')));
    sim.testMode = true;
    const rail = sim.state.railway;
    expect(rail, 'the rail link fits').toBeTruthy();
    expect(sim.state.net.segments.get(rail!.segment)!.name).toMatch(/ Main Line$/);
    checkInvariants(sim);
  });
});
