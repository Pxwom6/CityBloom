import { emptyChronicle } from './systems/chronicle';
import { emptyTotals } from './systems/totals';
import { newElectionState } from './systems/elections';
import { MILESTONES } from '../data/progression';
import { GRID_RES, HEIGHT_RES, type MapPreset } from '../data/world';
import { Rng } from './rng';
import { initialWeather, seasonsGrace } from './systems/weather';
import { initialRegion } from './systems/region';
import { GAME_TITLE } from '../config';
import { canonicalStringify, decodeValue, encodeValue } from './serialize';
import type { SimState } from './state';

/** Bump when the saved state shape changes, and add a migration from the previous version. */
export const SAVE_VERSION = 23;
export const SAVE_FORMAT = 'citybloom-save';

export interface SaveMeta {
  title: string;
  cityName: string;
  population: number;
  tick: number;
  savedAt: string;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  meta: SaveMeta;
  state: unknown;
}

/** migrations[v] converts an encoded state of version v into version v + 1. */
export const migrations: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2 (M3): the economy (taxes, funding, loans, ledger) arrived. Start from defaults.
  1: (s) => {
    const funding: Record<string, number> = {};
    for (const d of [
      'roads',
      'power',
      'water',
      'sewage',
      'garbage',
      'fire',
      'police',
      'health',
      'education',
      'parks',
      'transit',
    ])
      funding[d] = 100;
    return {
      ...s,
      economy: {
        taxes: { R: [9, 9, 9], C: [9, 9, 9], I: [9, 9, 9] },
        funding,
        loans: [],
        month: {},
        carry: {},
        monthStartTreasury: s.treasury,
        history: [],
        negativeHours: 0,
        bankrupt: false,
      },
    };
  },
  // v2 → v3 (M4): utilities, garbage, civic buildings, vehicles and ground pollution.
  2: (s) => {
    const blds = s.buildings as { $m: [number, Record<string, unknown>][] };
    for (const [, b] of blds.$m)
      Object.assign(b, {
        power: 1,
        water: 1,
        sewage: 1,
        polluted: 0,
        garbage: 0,
        noPowerH: 0,
        noWaterH: 0,
        closed: false,
      });
    const zeros = encodeValue(new Float32Array(128 * 128));
    const stat = { supply: 0, demand: 0, served: 0, unserved: 0 };
    return {
      ...s,
      civics: { $m: [] },
      vehicles: { $m: [] },
      groundPollution: zeros,
      utilityStats: { power: { ...stat }, water: { ...stat }, sewage: { ...stat } },
      unlockAll: false,
    };
  },
  // v3 → v4 (M5): services, incidents, fires and crime.
  3: (s) => {
    const blds = s.buildings as { $m: [number, Record<string, unknown>][] };
    for (const [, b] of blds.$m)
      Object.assign(b, {
        covFire: 0,
        covPolice: 0,
        covHealth: 0,
        covEdu: 0,
        covPark: 0,
        fire: 0,
        burn: 0,
        rubbleH: 0,
      });
    const veh = s.vehicles as { $m: [number, Record<string, unknown>][] };
    for (const [, v] of veh.$m) v.ref = 0;
    return { ...s, burning: [], incidents: { $m: [] }, crime: encodeValue(new Float32Array(128 * 128)) };
  },
  // v4 → v5 (M6): traffic volumes per segment (they build up again within a game day).
  4: (s) => ({ ...s, traffic: { $m: [] } }),
  // v5 → v6 (M6): bus stops and ridership.
  5: (s) => ({ ...s, transit: { stops: { $m: [] }, riders: { $m: [] }, load: { $m: [] } } }),
  // v6 → v7 (M7): air pollution, sickness and education.
  6: (s) => {
    const blds = s.buildings as { $m: [number, Record<string, unknown>][] };
    for (const [, b] of blds.$m)
      Object.assign(b, { sick: 0, treated: 0, edu: b.zone === 1 ? 0.5 : 0, seat1: 0, seat2: 0, seat3: 0 });
    const totals = { ...(s.totals as Record<string, unknown>), eduWorkforce: [0.5, 0] };
    return { ...s, totals, airPollution: encodeValue(new Float32Array(128 * 128)) };
  },
  // v7 → v8 (M9): disasters, road damage, craters; flood and damage state on buildings.
  7: (s) => {
    const blds = s.buildings as { $m: [number, Record<string, unknown>][] };
    for (const [, b] of blds.$m) b.flooded = 0;
    const civs = s.civics as { $m: [number, Record<string, unknown>][] };
    for (const [, c] of civs.$m) Object.assign(c, { damage: 0, flooded: false });
    return { ...s, disasters: [], roadDamage: { $m: [] }, craters: [] };
  },
  // v8 → v9 (M10): progression, policies and civic modules.
  8: (s) => {
    const civs = s.civics as { $m: [number, Record<string, unknown>][] };
    for (const [, c] of civs.$m) c.modules = [];
    const pop = Number((s.totals as { population?: number }).population ?? 0);
    const milestone = MILESTONES.reduce((k, m, i) => (pop >= m.population ? i : k), 0);
    const econ = s.economy as { funding: Record<string, number> };
    econ.funding = { ...econ.funding, tourism: 100, trade: 100 };
    return {
      ...s,
      progress: { peak: pop, milestone, achievements: {}, recoverTo: 0 },
      policies: [],
      tourism: { visitors: 0, overnight: 0 },
    };
  },
  // v9 → v10 (M12): terrain generator versions. Older cities keep the original terrain.
  9: (s) => ({ ...s, options: { ...(s.options as Record<string, unknown>), terrain: 1 } }),
  // v10 → v11 (playtest fixes): garbage trucks do rounds; vehicles note when they set out and
  // how many stops they've made.
  10: (s) => {
    const vs = s.vehicles as { $m: [number, Record<string, unknown>][] };
    for (const [, v] of vs.$m) Object.assign(v, { born: s.tick, stops: 0 });
    return s;
  },
  // v11 → v12 (M13): road earthworks change the terrain; older cities have none.
  11: (s) => ({ ...s, terrainDelta: encodeValue(new Float32Array(HEIGHT_RES * HEIGHT_RES)) }),
  // v12 → v13 (M14): undo history lives with the running game, not in saves.
  12: (s) => {
    const { undo: _undo, ...rest } = s as Record<string, unknown>;
    return rest;
  },
  // v13 → v14 (M16): city history. An older city's history starts on the day it's loaded.
  13: (s) => ({ ...s, chronicle: emptyChronicle(s.tick as number) }),
  // v14 → v15 (M17): big projects (civics gain an optional build state), match days and elections.
  // An older city gets elections from its next four-year mark, unless it's a sandbox.
  14: (s) => {
    const options: Record<string, unknown> = { ...(s.options as Record<string, unknown>), elections: true };
    return {
      ...s,
      options,
      matchDay: null,
      election: newElectionState(s.tick as number, !options.sandbox),
    };
  },
  // v15 → v16 (M18): scenarios. An older city isn't playing one.
  15: (s) => ({ ...s, scenario: null }),
  // v16 → v17 (M19): one-way roads (an optional direction on segments). Older roads are two-way.
  16: (s) => s,
  // v17 → v18 (M20): railways, stations and trams. An older city has no regional rail link; it needs
  // the terrain and the network to place, so `Sim.fromSave` lays one where it fits.
  17: (s) => s,
  // v18 → v19 (M21): districts. An older city has none.
  18: (s) => ({
    ...s,
    districts: { $m: [] },
    districtCells: encodeValue(new Uint8Array(GRID_RES * GRID_RES)),
  }),
  // v19 → v20 (M22): seasons and weather. An older city gets its preset's climate, a fair spell to
  // start with, and its own weather dice; its first winter spares it heating, which eases in by the
  // next (Phase 2 review: it was built for mild weather all year, with no headroom for winter).
  19: (s) => {
    const options = s.options as { seed: string; preset: MapPreset };
    const rng = s.rng as Record<string, unknown>;
    const tick = s.tick as number;
    return {
      ...s,
      weather: s.weather ?? {
        ...initialWeather(options.preset, tick),
        grace: seasonsGrace(tick),
      },
      rng: { ...rng, weather: rng.weather ?? Rng.fromSeed(`${options.seed}:weather`).getState() },
    };
  },
  // v20 → v21 (M23): the region. An older city gets its seed's neighbours, no deals yet, and its
  // own dice for the neighbours' fortunes.
  20: (s) => {
    const options = s.options as { seed: string };
    const rng = s.rng as Record<string, unknown>;
    return {
      ...s,
      region: s.region ?? initialRegion(options.seed),
      rng: { ...rng, region: rng.region ?? Rng.fromSeed(`${options.seed}:region`).getState() },
    };
  },
  // v21 → v22 (M24): custom maps. Every older city was founded on a generated map.
  21: (s) => ({ ...s, map: s.map ?? null }),
  // v22 → v23 (Phase 2 review): a city new to seasons eases into heating (`weather.grace`, set by
  // the v19 → v20 step); a v22 city already has its seasons, so nothing changes.
  22: (s) => s,
};

export function encodeState(state: SimState): unknown {
  return encodeValue(state);
}

export function makeSaveFile(state: SimState, population: number, savedAt: string): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    meta: { title: GAME_TITLE, cityName: state.cityName, population, tick: state.tick, savedAt },
    state: encodeState(state),
  };
}

export function readSaveFile(save: SaveFile): SimState {
  if (!save || save.format !== SAVE_FORMAT) throw new Error('Not a save file');
  if (save.version > SAVE_VERSION) throw new Error(`Save is from a newer version (${save.version})`);
  let encoded = save.state as Record<string, unknown>;
  for (let v = save.version; v < SAVE_VERSION; v++) {
    const m = migrations[v];
    if (!m) throw new Error(`No migration from save version ${v}`);
    encoded = m(encoded);
  }
  const state = decodeValue(encoded) as SimState;
  state.version = SAVE_VERSION;
  repairState(state);
  return state;
}

/**
 * Load-time repair (Phase 2 review): running figures that later versions added and the systems only
 * write as they next run. An older save (or one saved soon after loading an older one) lacked them
 * for the first ticks after loading: Ashton's totals had no `toRegion` or `fromRegion` for 39 ticks.
 */
function repairState(state: SimState): void {
  const totals = state.totals as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(emptyTotals())) if (totals[k] === undefined) totals[k] = v;
  state.tourism.by ??= { road: 0, rail: 0, air: 0, sea: 0 };
}

export function stateToCanonicalJson(state: SimState): string {
  return canonicalStringify(encodeState(state));
}
