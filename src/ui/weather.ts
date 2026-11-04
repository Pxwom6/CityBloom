import type { JSX } from 'preact';
import { WINTER, WINTER_YEARS } from '../data/atom';
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

/**
 * The nuclear winter's badge beside the weather chip (M40): "Nuclear winter, year 2 of 6, -7 °C", and the
 * short form a narrow bar keeps.
 */
export function winterBadge(w: WeatherSummary): string {
  return `Nuclear winter, year ${w.winterYear} of ${WINTER_YEARS}, ${Math.round(w.temp)} °C`;
}
export function winterBadgeShort(w: WeatherSummary): string {
  return `Winter ${w.winterYear}/${WINTER_YEARS}`;
}
/** What the top bar's badge shows (both forms, the bar's width picks one), or null with no winter. */
export function winterBadgeText(w: WeatherSummary): { long: string; short: string } | null {
  return w.winter > 0 ? { long: winterBadge(w), short: winterBadgeShort(w) } : null;
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
  if (w.winter > 0) out.push(winterLine(w));
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

/**
 * The nuclear winter's line for the tooltip and the weather panel: only what is so at this depth (a
 * winter rising or fading is not yet a degree colder, a dimmer sun or summer snow).
 */
function winterLine(w: WeatherSummary): string {
  const says: string[] = [];
  const chill = Math.round(WINTER.chill * w.winterDepth);
  if (chill >= 1) says.push(`every month is ${chill} °C colder`);
  const dim = Math.round(WINTER.solar * w.winterDepth * 100);
  if (dim >= 1) says.push(`solar plants give ${dim} % less`);
  if (w.winterSnows) says.push(`${w.season === 'summer' ? 'even summer rain' : 'rain'} falls as snow`);
  const head = `Nuclear winter, year ${w.winterYear} of ${WINTER_YEARS}: ash dims the sky.`;
  if (!says.length) return head;
  const last = says.pop()!;
  const list = says.length ? `${says.join(', ')} and ${last}` : last;
  return `${head} ${cap(list)}.`;
}

/**
 * The notice a new season gives (M22), by its index (spring, summer, autumn, winter). Under a nuclear
 * winter the warm seasons don't come as they would (phase 5 end: "Autumn: winter is three months away"
 * popped up under heavy snow and an ash sky), so they say so.
 */
export function seasonNotice(season: number, nuclearWinter: boolean): string | null {
  if (nuclearWinter && season >= 0 && season <= 2)
    return [
      'Spring has come, but not the warmth: the nuclear winter keeps the cold in, and heating keeps power demand up.',
      'Summer under the ash: the sun is dimmed, solar plants give less, and it stays cold.',
      'Autumn under the ash: the cold of the nuclear winter stays, and heating keeps power demand up.',
    ][season]!;
  return (
    [
      'Spring has come.',
      'Summer is here: heatwaves raise power and water use.',
      'Autumn: winter is three months away, and heating will push up power demand.',
      'Winter has come: heating raises power demand, and snow slows traffic until it is ploughed.',
    ][season] ?? null
  );
}
