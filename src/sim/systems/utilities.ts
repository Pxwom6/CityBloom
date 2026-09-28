import { CIVIC, UTILITIES, UTILITY_USE, type Utility } from '../../data/civic';
import { WEATHER } from '../../data/climate';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { ZONE_C, ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import { civicDef, civicOnline, type Civic } from '../world/civic';
import { attachmentOf } from './commute';
import { Dijkstra } from './graph';
import { pumpShare, solarShare, weatherUse } from './weather';

export interface UtilityStat {
  supply: number;
  demand: number;
  served: number; // buildings fully served
  unserved: number; // buildings short
}

export type UtilityStats = Record<Utility, UtilityStat>;

export function emptyUtilityStats(): UtilityStats {
  return {
    power: { supply: 0, demand: 0, served: 0, unserved: 0 },
    water: { supply: 0, demand: 0, served: 0, unserved: 0 },
    sewage: { supply: 0, demand: 0, served: 0, unserved: 0 },
  };
}

const dijkstra = new Dijkstra();
const UTIL_LIST: Utility[] = ['power', 'water', 'sewage'];

/** Output of a producer for a utility at current funding and site conditions. */
export function civicOutput(sim: Sim, c: Civic, u: Utility): number {
  if (!civicOnline(c)) return 0;
  const def = civicDef(c);
  let out = def.output?.[u] ?? 0;
  if (u === 'power' && def.garbage?.powerPerUnit) out += c.lastDay * def.garbage.powerPerUnit; // incinerator: yesterday's burn
  if (!out) return 0;
  if (def.groundwater) {
    const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(c.x / GRID_CELL)));
    const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(c.z / GRID_CELL)));
    out *= 0.3 + 0.7 * (sim.terrain.groundwater[j * GRID_RES + i]! / 255);
    // A dry spell lowers the water table (M22).
    out *= pumpShare(sim.state.weather);
  }
  // Sun and wind follow the weather (M22).
  if (u === 'power' && def.id === 'solar') out *= solarShare(sim.state.weather, sim.state.tick);
  if (u === 'power' && def.id === 'wind' && sim.state.weather.kind === 'storm') out *= WEATHER.windStorm;
  return out * sim.fundingEff(def.dept);
}

/**
 * A building's use of a utility. `k` scales it for the weather (M22: heating and cooling power,
 * water in the heat) — `weatherUse(sim.state.weather)` — and is 1 when left out.
 */
export function buildingUse(b: Building, u: Utility, k?: ReturnType<typeof weatherUse>): number {
  const base = b.cap * UTILITY_USE[u][b.zone]!;
  if (!k || u === 'sewage') return base;
  const z = b.zone === ZONE_R ? 'R' : b.zone === ZONE_C ? 'C' : 'I';
  return base * k[u][z];
}

/**
 * Supply flows through the road network (DESIGN §3.6): per connected component, consumers are
 * served in order of road distance from the nearest producer until capacity runs out.
 */
export function updateUtilities(sim: Sim): void {
  const s = sim.state;
  const g = sim.graph();
  const stats = emptyUtilityStats();
  const use = weatherUse(s.weather);
  const consumers: { b: Building; node: number; offset: number }[] = [];
  for (const b of s.buildings.values()) {
    if (b.state !== BState.Active) continue;
    const att = attachmentOf(sim, g, b);
    consumers.push({ b, node: att ? att.node : -1, offset: att ? att.offset * 10 : 0 });
  }
  for (const u of UTIL_LIST) {
    const producers: { c: Civic; node: number; cap: number; polluted: boolean }[] = [];
    for (const c of s.civics.values()) {
      const cap = civicOutput(sim, c, u);
      if (cap <= 0 || !c.access) continue;
      const seg = s.net.segments.get(c.access.seg);
      if (!seg) continue;
      const len = sim.net.curve(seg.id).length;
      const node = g.index.get(c.access.s < len / 2 ? seg.a : seg.b);
      if (node === undefined) continue;
      const polluted = u === 'water' && sim.groundPollutionAt(c.x, c.z) > UTILITIES.pollutedPumpThreshold;
      producers.push({ c, node, cap, polluted });
    }
    const compCap = new Map<number, number>();
    const compPolluted = new Map<number, number>();
    for (const p of producers) {
      const comp = g.component[p.node]!;
      compCap.set(comp, (compCap.get(comp) ?? 0) + p.cap);
      if (p.polluted) compPolluted.set(comp, (compPolluted.get(comp) ?? 0) + p.cap);
      stats[u].supply += p.cap;
    }
    const dist = new Float64Array(g.size).fill(Infinity);
    if (producers.length) {
      dijkstra.run(
        g,
        producers.map((p) => ({ node: p.node, cost: 0 })),
        Infinity,
        (node, cost) => {
          dist[node] = cost;
          return true;
        },
        (k) => g.length[k]!,
      );
    }
    const order = consumers
      .map((c) => ({
        ...c,
        d: c.node >= 0 ? dist[c.node]! + c.offset : Infinity,
        comp: c.node >= 0 ? g.component[c.node]! : -1,
      }))
      .sort((a, b) => a.comp - b.comp || a.d - b.d || a.b.id - b.b.id);
    const left = new Map(compCap);
    for (const e of order) {
      const need = buildingUse(e.b, u, use);
      stats[u].demand += need;
      let served = 0;
      if (Number.isFinite(e.d)) {
        const avail = left.get(e.comp) ?? 0;
        const take = Math.min(avail, need);
        left.set(e.comp, avail - take);
        served = need > 0 ? take / need : 1;
      }
      served = Math.round(served * 1000) / 1000;
      e.b[u] = served;
      if (served >= 0.999) stats[u].served++;
      else stats[u].unserved++;
      if (u === 'water') {
        const cap = compCap.get(e.comp) ?? 0;
        e.b.polluted =
          cap > 0 && served > 0 ? Math.round(((compPolluted.get(e.comp) ?? 0) / cap) * 1000) / 1000 : 0;
      }
    }
    stats[u].supply = Math.round(stats[u].supply);
    stats[u].demand = Math.round(stats[u].demand);
  }
  s.utilityStats = stats;
}

/** Hourly outage bookkeeping: businesses close after UTILITIES.closeAfterHours without power or water. */
export function utilityConsequences(sim: Sim): void {
  for (const b of sim.state.buildings.values()) {
    if (b.state !== BState.Active) continue;
    b.noPowerH = b.power < 0.5 ? b.noPowerH + 1 : 0;
    b.noWaterH = b.water < 0.5 ? b.noWaterH + 1 : 0;
    const shouldClose =
      b.zone !== 1 &&
      (b.flooded > 0 || b.noPowerH >= UTILITIES.closeAfterHours || b.noWaterH >= UTILITIES.closeAfterHours);
    if (shouldClose !== b.closed) {
      b.closed = shouldClose;
      sim.markBuildingDirty(b.id);
      if (shouldClose) sim.events.push({ kind: 'closed', id: b.id });
    }
  }
}

export { CIVIC };
