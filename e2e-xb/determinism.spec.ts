import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { runDeterminism, type DeterminismResult } from '../tests/lockstep/determinism';
import { ALL_KINDS } from '../tests/lockstep/scriptedTown';
import { decodeSave } from '../src/client/saves';
import { SCENARIO } from '../src/data/scenarios';

/**
 * Same city everywhere (M29): the scripted town, which uses every command kind, grown for two game
 * years in each browser must give Node's state hash at every month's end.
 */
const MONTHS = 24;
const SCENARIO_ID = 'cleanslate';

const bundle = buildSync({
  entryPoints: ['tests/lockstep/browserEntry.ts'],
  bundle: true,
  format: 'iife',
  write: false,
  target: 'es2022',
  logLevel: 'silent',
}).outputFiles[0]!.text;

const saveBytes = readFileSync(`public/scenarios/${SCENARIO.get(SCENARIO_ID)!.save}`);
let expected: DeterminismResult | null = null;
const reference = () =>
  (expected ??= runDeterminism(MONTHS, { id: SCENARIO_ID, save: decodeSave(new Uint8Array(saveBytes)) }));

test('the scripted town gives the same state hash at every month end as in Node', async ({
  page,
  browserName,
}) => {
  const want = reference();
  expect(want.used, 'the script uses every kind of command').toEqual([...ALL_KINDS].sort());
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle });
  const t0 = Date.now();
  const got = await page.evaluate(
    ([months, id, save]) =>
      (
        globalThis as unknown as { citybloomDeterminism: (m: number, s: unknown) => DeterminismResult }
      ).citybloomDeterminism(months, { id, save }),
    [MONTHS, SCENARIO_ID, saveBytes.toString('base64')] as const,
  );
  console.log(
    `[xb] ${browserName}: ${MONTHS} months in ${((Date.now() - t0) / 1000).toFixed(1)} s, population ${got.population}`,
  );
  for (let m = 0; m < MONTHS; m++)
    expect(got.months[m], `${browserName}, month ${m + 1}`).toBe(want.months[m]);
  expect(got.editor).toBe(want.editor);
  expect(got.scenario).toEqual(want.scenario);
  expect(got.used).toEqual(want.used);
  expect(got.refused).toEqual(want.refused);
});
