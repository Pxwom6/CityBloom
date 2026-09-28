// Dev (M22): the weather's worst case on a saved big city (from `bench.ts 8 --big --save city.gz`):
// four public works depots, ten hours of heavy snow, then a day timed — tick average and worst, and
// the worst time per system (weather includes plough dispatch; vehicles moves the ploughs).
// Usage: npx tsx scripts/dev/snowbench.ts city.gz
import { readFileSync } from 'node:fs';
import { gunzipSync, strFromU8 } from 'fflate';
import { Sim } from '../../src/sim/sim';
import { weatherSummary } from '../../src/sim/systems/weather';
import { placeAlong } from '../../tests/helpers';

const sim = Sim.fromSave(JSON.parse(strFromU8(gunzipSync(readFileSync(process.argv[2]!)))));
(sim as unknown as { testMode: boolean }).testMode = true;
sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
const streets = [...sim.state.net.segments.values()].filter(
  (s) => s.type === 'street' || s.type === 'avenue',
);
// NOSNOW=1: the same day without snow or depots, for comparison.
const snow = !process.env.NOSNOW;
let depots = 0;
for (let k = 0; snow && k < streets.length && depots < 4; k += Math.floor(streets.length / 5)) {
  try {
    placeAlong(sim, 'works', streets[k]!.id);
    depots++;
  } catch {
    /* no room by this one */
  }
}
console.log(
  `population ${sim.state.totals.population}, roads ${sim.state.net.segments.size}, depots ${depots}`,
);
console.log(
  sim.dispatch({ type: 'cheat', cheat: 'weather', kind: snow ? 'snow' : 'clear', strength: 1, hours: 10 }),
);
const worst = new Map<string, number>();
const total = new Map<string, number>();
sim.timer = (name, fn) => {
  const a = performance.now();
  fn();
  const ms = performance.now() - a;
  worst.set(name, Math.max(worst.get(name) ?? 0, ms));
  total.set(name, (total.get(name) ?? 0) + ms);
};
const ticks: number[] = [];
for (let h = 0; h < 24; h++) {
  for (let t = 0; t < 60; t++) {
    const a = performance.now();
    sim.step();
    ticks.push(performance.now() - a);
  }
  if (h % 4 === 3) {
    const w = weatherSummary(sim);
    const ploughs = [...sim.state.vehicles.values()].filter((v) => v.kind === 'plough').length;
    console.log(
      `hour ${h + 1}: ${w.kind}, snowy ${(w.roadsSnowy * 100).toFixed(0)} %, deep ${(w.roadsDeep * 100).toFixed(0)} %, ploughs out ${ploughs}`,
    );
  }
}
ticks.sort((a, b) => a - b);
const avg = ticks.reduce((a, b) => a + b, 0) / ticks.length;
console.log(
  `tick avg ${avg.toFixed(3)} ms, p99 ${ticks[Math.floor(ticks.length * 0.99)]!.toFixed(2)}, max ${ticks[ticks.length - 1]!.toFixed(1)} ms`,
);
console.log(
  'worst per system:',
  [...worst]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `${k} ${v.toFixed(1)}`)
    .join(', '),
);
console.log(
  'total per system:',
  [...total]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `${k} ${v.toFixed(0)}`)
    .join(', '),
);
console.log(`weather ${(worst.get('weather') ?? 0).toFixed(2)} ms at worst`);
