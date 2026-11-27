// The civic buildings' triangle budgets for the page (M46): a player's own model for a civic building
// is checked against the budget the building's prompt gives (docs/models/PROMPTS*.md, a later batch
// winning, as `npm run models:check` reads them). Writes src/models/budgets.ts; a unit test keeps it in
// step with the prompts. Usage: npx tsx scripts/modelBudgets.ts
import { writeFileSync } from 'node:fs';
import { CIVIC } from '../src/data/civic';
import { readBudgets } from './lib/modelPipeline';

const all = readBudgets();
const rows = [...CIVIC.keys()]
  .filter((id) => all.has(id))
  .sort()
  .map((id) => `  ${/^[a-z_$][\w$]*$/i.test(id) ? id : `'${id}'`}: ${all.get(id)},`);
writeFileSync(
  'src/models/budgets.ts',
  `/**
 * Triangle budgets of the civic buildings that have a prompt (docs/models/PROMPTS*.md), for checking a
 * player's own model in the browser (M46). Made by \`npx tsx scripts/modelBudgets.ts\`; don't edit by hand.
 */
export const CIVIC_BUDGETS: Record<string, number> = {
${rows.join('\n')}
};
`,
);
console.log(`${rows.length} civic budgets written to src/models/budgets.ts`);
