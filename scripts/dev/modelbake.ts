// Dev: convert every model in assets/models and print what the game will ship: triangles in the
// file, drawn near and drawn far, windows, markers, and the size of the converted file.
// Usage: npx tsx scripts/dev/modelbake.ts [id …]
import { gzipSync } from 'node:zlib';
import { buildModels } from '../lib/modelPipeline';
import { decodeModels } from '../../src/models/codec';

const only = process.argv.slice(2);
const t0 = performance.now();
const { reports, models, bytes } = buildModels();
const ms = performance.now() - t0;
const back = decodeModels(bytes);
let file = 0;
let near = 0;
let far = 0;
let sky = 0;
for (const m of back) {
  file += m.counts.file;
  near += m.counts.near;
  far += m.counts.far;
  sky += m.counts.sky;
  if (only.length && !only.includes(m.id)) continue;
  console.log(
    `${m.id.padEnd(22)} ${String(m.w).padStart(4)}×${String(m.d).padEnd(4)} h ${m.h.toFixed(1).padStart(6)}  file ${String(m.counts.file).padStart(5)}  near ${String(m.counts.near).padStart(5)}  far ${String(m.counts.far).padStart(5)} (${Math.round((100 * m.counts.far) / m.counts.near)}%)  sky ${String(m.counts.sky).padStart(5)} (${Math.round((100 * m.counts.sky) / m.counts.near)}%)  units ${String(m.units.length).padStart(3)}  trees ${m.trees.length / 3}  stacks ${m.stacks.length / 3}${m.party ? '  party walls' : ''}`,
  );
}
const bad = reports.filter((r) => !r.ok);
console.log(
  `\n${models.length} models converted in ${ms.toFixed(0)} ms (${bad.length} skipped: ${bad.map((r) => r.id).join(', ') || 'none'})`,
);
console.log(
  `triangles: ${file} in the files, ${near} drawn near (${Math.round((100 * near) / file)}%), ${far} drawn far (${Math.round((100 * far) / near)}% of near), ${sky} in the skyline (${Math.round((100 * sky) / near)}%)`,
);
console.log(
  `models file: ${(bytes.length / 1024).toFixed(0)} KB, ${(gzipSync(bytes).length / 1024).toFixed(0)} KB gzipped`,
);
