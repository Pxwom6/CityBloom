// Dev (M22): a year of weather on each map preset: per month the season, mean temperature, hours
// of each kind of spell, peak ground snow, river rise and dryness.
// Usage: npx tsx scripts/dev/weather.ts [seed] [years] [intensity 0-3]
import { Sim } from '../../src/sim/sim';
import { dateOf, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { WEATHER_KINDS, type WeatherIntensity } from '../../src/data/climate';
import { seasonAt } from '../../src/sim/systems/weather';
import type { MapPreset } from '../../src/data/world';

const seed = process.argv[2] ?? 'wx';
const years = Number(process.argv[3] ?? 1);
const intensity = Number(process.argv[4] ?? 2) as WeatherIntensity;
const ABBR: Record<string, string> = {
  clear: 'cl',
  cloudy: 'cd',
  rain: 'rn',
  storm: 'st',
  snow: 'sn',
  fog: 'fg',
  heat: 'ht',
};

// SUMMARY=1: per climate and season, the share of hours of each kind, plus peaks, over all years.
const summary = !!process.env.SUMMARY;
for (const preset of ['river', 'coast', 'lakes', 'highlands'] as MapPreset[]) {
  const bySeason = new Map<
    string,
    { hours: Record<string, number>; n: number; river: number; snow: number; dry: number }
  >();
  const sim = Sim.create({ seed, preset, disasters: false });
  sim.state.weather.intensity = intensity;
  console.log(`\n${preset} (${sim.state.weather.climate})`);
  console.log(
    'month      season  mean  min   max  ' +
      WEATHER_KINDS.map((k) => ABBR[k]!.padStart(3)).join('') +
      '  snow river  dry',
  );
  for (let m = 0; m < 12 * years; m++) {
    const hours: Record<string, number> = {};
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let snow = 0;
    let river = 0;
    let dry = 0;
    const label = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dateOf(sim.state.tick + 60).month]} Y${dateOf(sim.state.tick + 60).year}`;
    const season = seasonAt(sim.state.weather, sim.state.tick + 60);
    for (let h = 0; h < TICKS_PER_MONTH / TICKS_PER_HOUR; h++) {
      sim.advance(TICKS_PER_HOUR);
      const w = sim.state.weather;
      hours[w.kind] = (hours[w.kind] ?? 0) + 1;
      min = Math.min(min, w.temp);
      max = Math.max(max, w.temp);
      sum += w.temp;
      snow = Math.max(snow, w.snow);
      river = Math.max(river, w.river);
      dry = Math.max(dry, w.dryness);
      const b = bySeason.get(season) ?? { hours: {}, n: 0, river: 0, snow: 0, dry: 0 };
      b.hours[w.kind] = (b.hours[w.kind] ?? 0) + 1;
      b.n++;
      b.river = Math.max(b.river, w.river);
      b.snow = Math.max(b.snow, w.snow);
      b.dry = Math.max(b.dry, w.dryness);
      bySeason.set(season, b);
    }
    if (!summary)
      console.log(
        `${label.padEnd(10)} ${season.padEnd(7)}${(sum / 24).toFixed(1).padStart(5)}${min.toFixed(0).padStart(5)}${max.toFixed(0).padStart(5)}  ` +
          WEATHER_KINDS.map((k) => String(hours[k] ?? '').padStart(3)).join('') +
          `  ${snow.toFixed(2)}  ${river.toFixed(2)} ${dry.toFixed(2)}`,
      );
  }
  if (summary)
    for (const [season, b] of bySeason)
      console.log(
        `${season.padEnd(8)}` +
          WEATHER_KINDS.map(
            (k) => `${ABBR[k]} ${String(Math.round(((b.hours[k] ?? 0) / b.n) * 100)).padStart(2)}%`,
          ).join(' ') +
          `  snow ${b.snow.toFixed(2)} river ${b.river.toFixed(2)} dry ${b.dry.toFixed(2)}`,
      );
}
