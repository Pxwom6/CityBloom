import {
  CLIMATES,
  PRESET_CLIMATE,
  SEASONS,
  WEATHER,
  WEATHER_KINDS,
  seasonOf,
  type ClimateId,
  type Season,
  type WeatherIntensity,
  type WeatherKind,
} from '../../data/climate';
import { isRail } from '../../data/roads';
import type { MapPreset } from '../../data/world';
import type { Sim } from '../sim';
import { dateOf, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../time';
import { hourShare, segVC } from './traffic';

/**
 * Seasons and weather (M22), DESIGN.md §3.23. One spell of weather at a time, drawn from the city's
 * climate when the last one ends; temperature follows the calendar, the time of day and the spell.
 * Snow lies on the ground and on each road (`RoadSegment.snow`), rain soaks the ground and raises
 * the river, warm dry weather dries the land out. The effects live where they act (utilities,
 * traffic, happiness) and read the helpers below.
 */
export interface WeatherState {
  climate: ClimateId;
  /** Seasons on: temperatures follow the calendar. Off: every month is a mild late spring. */
  seasons: boolean;
  intensity: WeatherIntensity;
  kind: WeatherKind;
  /** How strong the spell is, 0–1. */
  strength: number;
  /** Tick the spell ends. */
  until: number;
  /** The spell's temperature offset from the month's mean (°C). */
  offset: number;
  /** Temperature now (°C), and the day's mean that heating and cooling follow. */
  temp: number;
  mean: number;
  /** Snow lying on open ground and roofs, 0–1. */
  snow: number;
  /** Wet ground and roads, 0–1. */
  wet: number;
  /** River rise above normal (m). */
  river: number;
  /** Dryness of the land, 0–1 (lowers groundwater). */
  dryness: number;
}

export function initialWeather(preset: MapPreset, tick = 0, climate?: ClimateId): WeatherState {
  const w: WeatherState = {
    climate: climate ?? PRESET_CLIMATE[preset],
    seasons: true,
    intensity: 2,
    kind: 'clear',
    strength: 0,
    until: tick + WEATHER.fairStartHours * TICKS_PER_HOUR,
    offset: 0,
    temp: 0,
    mean: 0,
    snow: 0,
    wet: 0,
    river: 0,
    dryness: 0,
  };
  updateTemperature(w, tick);
  return w;
}

/** Calendar month used for temperatures (fixed in late spring with seasons off). */
function tempMonth(w: WeatherState, tick: number): number {
  return w.seasons ? dateOf(tick).month : WEATHER.seasonlessMonth;
}

export function seasonAt(w: WeatherState, tick: number): Season {
  return seasonOf(tempMonth(w, tick));
}

/** The month's mean temperature, eased between neighbouring months across the day. */
function monthMean(w: WeatherState, tick: number): number {
  const c = CLIMATES[w.climate];
  if (!w.seasons) return c.temps[WEATHER.seasonlessMonth]!;
  const d = dateOf(tick);
  // Centre each month's mean on its noon: before noon lean towards last month, after towards next.
  const f = d.dayFraction - 0.5;
  const other = c.temps[(d.month + (f < 0 ? 11 : 1)) % 12]!;
  return c.temps[d.month]! + (other - c.temps[d.month]!) * Math.abs(f) * 0.5;
}

function updateTemperature(w: WeatherState, tick: number): void {
  const c = CLIMATES[w.climate];
  const hour = dateOf(tick).dayFraction * 24;
  const mean = monthMean(w, tick) + w.offset;
  w.mean = Math.round(mean * 10) / 10;
  // Warmest at 15:00, coldest at 03:00.
  w.temp = Math.round((mean + c.swing * Math.cos(((hour - 15) / 24) * Math.PI * 2)) * 10) / 10;
}

/** Draw the next spell from the climate for this season. */
function nextSpell(sim: Sim): void {
  const s = sim.state;
  const w = s.weather;
  const rng = sim.rng.weather;
  const season = seasonAt(w, s.tick);
  const bad = WEATHER.intensityWeight[w.intensity]!;
  const weights = CLIMATES[w.climate].weights[season];
  const table: [WeatherKind, number][] = [
    ['clear', weights.clear],
    ['cloudy', weights.cloudy * bad],
    ['rain', weights.rain * bad],
    ['storm', weights.storm * bad],
    ['fog', weights.fog * bad],
    ['heat', w.seasons ? weights.heat * bad : 0],
  ];
  const total = table.reduce((a, t) => a + t[1], 0);
  let roll = rng.next() * total;
  let kind: WeatherKind = 'clear';
  for (const [k, v] of table) {
    if (roll < v) {
      kind = k;
      break;
    }
    roll -= v;
  }
  const off = kind === 'heat' ? WEATHER.heatOffset : WEATHER.offset;
  w.offset = Math.round(rng.range(off[0], off[1]) * 10) / 10;
  const drawn = kind;
  // Rain and storms fall as snow when the spell is cold enough.
  if ((kind === 'rain' || kind === 'storm') && monthMean(w, s.tick) + w.offset <= WEATHER.snowBelow)
    kind = 'snow';
  const strength =
    kind === 'clear' ? 0 : Math.min(1, rng.range(0.35, 1) * WEATHER.intensityStrength[w.intensity]!);
  w.strength = Math.round(strength * 100) / 100;
  w.kind = kind;
  const [lo, hi] = WEATHER.hours[kind];
  // A storm that falls as snow is a blizzard.
  if (kind === 'snow' && drawn === 'storm') w.strength = Math.max(w.strength, 0.85);
  w.until = s.tick + Math.round(rng.range(lo, hi)) * TICKS_PER_HOUR;
  // Weather worth a notice (M22): storms, heavy snow, heatwaves.
  if (kind === 'storm' || kind === 'heat' || (kind === 'snow' && w.strength >= 0.6))
    sim.events.push({ kind: 'weather', id: WEATHER_KINDS.indexOf(kind), info: { strength: w.strength } });
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Hourly: move the weather on, then let it lie, soak, melt, rise and dry. */
export function weatherHour(sim: Sim): void {
  const s = sim.state;
  const w = s.weather;
  if (w.intensity === 0) {
    w.kind = 'clear';
    w.strength = 0;
    w.offset = 0;
  } else if (s.tick >= w.until) nextSpell(sim);
  updateTemperature(w, s.tick);
  // A new season (on the calendar's turn from one month to the next).
  const now = seasonAt(w, s.tick);
  if (w.seasons && now !== seasonAt(w, s.tick - TICKS_PER_HOUR))
    sim.events.push({ kind: 'season', id: SEASONS.indexOf(now) });
  const k = w.kind;
  const st = w.strength;
  const raining = k === 'rain' || k === 'storm';
  // Snow on open ground.
  const fall = k === 'snow' ? WEATHER.snowFall * st : 0;
  const melt = Math.max(0, w.temp) * WEATHER.snowMelt + (raining ? WEATHER.rainMelt * st : 0);
  const before = w.snow;
  w.snow = clamp01(w.snow + fall - (k === 'snow' ? 0 : melt));
  const melted = Math.max(0, before + fall - w.snow);
  roadSnowHour(sim, fall, k === 'snow' ? 0 : melt);
  // Wet ground.
  if (raining) w.wet = clamp01(w.wet + 0.5 * st);
  else if (k !== 'snow' && k !== 'fog') w.wet = clamp01(w.wet - WEATHER.wetDry * (w.temp > 20 ? 2 : 1));
  // The river.
  const rise =
    (k === 'rain' ? WEATHER.riverRain * st : 0) +
    (k === 'storm' ? WEATHER.riverStorm * st : 0) +
    (k === 'snow' ? 0 : melted * WEATHER.riverMelt);
  const fallRiver = WEATHER.riverFall + w.river * WEATHER.riverFallShare;
  w.river = Math.round(Math.max(0, Math.min(WEATHER.riverMax, w.river + rise - fallRiver)) * 1000) / 1000;
  // Dryness.
  if (raining) w.dryness = clamp01(w.dryness - WEATHER.dryRain * st);
  else if (k === 'heat') w.dryness = clamp01(w.dryness + WEATHER.dryHeat);
  else if (k === 'clear' && w.mean > WEATHER.dryWarmAbove) w.dryness = clamp01(w.dryness + WEATHER.dryRise);
  else if (k === 'snow' || melted > 0) w.dryness = clamp01(w.dryness - 0.02);
  w.snow = Math.round(w.snow * 1000) / 1000;
  w.wet = Math.round(w.wet * 1000) / 1000;
  w.dryness = Math.round(w.dryness * 1000) / 1000;
}

/**
 * Snow on the roads: falls with the snow, melts in the warmth (faster on busy roads), and is
 * cleared by ploughs (`plowRoads`). Railways shed it.
 */
function roadSnowHour(sim: Sim, fall: number, melt: number): void {
  if (fall <= 0 && melt <= 0) return;
  const share = hourShare(sim.state.tick);
  for (const seg of sim.state.net.segments.values()) {
    if (isRail(seg.type)) continue;
    const had = seg.snow ?? 0;
    if (fall <= 0 && had <= 0) continue;
    const load = Math.min(1, segVC(sim, seg.id, share));
    const v = clamp01(had + fall - melt * (1 + WEATHER.trafficMelt * load));
    if (v < 0.005) delete seg.snow;
    else seg.snow = Math.round(v * 1000) / 1000;
    if ((seg.snow ?? 0) !== had) sim.roadSnowChanged(seg.id);
  }
}

/** Heating and cooling: extra use per unit, by zone, at the day's mean temperature. */
export function weatherUse(w: WeatherState): {
  power: { R: number; C: number; I: number };
  water: { R: number; C: number; I: number };
} {
  const cold = clamp01((WEATHER.heatBelow - w.mean) / WEATHER.heatSpan);
  const hot = clamp01((w.mean - WEATHER.coolAbove) / WEATHER.coolSpan);
  const h = WEATHER.heating;
  const c = WEATHER.cooling;
  const t = WEATHER.thirst;
  return {
    power: { R: 1 + h.R * cold + c.R * hot, C: 1 + h.C * cold + c.C * hot, I: 1 + h.I * cold + c.I * hot },
    water: { R: 1 + t.R * hot, C: 1 + t.C * hot, I: 1 + t.I * hot },
  };
}

/** Solar output share in this weather and season. */
export function solarShare(w: WeatherState, tick: number): number {
  return WEATHER.solar[w.kind] * WEATHER.solarSeason[seasonAt(w, tick)];
}

/** Groundwater pump output share after a dry spell. */
export function pumpShare(w: WeatherState): number {
  return 1 - WEATHER.droughtPump * w.dryness;
}

/** How much parks count for right now (less in rain, storms and snow). */
export function parkShare(w: WeatherState): number {
  return w.kind === 'rain' || w.kind === 'storm' || w.kind === 'snow' ? 1 - WEATHER.parkRain * w.strength : 1;
}

/** Test and scenario hook: set the weather now (the spell lasts `hours`). */
export function setSpell(sim: Sim, kind: WeatherKind, strength: number, hours: number): void {
  const w = sim.state.weather;
  w.kind = kind;
  w.strength = kind === 'clear' ? 0 : clamp01(strength);
  if (kind === 'heat') w.offset = WEATHER.heatOffset[1];
  else if (kind === 'snow')
    w.offset = Math.min(w.offset, WEATHER.snowBelow - 4 - monthMean(w, sim.state.tick));
  w.until = sim.state.tick + Math.max(1, Math.round(hours)) * TICKS_PER_HOUR;
  updateTemperature(w, sim.state.tick);
}

/** Months until winter starts (0 in winter). */
export function monthsToWinter(w: WeatherState, tick: number): number {
  if (!w.seasons) return Infinity;
  for (let m = 0; m < 12; m++) if (seasonOf(dateOf(tick + m * TICKS_PER_MONTH).month) === 'winter') return m;
  return Infinity;
}

/** The weather as the top bar, tooltips and advisors see it. */
export interface WeatherSummary extends WeatherState {
  season: Season;
  /** Share of road length with snow on it, and with enough to slow traffic noticeably (≥ 0.3). */
  roadsSnowy: number;
  roadsDeep: number;
}

export function weatherSummary(sim: Sim): WeatherSummary {
  const s = sim.state;
  let total = 0;
  let snowy = 0;
  let deep = 0;
  for (const seg of s.net.segments.values()) {
    if (isRail(seg.type)) continue;
    const len = sim.net.curve(seg.id).length;
    total += len;
    if ((seg.snow ?? 0) >= WEATHER.roadClear) snowy += len;
    if ((seg.snow ?? 0) >= 0.3) deep += len;
  }
  return {
    ...s.weather,
    season: seasonAt(s.weather, s.tick),
    roadsSnowy: total ? Math.round((snowy / total) * 1000) / 1000 : 0,
    roadsDeep: total ? Math.round((deep / total) * 1000) / 1000 : 0,
  };
}
