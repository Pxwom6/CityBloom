/**
 * Writes the plain-words model spec (M47, `src/models/playerSpec.ts`, numbers from the check's own
 * source) into `docs/making-buildings.md` between its markers. `--check` fails if it's out of date.
 * Usage: npx tsx scripts/docs/modelSpec.ts [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { withPlayerSpec } from '../../src/models/playerSpec';

const file = 'docs/making-buildings.md';
const now = readFileSync(file, 'utf8');
const next = withPlayerSpec(now);
if (process.argv.includes('--check')) {
  if (next !== now) {
    console.error(`${file}'s model spec is out of date: run npx tsx scripts/docs/modelSpec.ts`);
    process.exit(1);
  }
  console.log(`${file}'s model spec is current`);
} else {
  writeFileSync(file, next);
  console.log(next === now ? `${file} unchanged` : `${file} updated`);
}
