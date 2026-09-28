// Scenario starting cities (M18): builds each scenario's city headlessly with the balance tool's
// mayor (plus the scenario's twist), and writes it to public/scenarios/<id>.citybloom.
// Usage: npx tsx scripts/scenarios.ts [id,id...]   (all when none given)
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR } from '../src/sim/time';
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
  console.log(
    `${id}: ${st.population} residents, $${st.treasury.toLocaleString('en-US')}, approval ${Math.round(st.approval * 100)} %, ` +
      `${(bytes.length / 1024).toFixed(0)} KB, ${((performance.now() - t0) / 1000).toFixed(0)} s` +
      (SCENARIO.has(id) ? '' : ' (no scenario defined yet)'),
  );
}
