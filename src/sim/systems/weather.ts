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
import { WINTER, WINTER_HOURS } from '../../data/atom';
import { isRail } from '../../data/roads';
import type { MapPreset } from '../../data/world';
import type { Sim } from '../sim';
import { dateOf, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../time';
import { hourShare, segVC } from './traffic';
import { DMath } from '../dmath';

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
  /**
   * A city from before seasons (loaded from a pre-M22 save, Phase 2 review), built for mild weather
   * all year: heating and cooling count for nothing from `from` (its loading) through its first
   * winter, then ease in from `start` (the spring after it) to full at `until` (the next winter).
   */
  grace?: { from: number; start: number; until: number };
  /**
   * Nuclear winters (M40, plan call 13): each began at tick `from` with its `depth`, and runs its
   * rise, hold and fall (`winterDepth`). Made by the first one (`startWinter`); a city never touched
   * has no key. An `id` is applied once, whoever repeats it.
   */
  winters?: { id: string; from: number; depth: number }[];
}

/** Share of heating and cooling a city bears now (below 1 only while seasons are new to it). */
export function seasonEase(w: WeatherState, tick: number): number {
  const g = w.grace;
  if (!g) return 1;
  return Math.max(0, Math.min(1, (tick - g.start) / Math.max(1, g.until - g.start)));
}

/**
 * Seasons' grace for a city loaded at `tick` that has never had them: spared through the first
 * winter from then, easing in from the spring after it to the start of the next winter.
 */
export function seasonsGrace(tick: number): { from: number; start: number; until: number } {
  const month0 = tick - (tick % TICKS_PER_MONTH);
  const winter = (m: number) => seasonOf(dateOf(month0 + m * TICKS_PER_MONTH).month) === 'winter';
  let m = 0;
  while (!winter(m)) m++;
  while (winter(m)) m++;
  const start = m;
  while (!winter(m)) m++;
  return { from: tick, start: month0 + start * TICKS_PER_MONTH, until: month0 + m * TICKS_PER_MONTH };
}

/**
 * How far into its course a winter that began `since` ticks ago is, 0 to 1: rising for `WINTER.rise`
 * hours, full for `WINTER.hold`, then falling back to nothing over `WINTER.fall`. Plain arithmetic,
 * the same in every engine.
 */
function winterShape(since: number): number {
  const rise = WINTER.rise * TICKS_PER_HOUR;
  const hold = WINTER.hold * TICKS_PER_HOUR;
  const total = WINTER_HOURS * TICKS_PER_HOUR;
  if (since <= 0 || since >= total) return 0;
  if (since < rise) return since / rise;
  if (since < rise + hold) return 1;
  return (total - since) / (WINTER.fall * TICKS_PER_HOUR);
}

/**
 * How deep the nuclear winter is at `tick` (M40): 0 with none, up to 1 for a first bomb at its
 * deepest; the winters in force add, capped at `WINTER.cap`. A pure read of the winters' starts and
 * depths, so every reader of it (the month's mean, the sun, the snow line, the forecast, the look)
 * agrees, and it costs a lookup in a city that never had one.
 */
export function winterDepth(w: WeatherState, tick: number): number {
  const list = w.winters;
  if (!list) return 0;
  let sum = 0;
  for (const e of list) sum += e.depth * winterShape(tick - e.from);
  return Math.min(WINTER.cap, sum);
}

/**
 * The deepest the winter gets from tick `from` to tick `to` (for a forecast): the depth is a
 * piecewise-linear sum, so its greatest is at one end or where some winter's rise, hold or fall begins.
 */
export function maxWinterDepth(w: WeatherState, from: number, to: number): number {
  const list = w.winters;
  if (!list) return 0;
  let top = Math.max(winterDepth(w, from), winterDepth(w, to));
  for (const e of list)
    for (const h of [WINTER.rise, WINTER.rise + WINTER.hold, WINTER_HOURS]) {
      const at = e.from + h * TICKS_PER_HOUR;
      if (at > from && at < to) top = Math.max(top, winterDepth(w, at));
    }
  return top;
}

/**
 * Whether any winter is in force at `tick` (M40): one that has begun (this very tick included, when its
 * depth is still nothing) and not yet run its course. The depth is not the test: it is 0 on a winter's
 * first tick, and two bombs applied in the same tick are two winters of the same age.
 */
export function winterInForce(w: WeatherState, tick: number): boolean {
  const total = WINTER_HOURS * TICKS_PER_HOUR;
  return !!w.winters?.some((e) => tick >= e.from && tick - e.from < total);
}

/**
 * Which of the winter's six years it is (1 to 6), counting from the oldest winter still in force;
 * 0 with none.
 */
export function winterYear(w: WeatherState, tick: number): number {
  const list = w.winters;
  if (!list) return 0;
  const total = WINTER_HOURS * TICKS_PER_HOUR;
  let start = Infinity;
  for (const e of list) if (tick >= e.from && tick - e.from < total) start = Math.min(start, e.from);
  if (!Number.isFinite(start)) return 0;
  return Math.min(
    Math.round(WINTER_HOURS / WINTER.yearHours),
    Math.floor((tick - start) / (WINTER.yearHours * TICKS_PER_HOUR)) + 1,
  );
}

/**
 * A nuclear winter begins now (M40), once for each `id` (a repeat changes nothing and says false):
 * `self:n` for a bomb that fell in this city, `self:0` for the one this city's own bomb fell on a
 * computer neighbour for, the region room's ids for a friend's. Its depth is 1 for the first, `WINTER.later`
 * for one that begins while another is still in force (`winterInForce`, so two applied in the same tick
 * are a first and a later one, as they are a tick apart; `depth` says otherwise, for tests). Draws nothing.
 */
export function startWinter(sim: Sim, id: string, depth?: number): boolean {
  const w = sim.state.weather;
  if (w.winters?.some((e) => e.id === id)) return false;
  const d = Math.min(WINTER.cap, depth ?? (winterInForce(w, sim.state.tick) ? WINTER.later : 1));
  if (!(d > 0)) return false;
  (w.winters ??= []).push({ id, from: sim.state.tick, depth: d });
  sim.events.push({ kind: 'nuclearWinter', id: 0, info: { depth: d } });
  return true;
}

/**
 * The mean temperature (°C) at or below which rain and storms fall as snow: the usual line, lifted by a
 * nuclear winter of this `depth` (so its summer rain falls as snow once it is deep enough).
 */
export function snowLine(depth: number): number {
  return WEATHER.snowBelow + WINTER.snowLine * depth;
}

/** What a nuclear winter takes off a computer neighbour's town's growth a month: a value, 0 with none. */
export function winterTownDrag(sim: Sim): number {
  const d = winterDepth(sim.state.weather, sim.state.tick);
  return d > 0 ? WINTER.townDrag * d : 0;
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

/** The calendar's mean temperature, eased between neighbouring months across the day. */
function calendarMean(w: WeatherState, tick: number): number {
  const c = CLIMATES[w.climate];
  if (!w.seasons) return c.temps[WEATHER.seasonlessMonth]!;
  const d = dateOf(tick);
  // Centre each month's mean on its noon: before noon lean towards last month, after towards next.
  const f = d.dayFraction - 0.5;
  const other = c.temps[(d.month + (f < 0 ? 11 : 1)) % 12]!;
  return c.temps[d.month]! + (other - c.temps[d.month]!) * Math.abs(f) * 0.5;
}

/** The month's mean temperature now: the calendar's, less a nuclear winter's chill, seasons on or off (M40). */
function monthMean(w: WeatherState, tick: number): number {
  return calendarMean(w, tick) - WINTER.chill * winterDepth(w, tick);
}

function updateTemperature(w: WeatherState, tick: number): void {
  const c = CLIMATES[w.climate];
  const hour = dateOf(tick).dayFraction * 24;
  const mean = monthMean(w, tick) + w.offset;
  w.mean = Math.round(mean * 10) / 10;
  // Warmest at 15:00, coldest at 03:00.
  w.temp = Math.round((mean + c.swing * DMath.cos(((hour - 15) / 24) * Math.PI * 2)) * 10) / 10;
}

/** Draw the next spell from the climate for this season. */
function nextSpell(sim: Sim): void {
  const s = sim.state;
  const w = s.weather;
  const rng = sim.rng.weather;
  const season = seasonAt(w, s.tick);
  const depth = winterDepth(w, s.tick);
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
  // Rain and storms fall as snow when the spell is cold enough. A spell's length is that of the
  // weather the calendar alone would have brought (`lasts`), so a nuclear winter, which changes what
  // falls (below) and how cold it is, moves no spell's end and no later draw (M40, plan call 13).
  const mean = calendarMean(w, s.tick) + w.offset;
  const falls = kind === 'rain' || kind === 'storm';
  const lasts = falls && mean <= WEATHER.snowBelow ? 'snow' : kind;
  // (A nuclear winter lifts the snow line: its summer rain falls as snow.)
  if (falls && mean - WINTER.chill * depth <= snowLine(depth)) kind = 'snow';
  // No heatwave under a nuclear winter's sky: the spell was drawn like any other (and so are its
  // strength and length below), but it comes as a mild cloudy one.
  if (kind === 'heat' && depth >= WINTER.noHeat) {
    kind = 'cloudy';
    w.offset = Math.min(w.offset, WEATHER.offset[1]);
  }
  const strength =
    kind === 'clear' ? 0 : Math.min(1, rng.range(0.35, 1) * WEATHER.intensityStrength[w.intensity]!);
  w.strength = Math.round(strength * 100) / 100;
  w.kind = kind;
  const [lo, hi] = WEATHER.hours[lasts];
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
  // Seasons have fully arrived in a city that was new to them.
  if (w.grace && s.tick >= w.grace.until) delete w.grace;
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

/**
 * Heating and cooling: extra use per unit, by zone, at the day's mean temperature (eased in for a
 * city that's new to seasons, when `tick` is given).
 */
export function weatherUse(
  w: WeatherState,
  tick?: number,
): {
  power: { R: number; C: number; I: number };
  water: { R: number; C: number; I: number };
} {
  const ease = tick === undefined ? 1 : seasonEase(w, tick);
  const cold = clamp01((WEATHER.heatBelow - w.mean) / WEATHER.heatSpan) * ease;
  const hot = clamp01((w.mean - WEATHER.coolAbove) / WEATHER.coolSpan) * ease;
  const h = WEATHER.heating;
  const c = WEATHER.cooling;
  const t = WEATHER.thirst;
  return {
    power: { R: 1 + h.R * cold + c.R * hot, C: 1 + h.C * cold + c.C * hot, I: 1 + h.I * cold + c.I * hot },
    water: { R: 1 + t.R * hot, C: 1 + t.C * hot, I: 1 + t.I * hot },
  };
}

/** Solar output share in this weather and season (and under a nuclear winter's dim sun, M40). */
export function solarShare(w: WeatherState, tick: number): number {
  const share = WEATHER.solar[w.kind] * WEATHER.solarSeason[seasonAt(w, tick)];
  const d = winterDepth(w, tick);
  return d > 0 ? share * (1 - WINTER.solar * d) : share;
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
export interface WeatherSummary extends Omit<WeatherState, 'winters'> {
  season: Season;
  /** Share of road length with snow on it, and with enough to slow traffic noticeably (≥ 0.3). */
  roadsSnowy: number;
  roadsDeep: number;
  /**
   * A nuclear winter (M40): how deep it is for the look, 0 (none) to 1 (full or more); the depth itself
   * (up to `WINTER.cap`, for the words); and its year (0 with none).
   */
  winter: number;
  winterDepth: number;
  winterYear: number;
  /**
   * Whether, with a nuclear winter in force, rain and storms of the month's usual temperature (its chill
   * taken off, the snow line lifted) fall as snow now: the tooltip says so only when it is so.
   */
  winterSnows: boolean;
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
  // (The winters' own list stays in the sim: the page gets how deep it is and which year.)
  const weather: Partial<WeatherState> = { ...s.weather };
  delete weather.winters;
  const exact = winterDepth(s.weather, s.tick);
  const depth = Math.round(exact * 1000) / 1000;
  return {
    ...(weather as Omit<WeatherState, 'winters'>),
    season: seasonAt(s.weather, s.tick),
    roadsSnowy: total ? Math.round((snowy / total) * 1000) / 1000 : 0,
    roadsDeep: total ? Math.round((deep / total) * 1000) / 1000 : 0,
    winter: Math.min(1, depth),
    winterDepth: depth,
    winterYear: winterYear(s.weather, s.tick),
    winterSnows: exact > 0 && monthMean(s.weather, s.tick) <= snowLine(exact),
  };
}
