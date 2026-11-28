/**
 * The Workshop's height guide (M47): how tall the game's own model of each civic building stands, so
 * a player's new look can be told "about as tall as the game's own". Writes `src/models/heights.ts`
 * (the Workshop is pure and needs no renderer). Rerun after the game's civic models change:
 *   npx tsx scripts/workshopHeights.ts
 * A test checks every building the Workshop offers has a height.
 */
import { writeFileSync } from 'node:fs';
import { CIVIC_DEFS } from '../src/data/civic';
import { canHaveLook } from '../src/models/customCheck';
import { assets } from '../src/render/assets/registry';

const rows: [string, number][] = [];
for (const d of CIVIC_DEFS) {
  if (!canHaveLook(d.id) || d.military) continue;
  const m = assets.civic(d.id, 0, 0, [], undefined);
  let top = 0;
  for (let i = 1; i < m.pos.length; i += 3) top = Math.max(top, m.pos[i]!);
  rows.push([d.id, Math.round(top * 2) / 2]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
const body = rows.map(([id, h]) => `  ${/^[a-z_][a-z0-9_]*$/.test(id) ? id : `'${id}'`}: ${h},`).join('\n');
writeFileSync(
  'src/models/heights.ts',
  `/**
 * How tall the game's own model of each civic building stands (m), for the Workshop's height guide
 * (M47). Written by \`npx tsx scripts/workshopHeights.ts\`; don't edit by hand.
 */
export const CIVIC_HEIGHTS: Record<string, number> = {
${body}
};
`,
);
console.log(`${rows.length} buildings`);
