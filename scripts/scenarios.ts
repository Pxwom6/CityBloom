// Scenario starting cities (M18): builds each scenario's city headlessly with the balance tool's
// mayor (plus the scenario's twist), and writes it to public/scenarios/<id>.citybloom.
// Usage: npx tsx scripts/scenarios.ts [id,id...]   (all when none given)
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { SCENARIO } from '../src/data/scenarios';
import { Player } from './lib/mayor';

/** Let a mayor run the city for some months (four decisions a month, as the balance tool). */
export function govern(p: Player, months: number): void {
  for (let m = 0; m < months; m++)
    for (let h = 0; h < 4; h++) {
      p.play();
      p.sim.advance(TICKS_PER_HOUR * 6);
    }
}

/** Each scenario's starting city. */
const RECIPES: Record<string, () => Sim> = {
  // A young town on clean power, before the city grows.
  cleanslate: () => {
    const p = new Player('careful', { seed: 'meadow', cityName: 'Fernlea' });
    p.avoid = ['coal', 'gas'];
    govern(p, 12);
    return p.sim;
  },
  // A town whose last mayor cut taxes to 3 %, borrowed to the limit, spent it on hospitals, schools
  // and plazas, and over-funded every department: a deficit, three loans and an empty treasury.
  brink: () => {
    const p = new Player('careful', { seed: 'ledger', cityName: 'Marlow' });
    govern(p, 40);
    const sim = p.sim;
    for (const amount of [100_000, 50_000, 25_000]) sim.dispatch({ type: 'takeLoan', amount });
    const spree = [
      'hospital',
      'highschool',
      'hospital',
      'busdepot',
      'highschool',
      'park_large',
      'park_large',
    ];
    for (let k = 0; sim.state.treasury > 15_000 && k < 40; k++) p.place(spree[k % spree.length]!);
    for (let k = 0; sim.state.treasury > 15_000 && k < 40; k++) p.place('plaza');
    p.setFunding(125);
    p.setTaxes(3);
    sim.advance(TICKS_PER_HOUR * 24);
    return sim;
  },
  // A town squeezed by high taxes and starved services, with the four-year vote coming up.
  vote: () => {
    const p = new Player('careful', { seed: 'ballot', cityName: 'Hollin' });
    govern(p, 34);
    p.setTaxes(13);
    p.setFunding(70);
    p.sim.advance(TICKS_PER_MONTH);
    return p.sim;
  },
  // A city past 20,000 that never built a big project.
  stadium: () => {
    const p = new Player('careful', { seed: 'arena', cityName: 'Castlebridge' });
    p.avoid = ['stadium', 'helioarray', 'convention', 'gardenexpo', 'launchsite'];
    govern(p, 56);
    return p.sim;
  },
};

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
