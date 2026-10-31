// `npm run models:check [dir|file.glb …] [--strict] [--quiet]`: check every hand-made model in
// assets/models and assets/models/war (or the files or folders given) against the model spec in
// docs/models/PROMPTS*.md and the game's own data, and print a plain report. Buildings are checked
// on the building spec, war buildings (in a folder named `war`) with the war allowances, and units
// (`unit-*.glb`) on the unit spec (PROMPTS-WAR.md). A model that fails is skipped by the build (the
// building or unit keeps its generated look); `--strict` makes a failure the exit code, `--quiet`
// lists only failures and notes.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { checkModel, formatReports, type ModelReport } from '../src/models/check';
import { checkUnit, formatUnitReports, type UnitReport } from '../src/models/unit';
import { MODELS_DIR, WAR_MODELS_DIR, isUnitFile, readBudgets, readWarSites } from './lib/modelPipeline';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const quiet = args.includes('--quiet');
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) targets.push(MODELS_DIR, WAR_MODELS_DIR);

const files: string[] = [];
for (const t of targets) {
  if (!existsSync(t)) {
    console.error(`models:check: ${t} doesn't exist`);
    continue;
  }
  if (statSync(t).isDirectory())
    files.push(
      ...readdirSync(t)
        .filter((f) => f.toLowerCase().endsWith('.glb'))
        .sort()
        .map((f) => join(t, f)),
    );
  else files.push(t);
}

const budgets = readBudgets();
const sites = readWarSites();
/** The war models live in a folder of their own (assets/models/war). */
const inWar = (f: string) => basename(dirname(f)) === 'war';
const buildings: ModelReport[] = [];
const units: UnitReport[] = [];
for (const f of files) {
  const bytes = readFileSync(f);
  if (isUnitFile(f)) {
    units.push(checkUnit(bytes, basename(f), budgets));
    continue;
  }
  const r = checkModel(bytes, basename(f), budgets, inWar(f) ? sites : undefined);
  // As the build: the main models file is loaded in every city, so no war building in it.
  if (!inWar(f) && r.war) {
    r.ok = false;
    r.errors.push(`a war building: put it in ${WAR_MODELS_DIR}, loaded only in cities with war on`);
  }
  buildings.push(r);
}

const all = [...buildings, ...units];
const shownB = quiet ? buildings.filter((r) => !r.ok || r.warnings.length) : buildings;
const shownU = quiet ? units.filter((r) => !r.ok || r.warnings.length) : units;
const text = [
  shownB.length ? formatReports(shownB).replace(/\n\n[^\n]*$/, '') : '',
  shownU.length ? formatUnitReports(shownU) : '',
]
  .filter(Boolean)
  .join('\n');
if (text) console.log(text);
const bad = all.filter((r) => !r.ok).length;
const notes = all.reduce((s, r) => s + r.warnings.length, 0);
console.log(
  `\n${all.length} models${units.length ? ` (${buildings.length} buildings, ${units.length} units)` : ''}: ${all.length - bad} pass${bad ? `, ${bad} fail and are skipped` : ''}, ${notes} notes`,
);
if (!files.length) console.log('No .glb files found.');
if (strict && all.some((r) => !r.ok)) process.exitCode = 1;
