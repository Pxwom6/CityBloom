// Dev (M40 step 5): a nuclear winter in every climate. Grows the standard test town on each map preset
// (temperate, maritime, continental, alpine), starts a winter in a copy of it and follows both, month by
// month: mean temperature, snowfall hours and the snow lying, the sun's share of solar output, power
// demand and shortfall, snowy roads and ploughs out, population. Then the checks that nothing is absurd:
// demand against twice the January peak, snow that never leaves, ploughs, a frozen economy.
// Usage: npx tsx scripts/dev/winter.ts [months=30] [seed=wx] [preset,preset…]
//   (30 months = the rise and two years of the hold; 72 is the whole winter. DEPOT=0: no snow ploughs.)
import { CLIMATES, WEATHER } from '../../src/data/climate';
import type { MapPreset } from '../../src/data/world';
import { Sim } from '../../src/sim/sim';
import { dateOf, MONTH_NAMES, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import {
  solarShare,
  startWinter,
  weatherSummary,
  weatherUse,
  winterDepth,
} from '../../src/sim/systems/weather';
import { buildTown, placeAlong, serveTown } from '../../tests/helpers';

const months = Number(process.argv[2] ?? 30);
const seed = process.argv[3] ?? 'wx';
const presets = (process.argv[4]?.split(',') ?? ['river', 'coast', 'lakes', 'highlands']) as MapPreset[];
const depot = process.env.DEPOT !== '0';
const clone = (sim: Sim) => Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));

interface Month {
  label: string;
  depth: number;
  temp: number;
  snowHours: number;
  cover: number;
  solar: number;
  power: number;
  unserved: number;
  roadsSnowy: number;
  ploughs: number;
  pop: number;
  heating: number;
}

/** A game month (a day) of hours, averaged. */
function month(sim: Sim): Month {
  const d = dateOf(sim.state.tick + TICKS_PER_HOUR);
  const m: Month = {
    label: `${MONTH_NAMES[d.month]} Y${d.year}`,
    depth: 0,
    temp: 0,
    snowHours: 0,
    cover: 0,
    solar: 0,
    power: 0,
    unserved: 0,
    roadsSnowy: 0,
    ploughs: 0,
    pop: 0,
    heating: 0,
  };
  const hours = TICKS_PER_MONTH / TICKS_PER_HOUR;
  for (let h = 0; h < hours; h++) {
    sim.advance(TICKS_PER_HOUR);
    const w = sim.state.weather;
    m.depth += winterDepth(w, sim.state.tick) / hours;
    m.temp += w.temp / hours;
    if (w.kind === 'snow') m.snowHours++;
    m.cover = Math.max(m.cover, w.snow);
    m.solar += solarShare(w, sim.state.tick) / hours;
    const u = sim.state.utilityStats.power;
    m.power += u.demand / hours;
    m.unserved += u.unserved / hours;
    m.roadsSnowy += weatherSummary(sim).roadsSnowy / hours;
    m.heating += weatherUse(w, sim.state.tick).power.R / hours;
    let p = 0;
    for (const v of sim.state.vehicles.values()) if (v.kind === 'plough') p++;
    m.ploughs = Math.max(m.ploughs, p);
  }
  m.pop = sim.state.totals.population;
  return m;
}

const f = (v: number, n = 1, w = 5) => v.toFixed(n).padStart(w);

for (const preset of presets) {
  const sim = Sim.create({ seed, preset, disasters: false });
  buildTown(sim);
  serveTown(sim);
  if (depot)
    for (const seg of [...sim.state.net.segments.values()].filter((x) => x.type === 'street')) {
      try {
        placeAlong(sim, 'works', seg.id);
        break;
      } catch {
        /* no room here */
      }
    }
  // Three months in (spring to June): the town has grown, and the winter begins in summer.
  sim.advance(3 * TICKS_PER_MONTH);
  const control = clone(sim);
  const cold = clone(sim);
  startWinter(cold, 'probe');
  const climate = CLIMATES[sim.state.weather.climate];
  console.log(`\n${preset} (${climate.name}): winter begins ${MONTH_NAMES[dateOf(cold.state.tick).month]}`);
  console.log(
    'month     depth | temp °C      | snow h/day | ground snow | solar share | power MW (demand)   | short | snowy roads | ploughs | heat R | pop',
  );
  console.log(
    '                | ctrl   cold  | ctrl cold  | ctrl  cold  | ctrl  cold  | ctrl    cold   ×    | cold  | ctrl  cold  | ctrl cold | cold   | cold/ctrl',
  );
  const rows: { a: Month; b: Month }[] = [];
  for (let i = 0; i < months; i++) {
    const a = month(control);
    const b = month(cold);
    rows.push({ a, b });
    console.log(
      `${b.label.padEnd(9)} ${f(b.depth, 2)} | ${f(a.temp)}  ${f(b.temp)} |  ${f(a.snowHours, 0, 3)}  ${f(b.snowHours, 0, 3)} |  ${f(a.cover, 2)}  ${f(b.cover, 2)} |  ${f(a.solar, 2)}  ${f(b.solar, 2)} | ${f(a.power, 0, 6)}  ${f(b.power, 0, 6)}  ${f(b.power / Math.max(1, a.power), 2)} | ${f(b.unserved, 0, 4)}  | ${f(a.roadsSnowy * 100, 0, 3)}%  ${f(b.roadsSnowy * 100, 0, 3)}% |  ${f(a.ploughs, 0, 3)}  ${f(b.ploughs, 0, 3)} |  ${f(b.heating, 2)} | ${f(b.pop / Math.max(1, a.pop), 2)}`,
    );
  }
  // Is anything absurd? Demand against twice the January peak of the same town without the winter.
  let janPeak = 0;
  for (const { a } of rows) if (a.label.startsWith('Jan')) janPeak = Math.max(janPeak, a.power);
  const peak = Math.max(...rows.map((r) => r.b.power));
  const top = Math.max(...rows.map((r) => r.b.power / Math.max(1, r.a.power)));
  const deep = rows.filter((r) => r.b.depth > 0.99);
  const stuck = deep.filter((r) => r.b.cover >= 0.99).length;
  console.log(
    `  checks: peak demand ${f(peak, 0, 0)} MW = ${janPeak ? f(peak / janPeak, 2, 0) : '?'}× the town's January peak ${f(janPeak, 0, 0)} MW ` +
      `(cap 2×: ${!janPeak ? 'no January in the run' : peak <= 2 * janPeak ? 'ok' : 'OVER'}); worst month ${f(top, 2, 0)}× its control; ` +
      `snow covers the ground in ${stuck} of ${deep.length} months at full depth; ` +
      `max ploughs out ${Math.max(...rows.map((r) => r.b.ploughs))}; ` +
      `heating factor at most ${f(Math.max(...rows.map((r) => r.b.heating)), 2, 0)} (the clamp: ${1 + WEATHER.heating.R})`,
  );
}
