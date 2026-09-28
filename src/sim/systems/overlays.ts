import { ROAD_TYPES } from '../../data/roads';
import { GRID_CELL, GRID_RES } from '../../data/world';
import type { Sim } from '../sim';
import { BState, footprint } from '../world/buildings';
import { civicOutput } from './utilities';
import { coverageOnSegment } from './services';

/** Data maps (DESIGN §4): values in [0, 1] per raster cell, −1 where there is nothing to show. */
export type OverlayMap =
  | 'power'
  | 'water'
  | 'sewage'
  | 'garbage'
  | 'groundwater'
  | 'groundPollution'
  | 'landValue'
  | 'resources'
  | 'fire'
  | 'police'
  | 'health'
  | 'education'
  | 'park'
  | 'crime'
  | 'happiness'
  | 'wealth'
  | 'traffic'
  | 'airPollution'
  | 'eduLevel';

export interface OverlayResult {
  map: OverlayMap;
  values: Float32Array;
  /** 'diverging' = bad (0) … good (1); 'sequential' = none (0) … lots (1); 'traffic' = free (0) … jammed (1). */
  ramp: 'diverging' | 'sequential' | 'traffic';
  legend: [string, string];
}

function stampBuildings(
  sim: Sim,
  out: Float32Array,
  value: (b: import('../world/buildings').Building) => number | null,
): void {
  for (const b of sim.state.buildings.values()) {
    const v = value(b);
    if (v === null) continue;
    const r = footprint(b);
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    for (let u = -r.hw + 4; u <= r.hw; u += 8) {
      for (let w = -r.hd + 4; w <= r.hd; w += 8) {
        const x = b.x + u * c - w * s;
        const z = b.z + u * s + w * c;
        const i = Math.floor(x / GRID_CELL);
        const j = Math.floor(z / GRID_CELL);
        if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) continue;
        const k = j * GRID_RES + i;
        out[k] = out[k]! < 0 ? v : Math.min(out[k]!, v);
      }
    }
  }
}

function stampRoads(sim: Sim, out: Float32Array, value: (seg: number) => number | null): void {
  for (const seg of sim.state.net.segments.values()) {
    const v = value(seg.id);
    if (v === null) continue;
    const c = sim.net.curve(seg.id);
    for (let s = 0; s <= c.length; s += 6) {
      const p = c.pointAt(s);
      const i = Math.floor(p.x / GRID_CELL);
      const j = Math.floor(p.z / GRID_CELL);
      if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) continue;
      const k = j * GRID_RES + i;
      if (out[k]! < 0) out[k] = v;
    }
  }
}

export function computeOverlay(sim: Sim, map: OverlayMap): OverlayResult {
  const n = GRID_RES * GRID_RES;
  const values = new Float32Array(n).fill(-1);
  const s = sim.state;
  switch (map) {
    case 'power':
    case 'water':
    case 'sewage': {
      stampBuildings(sim, values, (b) => (b.state === BState.Active ? b[map] : null));
      // Roads carry supply where a producer shares their network.
      const g = sim.graph();
      const supplied = new Set<number>();
      for (const c of s.civics.values()) {
        if (!c.access || civicOutput(sim, c, map) <= 0) continue;
        const seg = s.net.segments.get(c.access.seg);
        if (seg) supplied.add(g.componentOfNode(seg.a));
      }
      stampRoads(sim, values, (id) => {
        const seg = s.net.segments.get(id)!;
        if (!ROAD_TYPES[seg.type].access) return null;
        return supplied.has(g.componentOfNode(seg.a)) ? 1 : 0;
      });
      return {
        map,
        values,
        ramp: 'diverging',
        legend: map === 'sewage' ? ['Sewage backing up', 'Drained'] : ['No supply', 'Supplied'],
      };
    }
    case 'garbage':
      stampBuildings(sim, values, (b) => (b.state === BState.Active ? Math.min(1, b.garbage / 60) : null));
      return { map, values, ramp: 'sequential', legend: ['Clean', 'Piling up'] };
    case 'groundwater':
    case 'resources':
      for (let k = 0; k < n; k++) {
        const v =
          map === 'groundwater'
            ? sim.terrain.groundwater[k]! / 255
            : Math.max(sim.terrain.ore[k]!, sim.terrain.oil[k]!) / 255;
        values[k] = v > 0.02 ? v : -1;
      }
      return {
        map,
        values,
        ramp: 'sequential',
        legend: map === 'groundwater' ? ['Dry', 'Plenty of water'] : ['None', 'Rich deposits'],
      };
    case 'groundPollution':
      for (let k = 0; k < n; k++)
        values[k] = s.groundPollution[k]! > 0.01 ? Math.min(1, s.groundPollution[k]!) : -1;
      return { map, values, ramp: 'sequential', legend: ['Clean', 'Polluted'] };
    case 'airPollution':
      for (let k = 0; k < n; k++)
        values[k] = s.airPollution[k]! > 0.01 ? Math.min(1, s.airPollution[k]! * 2.5) : -1;
      return { map, values, ramp: 'sequential', legend: ['Clean air', 'Smog'] };
    case 'eduLevel':
      stampBuildings(sim, values, (b) =>
        b.state === BState.Active && b.zone === 1 ? Math.min(1, b.edu / 2) : null,
      );
      return { map, values, ramp: 'sequential', legend: ['Little schooling', 'High school and up'] };
    case 'landValue':
      for (let k = 0; k < n; k++) values[k] = s.landValue[k]!;
      return { map, values, ramp: 'sequential', legend: ['Low', 'High'] };
    case 'fire':
    case 'police':
    case 'health':
    case 'education':
    case 'park': {
      const cov = sim.coverage;
      // Coverage follows the roads: stamp each road cell with its interpolated coverage.
      for (const seg of s.net.segments.values()) {
        if (!ROAD_TYPES[seg.type].access) continue;
        const c = sim.net.curve(seg.id);
        for (let d = 0; d <= c.length; d += 6) {
          const p = c.pointAt(d);
          const i = Math.floor(p.x / GRID_CELL);
          const j = Math.floor(p.z / GRID_CELL);
          if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) continue;
          const v = coverageOnSegment(cov, map, seg.id, d, c.length);
          const k = j * GRID_RES + i;
          values[k] = Math.max(values[k]!, v);
        }
      }
      const key = {
        fire: 'covFire',
        police: 'covPolice',
        health: 'covHealth',
        education: 'covEdu',
        park: 'covPark',
      } as const;
      stampBuildings(sim, values, (b) => (b.state === BState.Active ? b[key[map]] : null));
      return { map, values, ramp: 'diverging', legend: ['Not covered', 'Well covered'] };
    }
    case 'crime':
      for (let k = 0; k < n; k++) values[k] = s.crime[k]! > 0.01 ? Math.min(1, s.crime[k]!) : -1;
      return { map, values, ramp: 'sequential', legend: ['Safe', 'High crime'] };
    case 'happiness':
      stampBuildings(sim, values, (b) => (b.state === BState.Active ? b.happiness : null));
      return { map, values, ramp: 'diverging', legend: ['Unhappy', 'Happy'] };
    case 'traffic':
      // Drawn on the roads by the client (volumes and the hour are mirrored there).
      return { map, values, ramp: 'traffic', legend: ['Flowing', 'Jammed'] };
    case 'wealth':
      stampBuildings(sim, values, (b) => (b.state === BState.Active && b.zone !== 3 ? b.wealth / 2 : null));
      return { map, values, ramp: 'sequential', legend: ['Low wealth', 'High wealth'] };
  }
}
