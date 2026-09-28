// Dev (M22): grow the standard test town and follow it through a year: per month the season,
// temperature, weather, power and water demand against supply, road snow, average commute, park
// mood and river. Usage: npx tsx scripts/dev/seasons.ts [preset] [seed] [months]
import { buildTown, serveTown } from '../../tests/helpers';
import { Sim } from '../../src/sim/sim';
import { dateOf, MONTH_NAMES, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { weatherSummary } from '../../src/sim/systems/weather';
import type { MapPreset } from '../../src/data/world';

const preset = (process.argv[2] ?? 'highlands') as MapPreset;
const seed = process.argv[3] ?? 'wx';
const months = Number(process.argv[4] ?? 12);
const sim = Sim.create({ seed, preset, disasters: false });
buildTown(sim);
serveTown(sim);
console.log(`${preset} (${sim.state.weather.climate}), seed ${seed}`);
console.log(
  'month     season  temp  kinds this month          power d/s       water d/s    roads snowy  commute  pop',
);
for (let m = 0; m < months; m++) {
  const kinds = new Map<string, number>();
  let pd = 0;
  let ps = 0;
  let wd = 0;
  let ws = 0;
  let snowy = 0;
  let commute = 0;
  let n = 0;
  const d = dateOf(sim.state.tick + 60);
  for (let h = 0; h < TICKS_PER_MONTH / TICKS_PER_HOUR; h++) {
    sim.advance(TICKS_PER_HOUR);
    const w = sim.state.weather;
    kinds.set(w.kind, (kinds.get(w.kind) ?? 0) + 1);
    const u = sim.state.utilityStats;
    pd += u.power.demand;
    ps += u.power.supply;
    wd += u.water.demand;
    ws += u.water.supply;
    snowy += weatherSummary(sim).roadsSnowy;
    commute += sim.stats().avgCommute;
    n++;
  }
  const w = sim.state.weather;
  console.log(
    `${`${MONTH_NAMES[d.month]} Y${d.year}`.padEnd(9)} ${weatherSummary(sim).season.padEnd(7)}${w.mean.toFixed(0).padStart(4)}  ` +
      `${[...kinds]
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')
        .padEnd(26)}` +
      `${(pd / n).toFixed(0).padStart(6)}/${(ps / n).toFixed(0).padEnd(6)}  ${(wd / n).toFixed(0).padStart(6)}/${(ws / n).toFixed(0).padEnd(6)}` +
      `  ${((snowy / n) * 100).toFixed(0).padStart(4)} %   ${(commute / n).toFixed(1).padStart(6)}  ${sim.state.totals.population}`,
  );
}
