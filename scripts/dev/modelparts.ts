// Dev (model batch 4): every part of a hand-made model as the check reads it: its name, material,
// the groups above it and its bounding box in metres (the front faces -Z, x along the road), and
// whether its faces are wound against each other. A regex keeps only the lines that match.
// Usage: npx tsx scripts/dev/modelparts.ts assets/models/I113-5.glb [regex]
import { readFileSync } from 'node:fs';
import { emptyBox, growBox, orientFaces } from '../../src/models/check';
import { parseGlb } from '../../src/models/glb';

const [path, pattern] = process.argv.slice(2);
if (!path) throw new Error('usage: npx tsx scripts/dev/modelparts.ts file.glb [regex]');
const file = parseGlb(new Uint8Array(readFileSync(path)));
const only = pattern ? new RegExp(pattern) : null;
const f2 = (v: number) => v.toFixed(2);
for (const p of file.parts) {
  const b = growBox(emptyBox(), p.tris);
  const turned = orientFaces(p.tris).turned;
  const line = `${p.name.padEnd(18)} ${p.material.padEnd(12)} [${p.path.join('/')}] x ${f2(b.min[0])}..${f2(b.max[0])} y ${f2(b.min[1])}..${f2(b.max[1])} z ${f2(b.min[2])}..${f2(b.max[2])}${turned ? `  (${turned} faces inside out)` : ''}`;
  if (!only || only.test(line)) console.log(line);
}
