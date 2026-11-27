/**
 * Writes the custom-building test models (M46) as files: the good clock-tower pavilion and the bad
 * ones (too big a file, too wide, an outside link, a texture), for scenes and e2e to import.
 * Usage: npx tsx scripts/dev/testglbs.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testModels } from '../lib/makeGlb';
import { suggestTargets, probeCustom } from '../../src/models/customCheck';

const out = process.argv[2] ?? 'shots/glbs';
mkdirSync(out, { recursive: true });
for (const [name, bytes] of Object.entries(testModels())) {
  writeFileSync(join(out, `${name}.glb`), bytes);
  const p = probeCustom(bytes);
  console.log(name, bytes.length, JSON.stringify(p), 'w' in p ? JSON.stringify(suggestTargets(p)) : '');
}
