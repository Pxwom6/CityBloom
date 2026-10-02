// Dev: how well does `models:check` tell which way a building faces? Every model in assets/models
// should pass as it is, and fail when turned half round (annexes aside: they face any way).
// Usage: npx tsx scripts/dev/modelturn.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkModel, frontEvidence } from '../../src/models/check';
import { parseGlb } from '../../src/models/glb';
import { breakModel } from '../lib/breakModel';
import { MODELS_DIR, modelFiles, readBudgets } from '../lib/modelPipeline';

const budgets = readBudgets();
const wrong: string[] = [];
const missed: string[] = [];
let caught = 0;
let n = 0;
for (const f of modelFiles(MODELS_DIR)) {
  const bytes = readFileSync(join(MODELS_DIR, f));
  if (checkModel(bytes, f, budgets).errors.some((e) => e.includes('front faces'))) wrong.push(f);
  if (f.startsWith('annex')) continue;
  n++;
  if (checkModel(breakModel(bytes, 'turn'), f, budgets).errors.some((e) => e.includes('front faces')))
    caught++;
  else missed.push(f.replace('.glb', ''));
}
// How lopsided the evidence is in the models as delivered: the check must sit above the worst.
const ratios = modelFiles(MODELS_DIR)
  .filter((f) => !f.startsWith('annex'))
  .map((f) => {
    const e = frontEvidence(parseGlb(readFileSync(join(MODELS_DIR, f))).parts);
    return { f: f.replace('.glb', ''), r: e.back / Math.max(e.road, 1e-6), ...e };
  })
  .filter((x) => x.back > 0)
  .sort((a, b) => b.r - a.r);
console.log(
  `most evidence at the back, as delivered: ${ratios
    .slice(0, 12)
    .map((x) => `${x.f} ${x.r > 99 ? '∞' : x.r.toFixed(2)}`)
    .join(', ')}`,
);
console.log(`as delivered, failing on facing: ${wrong.join(' ') || 'none'}`);
console.log(`turned half round: ${caught} of ${n} caught; not caught: ${missed.join(' ') || 'none'}`);
// Turned a quarter round: a site that isn't square fails on its footprint; the rest on facing.
let quarters = 0;
const quarterMissed: string[] = [];
for (const f of modelFiles(MODELS_DIR)) {
  if (f.startsWith('annex')) continue;
  quarters++;
  if (checkModel(breakModel(readFileSync(join(MODELS_DIR, f)), 'quarter'), f, budgets).ok)
    quarterMissed.push(f.replace('.glb', ''));
}
console.log(
  `turned a quarter round: ${quarters - quarterMissed.length} of ${quarters} caught; not caught: ${quarterMissed.join(' ') || 'none'}`,
);
// With ids: what each counted for.
for (const id of process.argv.slice(2)) {
  const e = frontEvidence(parseGlb(readFileSync(join(MODELS_DIR, `${id}.glb`))).parts);
  console.log(
    `${id}: road ${e.road.toFixed(1)} back ${e.back.toFixed(1)} side ${e.side.toFixed(1)}\n   ${e.seen.join('; ')}`,
  );
}
