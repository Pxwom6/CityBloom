import type { JSX } from 'preact';
import { CLIMATES, WEATHER, type WeatherKind } from '../data/climate';
import { weatherUse, type WeatherSummary } from '../sim/systems/weather';
import { IconCloud, IconFog, IconHeat, IconRain, IconSnow, IconStorm, IconSun } from './icons';

/** Seasons and weather in the interface (M22): names, icons and the "why" lines. */

export const WEATHER_ICON: Record<WeatherKind, (p: JSX.SVGAttributes<SVGSVGElement>) => JSX.Element> = {
  clear: IconSun,
  cloudy: IconCloud,
  rain: IconRain,
  storm: IconStorm,
  snow: IconSnow,
  fog: IconFog,
  heat: IconHeat,
};

export function weatherName(kind: WeatherKind, strength: number): string {
  const heavy = strength >= 0.7;
  const light = strength < 0.45;
  switch (kind) {
    case 'clear':
      return 'Clear';
    case 'cloudy':
      return heavy ? 'Overcast' : 'Cloudy';
    case 'rain':
      return heavy ? 'Heavy rain' : light ? 'Drizzle' : 'Rain';
    case 'storm':
      return 'Thunderstorm';
    case 'snow':
      return strength >= 0.85 ? 'Blizzard' : heavy ? 'Heavy snow' : light ? 'Light snow' : 'Snow';
    case 'fog':
      return heavy ? 'Thick fog' : 'Fog';
    case 'heat':
      return 'Heatwave';
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** One line for the top bar: season and temperature. */
export function weatherBrief(w: WeatherSummary): string {
  return `${Math.round(w.temp)} °C · ${w.seasons ? cap(w.season) : 'No seasons'}`;
}

/** Why the weather matters right now, for the top bar's tooltip. */
export function weatherLines(w: WeatherSummary): string[] {
  const out = [
    `${w.seasons ? cap(w.season) : 'Seasons off'} · ${weatherName(w.kind, w.strength)} · ${Math.round(w.temp)} °C (the day's mean ${Math.round(w.mean)} °C)`,
    `${CLIMATES[w.climate].name} climate: ${CLIMATES[w.climate].blurb}`,
  ];
  const use = weatherUse(w);
  if (use.power.R > 1.02)
    out.push(
      w.mean < 14
        ? `Heating: homes use ${pct(use.power.R - 1)} more power, shops ${pct(use.power.C - 1)} more.`
        : `Cooling: homes use ${pct(use.power.R - 1)} more power, and ${pct(use.water.R - 1)} more water.`,
    );
  if (w.roadsSnowy > 0.02)
    out.push(
      `Snow on ${pct(w.roadsSnowy)} of the roads (deep on ${pct(w.roadsDeep)}): traffic up to ${(1 + WEATHER.snowSlow).toFixed(1)}× slower until it melts or is ploughed.`,
    );
  else if (w.snow > 0.05) out.push('Snow lies on the fields and roofs; the roads are clear.');
  if (w.kind === 'rain' || w.kind === 'storm' || w.kind === 'snow') out.push('Parks see fewer visitors.');
  if (w.dryness > 0.15)
    out.push(`Dry spell: groundwater pumps give ${pct(WEATHER.droughtPump * w.dryness)} less.`);
  if (w.river > 0.3)
    out.push(
      `The river is ${w.river.toFixed(1)} m above normal${w.river > WEATHER.floodRise ? ': homes by the water may flood' : ''}.`,
    );
  if (w.intensity === 0) out.push('Weather is off in Settings.');
  return out;
}
