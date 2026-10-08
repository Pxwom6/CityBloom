import { CIVIC, UTILITIES, UTILITY_USE, type Utility } from '../../data/civic';
import { CLIMATES, WEATHER } from '../../data/climate';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { ZONE_C, ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { TICKS_PER_MONTH } from '../time';
import { BState, type Building } from '../world/buildings';
import { civicDef, civicOnline, type Civic } from '../world/civic';
import { attachmentOf } from './commute';
import { garbageMadePerDay } from './garbage';
import { Dijkstra } from './graph';
import { capacity, neighbour, regionExport, regionImport } from './region';
import { monthsToWinter, pumpShare, solarShare, weatherUse, type WeatherState } from './weather';

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

/** Sun and wind for an output figure: the share of solar output, and whether wind has a storm. */
export interface PowerSky {
  solar: number;
  storm: boolean;
}

/**
 * The sky a winter forecast counts on (PR #14 review): solar at its snowy midwinter share, wind
 * without a storm's boost.
 */
export const WINTER_SKY: PowerSky = { solar: WEATHER.solar.snow * WEATHER.solarSeason.winter, storm: false };

/**
 * Output of a producer for a utility at current funding and site conditions, under today's sky or
 * the one `sky` gives.
 */
export function civicOutput(sim: Sim, c: Civic, u: Utility, sky?: PowerSky): number {
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
  if (u === 'power' && def.id === 'solar')
    out *= sky ? sky.solar : solarShare(sim.state.weather, sim.state.tick);
  if (u === 'power' && def.id === 'wind' && (sky ? sky.storm : sim.state.weather.kind === 'storm'))
    out *= WEATHER.windStorm;
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
  const use = weatherUse(s.weather, s.tick);
  const consumers: { b: Building; node: number; offset: number }[] = [];
  for (const b of s.buildings.values()) {
    if (b.state !== BState.Active) continue;
    const att = attachmentOf(sim, g, b);
    consumers.push({ b, node: att ? att.node : -1, offset: att ? att.offset * 10 : 0 });
  }
  for (const u of UTIL_LIST) {
    const producers: { node: number; cap: number; polluted: boolean }[] = [];
    for (const c of s.civics.values()) {
      const cap = civicOutput(sim, c, u);
      if (cap <= 0 || !c.access) continue;
      const seg = s.net.segments.get(c.access.seg);
      if (!seg) continue;
      const len = sim.net.curve(seg.id).length;
      const node = g.index.get(c.access.s < len / 2 ? seg.a : seg.b);
      if (node === undefined) continue;
      const polluted = u === 'water' && sim.groundPollutionAt(c.x, c.z) > UTILITIES.pollutedPumpThreshold;
      producers.push({ node, cap, polluted });
    }
    // Deals with neighbours (M23): what's bought comes in at the highway's end of the network.
    const hwNode = g.index.get(s.highway.connect);
    const bought = regionImport(sim, u);
    if (bought > 0 && hwNode !== undefined) producers.push({ node: hwNode, cap: bought, polluted: false });
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
    // What's sold is the city's own surplus at the highway's end of the network: what's left once its
    // buildings are served, less what was bought in (bought power and water are never resold).
    const spare = hwNode !== undefined ? Math.max(0, (left.get(g.component[hwNode]!) ?? 0) - bought) : 0;
    const sold = regionExport(sim, u, spare);
    stats[u].demand += sold;
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

/** What the city's own buildings use of `u` (no exports), at the weather use factors `k` if given. */
export function cityUse(sim: Sim, u: Utility, k?: ReturnType<typeof weatherUse>): number {
  let n = 0;
  for (const b of sim.state.buildings.values()) if (b.state === BState.Active) n += buildingUse(b, u, k);
  return n;
}

/**
 * The coldest day a winter brings: the coldest month's mean with the deepest cold spell under it
 * (`WEATHER.offset`). Forecasts plan for it (PR #14 review: planning for the month's mean left a
 * city that just cleared the warning 181 MW short in a cold spell).
 */
export function coldestDay(w: WeatherState): number {
  return Math.min(...CLIMATES[w.climate].temps) + WEATHER.offset[0];
}

/**
 * The city's own power need and what it would have on a winter's day whose mean temperature is
 * `mean`: full heating, unless `tick` is given and eases it in for a city new to seasons. Each
 * zone heats by its own factor (`WEATHER.heating`), power sold is not counted as need, its own
 * plants count at a snowy winter's sun and with no storm to drive the wind (`WINTER_SKY`), and
 * power bought counts only as much as the neighbours can still send in that cold (an industrial
 * town's spare power shrinks in winter); `cut` is how much less comes in.
 */
export function powerOutlook(
  sim: Sim,
  mean: number,
  tick?: number,
): { need: number; have: number; cut: number } {
  const w = { ...sim.state.weather, mean };
  const need = cityUse(sim, 'power', weatherUse(w, tick));
  // The plants counted as `updateUtilities` counts them: on a road.
  let own = 0;
  for (const c of sim.state.civics.values())
    if (c.access && sim.state.net.segments.has(c.access.seg)) own += civicOutput(sim, c, 'power', WINTER_SKY);
  let bought = 0;
  let then = 0;
  for (const d of sim.state.region.deals) {
    if (d.resource !== 'power' || d.direction !== 'buy') continue;
    bought += d.delivered;
    const n = neighbour(sim, d.neighbour);
    then += n ? Math.min(d.amount, capacity(sim, n, 'power', 'buy', w)) : 0;
  }
  return { need, have: own + then, cut: Math.max(0, bought - then) };
}

/** The power outlook for the coldest day ahead; `months` away (0 in winter). Null with seasons off. */
export function winterOutlook(sim: Sim): ({ months: number } & ReturnType<typeof powerOutlook>) | null {
  const w = sim.state.weather;
  if (!w.seasons) return null;
  const months = monthsToWinter(w, sim.state.tick);
  if (!Number.isFinite(months)) return null;
  return { months, ...powerOutlook(sim, coldestDay(w), sim.state.tick + months * TICKS_PER_MONTH) };
}

/** One utility for the Region panel: what the city makes and uses itself, and what crosses the border. */
export interface UtilityBalance {
  make: number;
  use: number;
  bought: number;
  sold: number;
}

/** The city-wide supply picture the Region panel shows (an on-demand query: it walks every building). */
export interface SupplyBalance {
  power: UtilityBalance;
  water: UtilityBalance;
  garbage: {
    /** Made a day by the whole city; processed a day by plants; room left in landfills. */
    made: number;
    process: number;
    room: number;
    /** A day sent to neighbours (deals the city buys), and taken from them (deals it sells). */
    sent: number;
    taken: number;
  };
  winter: ReturnType<typeof winterOutlook>;
  /** Last closed month's import costs and export earnings, from the ledger; null before the first month closes. */
  ledger: { imports: number; exports: number } | null;
}

/**
 * Power, water and garbage as the city makes, uses, buys and sells them. `stats.utilities` counts
 * what's bought as supply and what's sold as demand, so what the city makes is the supply less
 * the bought and what it uses is the demand less the sold (both hourly figures, like the deals').
 */
export function supplyBalance(sim: Sim): SupplyBalance {
  const s = sim.state;
  const dealt = (res: string, dir: string) =>
    s.region.deals
      .filter((d) => d.resource === res && d.direction === dir)
      .reduce((a, d) => a + d.delivered, 0);
  const balance = (u: 'power' | 'water'): UtilityBalance => {
    const bought = dealt(u, 'buy');
    const sold = dealt(u, 'sell');
    return { make: s.utilityStats[u].supply - bought, use: s.utilityStats[u].demand - sold, bought, sold };
  };
  let process = 0;
  let room = 0;
  for (const c of s.civics.values()) {
    const g = civicDef(c).garbage;
    if (!g || !civicOnline(c)) continue;
    process += g.process ?? 0;
    if (g.storage) room += Math.max(0, g.storage - c.stored);
  }
  const last = s.economy.history.at(-1)?.lines;
  return {
    power: balance('power'),
    water: balance('water'),
    garbage: {
      made: Math.round(garbageMadePerDay(sim)),
      process: Math.round(process),
      room: Math.round(room),
      sent: dealt('garbage', 'buy'),
      taken: dealt('garbage', 'sell'),
    },
    winter: winterOutlook(sim),
    ledger: last
      ? { imports: Math.round(-(last.imports ?? 0)), exports: Math.round(last.exports ?? 0) }
      : null,
  };
}

export { CIVIC };
