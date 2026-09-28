// Scenario starting cities (M18): builds each scenario's city (scripts/lib/scenarioCities.ts) and
// writes it to public/scenarios/<id>.citybloom.
// Usage: npx tsx scripts/scenarios.ts [id,id...]   (all when none given; DETAIL=1 prints more)
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeSave } from '../src/client/saves';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { SCENARIO } from '../src/data/scenarios';
import { RECIPES } from './lib/scenarioCities';

const wanted = (process.argv[2] ?? Object.keys(RECIPES).join(',')).split(',');
mkdirSync('public/scenarios', { recursive: true });
for (const id of wanted) {
  const make = RECIPES[id];
  if (!make) throw new Error(`No recipe for ${id}`);
  const t0 = performance.now();
  const sim = make();
  // The city is saved paused at 07:00 on a month's first morning, ready for the scenario to begin.
  const bytes = encodeSave(sim.save());
  writeFileSync(`public/scenarios/${id}.citybloom`, bytes);
  const st = sim.stats();
  if (process.env.DETAIL)
    console.log(
      `  net ${st.netMonthly}/mo, loans ${sim.state.economy.loans.length}, taxes ${sim.state.economy.taxes.R.join('/')}, ` +
        `unemployed ${st.unemployed}, month ${Math.floor((sim.state.tick + 420) / TICKS_PER_MONTH)}`,
    );
  console.log(
    `${id}: ${st.population} residents, $${st.treasury.toLocaleString('en-US')}, approval ${Math.round(st.approval * 100)} %, ` +
      `${(bytes.length / 1024).toFixed(0)} KB, ${((performance.now() - t0) / 1000).toFixed(0)} s` +
      (SCENARIO.has(id) ? '' : ' (no scenario defined yet)'),
  );
}
