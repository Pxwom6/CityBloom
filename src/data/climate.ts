import type { MapPreset } from './world';

/**
 * Seasons and weather (M22). A season is three months of the compressed calendar (three day/night
 * cycles); each map preset has a climate that sets its temperatures and how often each kind of
 * weather comes. DESIGN.md §3.23.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Kinds of weather spell. Snow is what rain and storms become when it's cold enough. */
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog' | 'heat';
export const WEATHER_KINDS: readonly WeatherKind[] = [
  'clear',
  'cloudy',
  'rain',
  'storm',
  'snow',
  'fog',
  'heat',
];

/** Season of a calendar month (0 = Jan): Dec–Feb winter, Mar–May spring, and so on. */
export function seasonOf(month: number): Season {
  return SEASONS[Math.floor(((((month - 2) % 12) + 12) % 12) / 3)]!;
}

export type ClimateId = 'temperate' | 'maritime' | 'continental' | 'alpine';

/** Relative chance of each kind of spell in a season (snow comes from rain and storms). */
type Weights = Record<'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'heat', number>;

export interface Climate {
  id: ClimateId;
  name: string;
  /** Mean temperature (°C) of each calendar month, Jan first. */
  temps: readonly number[];
  /** Half the day–night swing (°C): warmest mid-afternoon, coldest before dawn. */
  swing: number;
  weights: Record<Season, Weights>;
  /** A line for the new-city screen and the weather tooltip. */
  blurb: string;
}

const w = (
  clear: number,
  cloudy: number,
  rain: number,
  storm: number,
  fog: number,
  heat: number,
): Weights => ({
  clear,
  cloudy,
  rain,
  storm,
  fog,
  heat,
});

export const CLIMATES: Record<ClimateId, Climate> = {
  temperate: {
    id: 'temperate',
    name: 'Temperate',
    temps: [2, 3, 6, 9, 13, 16, 19, 18, 15, 11, 6, 3],
    swing: 4,
    weights: {
      spring: w(4, 3, 3, 0.6, 0.8, 0),
      summer: w(5, 2, 2, 1, 0.3, 0.8),
      autumn: w(3, 3, 3.5, 1, 1.6, 0),
      winter: w(3, 3, 3, 0.5, 1.5, 0),
    },
    blurb: 'Mild summers, damp autumns and some snow in winter.',
  },
  maritime: {
    id: 'maritime',
    name: 'Maritime',
    temps: [6, 6, 8, 10, 13, 15, 17, 17, 16, 13, 9, 7],
    swing: 3,
    weights: {
      spring: w(3, 3, 3.5, 0.8, 1.5, 0),
      summer: w(4, 2.5, 2.5, 0.8, 1.2, 0.5),
      autumn: w(2, 3, 4, 1.8, 1.5, 0),
      winter: w(2, 3, 4, 1.6, 1.8, 0),
    },
    blurb: 'Sea air: rarely freezing, often wet, with gales in autumn and fog off the water.',
  },
  continental: {
    id: 'continental',
    name: 'Continental',
    temps: [-4, -3, 2, 8, 14, 19, 22, 21, 16, 9, 3, -2],
    swing: 6,
    weights: {
      spring: w(4, 3, 3, 0.8, 0.8, 0.2),
      summer: w(5, 1.5, 1.5, 1.6, 0.2, 1.2),
      autumn: w(4, 3, 2.5, 0.7, 1.2, 0),
      winter: w(3, 3, 3, 0.6, 1, 0),
    },
    blurb: 'Hot summers with thunderstorms and heatwaves, and cold, snowy winters.',
  },
  alpine: {
    id: 'alpine',
    name: 'Alpine',
    temps: [-6, -5, -2, 3, 8, 12, 15, 14, 10, 5, 0, -4],
    swing: 5,
    weights: {
      spring: w(3, 3, 3, 0.6, 1.5, 0),
      summer: w(5, 2, 2, 1.2, 1, 0.4),
      autumn: w(3, 3, 3, 0.8, 2, 0),
      winter: w(3, 3, 3.5, 0.8, 1.5, 0),
    },
    blurb: 'Short summers and long winters: snow from late autumn to spring, and mountain fog.',
  },
};

/** Each map preset's climate. */
export const PRESET_CLIMATE: Record<MapPreset, ClimateId> = {
  river: 'temperate',
  coast: 'maritime',
  lakes: 'continental',
  highlands: 'alpine',
};

/** Weather intensity setting: off (always clear), light, normal, wild. */
export type WeatherIntensity = 0 | 1 | 2 | 3;
export const INTENSITY_NAMES = ['Off', 'Light', 'Normal', 'Wild'] as const;

/** How a spell of each kind plays out (hours are game hours; a month is one day). */
export const WEATHER = {
  /** Spell length in hours [min, max]. */
  hours: {
    clear: [8, 20],
    cloudy: [6, 14],
    rain: [4, 12],
    storm: [2, 6],
    snow: [5, 14],
    fog: [3, 8],
    heat: [8, 18],
  } as Record<WeatherKind, [number, number]>,
  /** A spell's temperature offset (°C) from the month's mean, [min, max]; heatwaves run hot. */
  offset: [-4, 3] as [number, number],
  heatOffset: [7, 11] as [number, number],
  /** Rain and storms fall as snow at or below this temperature (°C). */
  snowBelow: 1,
  /** Light and wild weather scale the chance of anything but clear skies, and how strong it is. */
  intensityWeight: [0, 0.5, 1, 1.6],
  intensityStrength: [0, 0.65, 1, 1.25],
  /** A new city's first hours are fair (nobody founds a town in a downpour). */
  fairStartHours: 12,
  /** With seasons off, every month has this calendar month's temperatures (May). */
  seasonlessMonth: 4,

  /** Snow on the ground and roads: added per hour of snowfall at full strength, melted per °C above 0. */
  snowFall: 0.07,
  snowMelt: 0.012,
  /** Rain melts snow faster (per hour, at full strength). */
  rainMelt: 0.05,
  /** Busy roads clear faster: melt × (1 + this × load) where load is traffic over capacity (≤ 1). */
  trafficMelt: 1.5,
  /** Travel time on a road × (1 + slow × snow): deep snow nearly doubles it. */
  snowSlow: 0.9,
  /** Roads with less snow than this count as clear. */
  roadClear: 0.05,

  /** Wet ground: rain soaks it, dry weather dries it per hour (faster when warm). */
  wetDry: 0.12,
  /** River rise per hour of rain / storm at full strength (m), and of melting snow per unit melted. */
  riverRain: 0.06,
  riverStorm: 0.16,
  riverMelt: 0.6,
  /** River fall per hour: a fixed amount plus a share of its height. */
  riverFall: 0.01,
  riverFallShare: 0.015,
  riverMax: 3,
  /** Above this rise (m) a flood can break out near homes by the water (disasters on). */
  floodRise: 1.2,
  /** Hourly chance of a flood per metre above `floodRise`. */
  floodChance: 0.05,

  /** Dryness: rises in warm clear weather and heatwaves, falls with rain. */
  dryWarmAbove: 18,
  dryRise: 0.004,
  dryHeat: 0.012,
  dryRain: 0.08,

  /** Heating: extra power per unit of use at 0 % → 100 % cold (mean below `heatBelow` down to `heatBelow − heatSpan`). */
  heatBelow: 14,
  heatSpan: 24,
  heating: { R: 0.45, C: 0.3, I: 0.12 },
  /** Cooling in hot weather: extra power from `coolAbove` to `coolAbove + coolSpan`. */
  coolAbove: 23,
  coolSpan: 10,
  cooling: { R: 0.3, C: 0.35, I: 0.1 },
  /** Extra water in hot weather (same span as cooling). */
  thirst: { R: 0.3, C: 0.2, I: 0.1 },
  /** Groundwater pumps lose up to this share of their output in a drought. */
  droughtPump: 0.45,
  /** Solar output by weather and season; wind turbines run harder in storms. */
  solar: { clear: 1, cloudy: 0.65, rain: 0.45, storm: 0.35, snow: 0.4, fog: 0.75, heat: 1.05 } as Record<
    WeatherKind,
    number
  >,
  solarSeason: { spring: 0.95, summer: 1.05, autumn: 0.9, winter: 0.75 } as Record<Season, number>,
  windStorm: 1.35,
  /** Parks count for this much less while it rains, storms or snows (at full strength). */
  parkRain: 0.5,
};

/** Travel time factor on a road with this much snow on it (M22). */
export function snowFactor(snow: number | undefined): number {
  return snow ? 1 + WEATHER.snowSlow * snow : 1;
}
