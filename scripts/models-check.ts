// `npm run models:check [dir|file.glb …] [--strict] [--quiet]`: check every hand-made model in
// assets/models (or the files or folders given) against the model spec in docs/models/PROMPTS*.md
// and the game's own data, and print a plain report. A model that fails is skipped by the build
// (the building keeps its generated look); `--strict` makes a failure the exit code, `--quiet`
// lists only failures and notes.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { checkModel, formatReports } from '../src/models/check';
import { readBudgets } from './lib/modelPipeline';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const quiet = args.includes('--quiet');
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) targets.push('assets/models');

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
const reports = files.map((f) => checkModel(readFileSync(f), basename(f), budgets));
const shown = quiet ? reports.filter((r) => !r.ok || r.warnings.length) : reports;
const text = formatReports(shown);
if (!quiet) console.log(text);
else if (shown.length) console.log(text.replace(/\n\n[^\n]*$/, ''));
if (quiet) {
  const bad = reports.filter((r) => !r.ok).length;
  console.log(
    `\n${reports.length} models: ${reports.length - bad} pass${bad ? `, ${bad} fail and are skipped` : ''}`,
  );
}
if (!files.length) console.log('No .glb files found.');
if (strict && reports.some((r) => !r.ok)) process.exitCode = 1;
