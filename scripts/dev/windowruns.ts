// Dev (model batch 3): how long each lit window of the hand-made models runs, as the game lights
// them (long windows are cut into runs at conversion), and what the runs cost in triangles. Every
// window or band longer than `min` metres is listed per model, so a band that would light as one
// stripe at night shows up. Usage: npx tsx scripts/dev/windowruns.ts [min=4.5] [ids…]
// (env DETAIL=n lists the first n long windows of each model; COST=1 prints, per model cut into
// runs, its units and triangles near/far/skyline with long windows whole and in runs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeModel } from '../../src/models/bake';
import { UNIT_BAND, UNIT_DARK, UNIT_GLOW, UNIT_SHOP, UNIT_WINDOW } from '../../src/models/baked';
import { inspectModel } from '../../src/models/check';
import { MODELS_DIR, modelFiles, readBudgets } from '../lib/modelPipeline';

const args = process.argv.slice(2);
const min = Number(args.find((a) => /^[\d.]+$/.test(a)) ?? 4.5);
const only = args.filter((a) => !/^[\d.]+$/.test(a));
const KIND = {
  [UNIT_WINDOW]: 'window',
  [UNIT_SHOP]: 'shop',
  [UNIT_BAND]: 'band',
  [UNIT_GLOW]: 'glow',
  [UNIT_DARK]: 'unlit',
} as Record<number, string>;

const budgets = readBudgets();
let total = 0;
const sum = { whole: [0, 0, 0], runs: [0, 0, 0] };
for (const f of modelFiles(MODELS_DIR)) {
  const { report, file } = inspectModel(readFileSync(join(MODELS_DIR, f)), f, budgets);
  if (!report.ok || !file || (only.length && !only.includes(report.id))) continue;
  const m = bakeModel(file, report);
  const whole = bakeModel(file, report, { runs: false });
  const counts = (b: typeof m) => [b.counts.near, b.counts.far, b.counts.sky];
  counts(whole).forEach((v, i) => (sum.whole[i]! += v));
  counts(m).forEach((v, i) => (sum.runs[i]! += v));
  if (process.env.COST && m.units.length !== whole.units.length)
    console.log(
      `${m.id.padEnd(12)} units ${whole.units.length} -> ${m.units.length}; near/far/sky ${counts(whole).join('/')} -> ${counts(m).join('/')}`,
    );
  // Each unit's extent.
  const n = m.units.length;
  const lo = Array.from({ length: n }, () => [Infinity, Infinity, Infinity]);
  const hi = Array.from({ length: n }, () => [-Infinity, -Infinity, -Infinity]);
  const P = m.positions;
  for (let t = 0; t < m.triUnit.length; t++) {
    const u = m.triUnit[t]!;
    if (!u) continue;
    for (let k = 0; k < 3; k++) {
      const i = m.index[t * 3 + k]! * 3;
      for (let a = 0; a < 3; a++) {
        lo[u - 1]![a] = Math.min(lo[u - 1]![a]!, P[i + a]!);
        hi[u - 1]![a] = Math.max(hi[u - 1]![a]!, P[i + a]!);
      }
    }
  }
  const rows: string[] = [];
  const lens: number[] = [];
  for (let u = 0; u < n; u++) {
    const kind = m.units[u]!;
    // Glazed volumes glow softly, and the strips between runs never light.
    if (kind === UNIT_GLOW || kind === UNIT_DARK) continue;
    const dx = hi[u]![0]! - lo[u]![0]!;
    const dz = hi[u]![2]! - lo[u]![2]!;
    const dy = hi[u]![1]! - lo[u]![1]!;
    const len = Math.max(dx, dz);
    if (len > min) {
      lens.push(len);
      rows.push(
        `   ${KIND[kind]} ${len.toFixed(1)} m (${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)})`,
      );
    }
  }
  if (!rows.length || process.env.COST) continue;
  total += rows.length;
  const kinds = [UNIT_WINDOW, UNIT_SHOP, UNIT_BAND, UNIT_GLOW].map(
    (k) => `${[...m.units].filter((x) => x === k).length} ${KIND[k]}`,
  );
  console.log(
    `${m.id}: ${n} units (${kinds.join(', ')}); ${rows.length} longer than ${min} m (${Math.min(...lens).toFixed(1)}–${Math.max(...lens).toFixed(1)} m)`,
  );
  if (process.env.DETAIL) for (const r of rows.slice(0, Number(process.env.DETAIL))) console.log(r);
}
if (!process.env.COST) console.log(`\n${total} lit windows longer than ${min} m`);
console.log(
  `triangles in every model, near/far/sky: long windows whole ${sum.whole.join('/')}, in runs ${sum.runs.join('/')}`,
);
