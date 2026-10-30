import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  expect(got.war, `${browserName}, the war town`).toEqual(want.war);
  expect(got.battle, `${browserName}, the battles`).toEqual(want.battle);
  expect(got.diplomacy, `${browserName}, diplomacy (M36)`).toBe(want.diplomacy);
  expect(got.research, `${browserName}, research, superweapons and spies (M37)`).toEqual(want.research);
  expect(got.economy, `${browserName}, the war economy (M38)`).toEqual(want.economy);
  expect(got.live, `${browserName}, a live battle with a friend (M39)`).toEqual(want.live);
  expect(got.friends, `${browserName}, wars and treaties with a friend (M39)`).toEqual(want.friends);
  expect(got.used).toEqual(want.used);
  expect(got.refused).toEqual(want.refused);
});

/**
 * SpiderMonkey on its own (Firefox's engine), when a `js` shell is given in JS_SHELL: Playwright's
 * Firefox doesn't launch on the owner's Mac (macOS 27); this checks the engine there meanwhile.
 */
test('the scripted town gives the same hashes in the SpiderMonkey shell', async ({ browserName }) => {
  test.skip(browserName !== 'chromium' || !process.env.JS_SHELL, 'needs JS_SHELL (a SpiderMonkey js shell)');
  const want = reference();
  const shellBundle = buildSync({
    entryPoints: ['tests/lockstep/shellEntry.ts'],
    bundle: true,
    format: 'iife',
    write: false,
    target: 'es2022',
    logLevel: 'silent',
  }).outputFiles[0]!.text;
  const args = { months: MONTHS, id: SCENARIO_ID, save: saveBytes.toString('base64') };
  const file = join(mkdtempSync(join(tmpdir(), 'xb-')), 'run.js');
  writeFileSync(file, `var CITYBLOOM_ARGS = ${JSON.stringify(args)};\n${shellBundle}`);
  const t0 = Date.now();
  const out = execFileSync(process.env.JS_SHELL!, [file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const got = JSON.parse(out.trim().split('\n').at(-1)!) as DeterminismResult;
  const version = execFileSync(process.env.JS_SHELL!, ['--version'], { encoding: 'utf8' }).trim();
  console.log(
    `[xb] SpiderMonkey (${version}): ${MONTHS} months in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  expect(got.months).toEqual(want.months);
  expect(got.editor).toBe(want.editor);
  expect(got.scenario).toEqual(want.scenario);
  expect(got.war).toEqual(want.war);
  expect(got.battle).toEqual(want.battle);
  expect(got.diplomacy).toBe(want.diplomacy);
  expect(got.research).toEqual(want.research);
  expect(got.economy).toEqual(want.economy);
  expect(got.live).toEqual(want.live);
  expect(got.friends).toEqual(want.friends);
  expect(got.refused).toEqual(want.refused);
});
