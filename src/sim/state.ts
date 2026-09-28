import type { Chronicle } from './systems/chronicle';
import type { ElectionState } from './systems/elections';
import type { MapPreset } from '../data/world';
import type { Difficulty } from '../data/economy';
import type { RngState } from './rng';
import type { NetworkState } from './world/network';
import type { Building } from './world/buildings';
import type { CityTotals } from './systems/totals';
import type { DemandState } from './systems/demand';
import type { EconomyState } from './systems/economy';
import type { Civic } from './world/civic';
import type { Vehicle } from './systems/vehicles';
import type { UtilityStats } from './systems/utilities';
import type { Incident } from './systems/incidents';
import type { TransitState } from './systems/transit';
import type { ScenarioState } from './systems/scenario';
import type { Crater, Disaster } from './systems/disasters';
import type { TourismState } from './systems/specialisations';
import { TERRAIN_VERSION } from './terrain/generate';
import type { District } from './systems/districts';
import type { WeatherState } from './systems/weather';

export type { Difficulty };

export interface GameOptions {
  seed: string;
  preset: MapPreset;
  difficulty: Difficulty;
  sandbox: boolean;
  disasters: boolean;
  /** Elections every four years (M17); never in sandbox cities. */
  elections: boolean;
  cityName: string;
  /** Terrain generator version the city was founded with (see TERRAIN_VERSION). */
  terrain: number;
}

export const DEFAULT_OPTIONS: GameOptions = {
  seed: 'citybloom',
  preset: 'river',
  difficulty: 'normal',
  sandbox: false,
  disasters: true,
  elections: true,
  cityName: 'New Town',
  terrain: TERRAIN_VERSION,
};

export const RNG_STREAMS = ['world', 'growth', 'events', 'traffic', 'disasters', 'weather'] as const;
export type RngStream = (typeof RNG_STREAMS)[number];

/**
 * Everything that is saved. Derived data (road adjacency, spatial indexes, terrain heights) lives
 * in `Sim` and is rebuilt on load. DESIGN.md §2.2.
 */
export interface SimState {
  version: number;
  options: GameOptions;
  tick: number;
  /** Next entity id (shared by every entity type; ids are never reused). */
  nextId: number;
  rng: Record<RngStream, RngState>;
  treasury: number;
  cityName: string;
  /** Tree density per raster cell (0..255); roads and buildings clear it. */
  trees: Uint8Array;
  net: NetworkState;
  /** The regional highway: off-map node and the connection node inside the map. */
  highway: { outside: number; connect: number; segment: number };
  /**
   * The regional railway (M20): off-map node, the connection node inside the map, and the segment
   * between them. Placed on the west edge near the highway where there's room; null if none fits.
   */
  railway: { outside: number; connect: number; segment: number } | null;
  buildings: Map<number, Building>;
  totals: CityTotals;
  demand: DemandState;
  /** Land value raster (GRID_RES²), 0..1. */
  landValue: Float32Array;
  /** Round-robin positions of sliced systems. */
  cursors: { growth: number; matchRound: number };
  economy: EconomyState;
  civics: Map<number, Civic>;
  vehicles: Map<number, Vehicle>;
  /** Ground pollution raster (GRID_RES²), 0..1. */
  groundPollution: Float32Array;
  utilityStats: UtilityStats;
  /** Debug cheat: ignore unlock thresholds. */
  unlockAll: boolean;
  /** Buildings on fire (ids, ascending). */
  burning: number[];
  incidents: Map<number, Incident>;
  /** Crime raster (GRID_RES²), 0..1. */
  crime: Float32Array;
  /** Earthworks (M13): height change at each terrain sample (HEIGHT_RES²), on top of the seed. */
  terrainDelta: Float32Array;
  /** Daily traffic per road segment (passenger-car units, both directions). */
  traffic: Map<number, number>;
  /** Bus stops and last round's ridership. */
  transit: TransitState;
  /** Air pollution raster (GRID_RES²), 0..1, drifting with the wind. */
  airPollution: Float32Array;
  /** Disasters under way. */
  disasters: Disaster[];
  /** Damaged roads: segment → hours until repaired (impassable until then). */
  roadDamage: Map<number, number>;
  /** Meteor craters (scorch marks fade after a while). */
  craters: Crater[];
  /** Progression: the highest population reached (unlocks keep), milestone index, achievements (id → tick). */
  progress: {
    peak: number;
    milestone: number;
    achievements: Record<string, number>;
    /** Population to beat for the comeback achievement (0 until a big disaster). */
    recoverTo: number;
  };
  /** Policies in force. */
  policies: string[];
  /** Visitors a day and overnight guests (tourism specialisation). */
  tourism: TourismState;
  /** City history (M16): key figures over the city's life, and its milestones and disasters. */
  chronicle: Chronicle;
  /** The stadium's match day under way (M17): which stadium, and the tick it ends. */
  matchDay: { civic: number; until: number } | null;
  /** Elections (M17): the next vote, promises made, results, and a term's perk or limits. */
  election: ElectionState;
  /** The scenario this city is playing (M18), or null. */
  scenario: ScenarioState | null;
  /** Districts (M21) by id, and the district each raster cell (GRID_RES²) belongs to (0: none). */
  districts: Map<number, District>;
  districtCells: Uint8Array;
  /** Seasons and weather (M22): the spell now, temperature, snow, wet ground, river and dryness. */
  weather: WeatherState;
}
