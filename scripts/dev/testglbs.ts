/**
 * Writes the custom-building test models (M46) as files: the good clock-tower pavilion and the bad
 * ones (too big a file, too wide, an outside link, a texture), and a heavy good one near the 2×2
 * landmark's triangle budget (the frame budget), for scenes and e2e to import.
 * Usage: npx tsx scripts/dev/testglbs.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  goodModelParts,
  heavyModelParts,
  mistakeModels,
  testModels,
  transformParts,
  writeGlb,
} from '../lib/makeGlb';
import { suggestTargets, probeCustom } from '../../src/models/customCheck';

const out = process.argv[2] ?? 'shots/glbs';
mkdirSync(out, { recursive: true });
// The guide's worked example's first try (M47): it floats and faces backwards.
const firstTry = writeGlb(transformParts(goodModelParts(16), { turn: Math.PI, lift: 1.2 }));
for (const [name, bytes] of Object.entries({
  ...testModels(),
  ...mistakeModels(),
  heavy: writeGlb(heavyModelParts(16, 130)),
  firstTry,
})) {
  writeFileSync(join(out, `${name}.glb`), bytes);
  const p = probeCustom(bytes);
  console.log(name, bytes.length, JSON.stringify(p), 'w' in p ? JSON.stringify(suggestTargets(p)) : '');
}
