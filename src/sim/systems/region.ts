import { WEATHER } from '../../data/climate';
import {
  DEAL_RESOURCES,
  NEIGHBOUR_KIND,
  REGION,
  neighbourName,
  type DealDirection,
  type DealResource,
  type NeighbourKind,
  type NeighbourSide,
} from '../../data/region';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import type { RegionFlows } from './regionFlows';
import { civicDef, civicOnline } from '../world/civic';
import { seasonAt, type WeatherState } from './weather';

/**
 * The region (M23), DESIGN.md §3.24: neighbouring towns beyond the map edges that grow or shrink,
 * and the deals the city makes with them. Power and water bought come in at the highway's
 * connection node as if a plant stood there (`updateUtilities`); power and water sold are taken
 * from the city's own surplus there (what's left after its buildings are served, less what was
 * bought), so a deal never blacks out a home and bought power is never resold. Garbage deals move garbage in or out of the city's landfills and plants each hour.
 * Everything is paid for what was actually delivered, on the 'Imports' and 'Exports' lines.
 */

export interface Neighbour {
  id: number;
  name: string;
  kind: NeighbourKind;
  side: NeighbourSide;
  population: number;
  /** Monthly growth rate, drifting within the kind's bounds. */
  trend: number;
  /** Population at the end of each of the last 24 months (oldest first), for the panel's chart. */
  history: number[];
}

export interface Deal {
  id: number;
  neighbour: number;
  resource: DealResource;
  direction: DealDirection;
  /** Contracted amount: MW, water units, or garbage units a day. */
  amount: number;
  /** What went through last hour, in the same units (can fall short of `amount`). */
  delivered: number;
  /** Tick the deal was signed. */
  since: number;
}

export interface RegionState {
  neighbours: Neighbour[];
  deals: Deal[];
  nextDeal: number;
}

const SIDES: NeighbourSide[] = ['north', 'south', 'west'];

/** Three neighbours with their own names, one of each kind, on sides and at sizes drawn from the seed. */
export function initialRegion(seed: string): RegionState {
  const rng = Rng.fromSeed(`${seed}:region-setup`);
  const pick = (n: number) => rng.int(n);
  const kinds = [...NEIGHBOUR_KIND_ORDER];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  const names = new Set<string>();
  const neighbours = kinds.map((kind, i) => {
    const def = NEIGHBOUR_KIND[kind];
    let name = neighbourName(kind, pick);
    while (names.has(name)) name = neighbourName(kind, pick);
    names.add(name);
    const population = Math.round(rng.range(def.startPop[0], def.startPop[1]) / 10) * 10;
    return {
      id: i + 1,
      name,
      kind,
      side: SIDES[i]!,
      population,
      trend: rng.range(def.trend[0] * 0.5, def.trend[1] * 0.5),
      history: [population],
    };
  });
  return { neighbours, deals: [], nextDeal: 1 };
}

const NEIGHBOUR_KIND_ORDER: NeighbourKind[] = ['industrial', 'suburb', 'resort'];

/** How cold it is for heating (0 mild … 1 bitter), from the day's mean temperature. */
function coldness(w: WeatherState): number {
  return Math.max(0, Math.min(1, (WEATHER.heatBelow - w.mean) / WEATHER.heatSpan));
}

/**
 * The most a neighbour will trade right now: what it sells the city (`buy` from the city's side)
 * or what it buys from it. Winter heating eats into an industrial town's spare power.
 */
export function capacity(sim: Sim, n: Neighbour, resource: DealResource, direction: DealDirection): number {
  const per = NEIGHBOUR_KIND[n.kind].per;
  const rate = direction === 'buy' ? per.sell[resource] : per.buy[resource];
  let cap = (rate * n.population) / 1000;
  if (n.kind === 'industrial' && resource === 'power' && direction === 'buy')
    cap *= 1 - REGION.winterPowerCut * coldness(sim.state.weather);
  return Math.floor(cap);
}

/** Neighbour by id. */
export function neighbour(sim: Sim, id: number): Neighbour | undefined {
  return sim.state.region.neighbours.find((n) => n.id === id);
}

/** Power or water coming in under deals now (what the neighbours can actually send). */
export function regionImport(sim: Sim, u: 'power' | 'water' | 'sewage'): number {
  if (u === 'sewage') return 0;
  let total = 0;
  for (const d of sim.state.region.deals) {
    if (d.resource !== u || d.direction !== 'buy') continue;
    const n = neighbour(sim, d.neighbour);
    d.delivered = n ? Math.min(d.amount, capacity(sim, n, u, 'buy')) : 0;
    total += d.delivered;
  }
  return total;
}

/**
 * Power or water sold: `spare` is the city's own surplus at the highway's end of the network, what's
 * left once its buildings are served less what was bought in (bought power is never resold). Each
 * sale gets its share of it, up to its contract and what the neighbour will take. Returns what went out.
 */
export function regionExport(sim: Sim, u: 'power' | 'water' | 'sewage', spare: number): number {
  if (u === 'sewage') return 0;
  const sales = sim.state.region.deals.filter((d) => d.resource === u && d.direction === 'sell');
  if (!sales.length) return 0;
  const want = sales.map((d) => {
    const n = neighbour(sim, d.neighbour);
    return n ? Math.min(d.amount, capacity(sim, n, u, 'sell')) : 0;
  });
  const total = want.reduce((a, b) => a + b, 0);
  const k = total > 0 ? Math.min(1, Math.max(0, spare) / total) : 0;
  let out = 0;
  sales.forEach((d, i) => {
    d.delivered = Math.floor(want[i]! * k);
    out += d.delivered;
  });
  return out;
}

/**
 * Hourly garbage deals: a neighbour that takes the city's garbage empties the landfills a little;
 * one that sends its own has it burnt or recycled where there's room, else buried.
 */
export function garbageDealsHour(sim: Sim): void {
  const s = sim.state;
  const deals = s.region.deals.filter((d) => d.resource === 'garbage');
  if (!deals.length) return;
  const civics = [...s.civics.values()].sort((a, b) => a.id - b.id);
  for (const d of deals) {
    const n = neighbour(sim, d.neighbour);
    const hourly = n ? Math.min(d.amount, capacity(sim, n, 'garbage', d.direction)) / 24 : 0;
    let moved = 0;
    if (d.direction === 'buy') {
      // They collect from the landfills at the edge of town: fullest first.
      for (const c of civics
        .filter((c) => civicDef(c).garbage?.storage)
        .sort((a, b) => b.stored - a.stored)) {
        if (moved >= hourly) break;
        const take = Math.min(c.stored, hourly - moved);
        c.stored -= take;
        moved += take;
      }
    } else {
      // Plants that burn or recycle take it first (up to what they've room for today), then landfills.
      for (const c of civics) {
        const g = civicDef(c).garbage;
        if (!g || moved >= hourly || !civicOnline(c)) continue;
        if (g.process) {
          const room = Math.max(0, g.process - c.processedToday - c.stored);
          const take = Math.min(room, hourly - moved);
          c.processedToday += take;
          moved += take;
        }
      }
      for (const c of civics) {
        const g = civicDef(c).garbage;
        if (!g?.storage || moved >= hourly || !civicOnline(c)) continue;
        const take = Math.min(Math.max(0, g.storage - c.stored), hourly - moved);
        c.stored += take;
        moved += take;
      }
    }
    // `delivered` is kept as a daily rate, like the contract.
    d.delivered = Math.round(moved * 24);
  }
}

/** Monthly: neighbours drift, grow or shrink. */
export function regionMonth(sim: Sim): void {
  const rng = sim.rng.region;
  for (const n of sim.state.region.neighbours) {
    const def = NEIGHBOUR_KIND[n.kind];
    n.trend = Math.max(def.trend[0], Math.min(def.trend[1], n.trend + rng.range(-1, 1) * REGION.trendStep));
    n.population = Math.max(REGION.minPopulation, Math.round(n.population * (1 + n.trend)));
    n.history.push(n.population);
    if (n.history.length > 24) n.history.shift();
  }
}

/** Monthly amounts for the ledger: deals paid for what went through last hour. */
export function regionRates(sim: Sim): { imports: number; exports: number } {
  let imports = 0;
  let exports = 0;
  for (const d of sim.state.region.deals) {
    const price = REGION.price[d.direction][d.resource];
    if (d.direction === 'buy') imports -= d.delivered * price;
    else exports += d.delivered * price;
  }
  return { imports, exports };
}

/** Sign, change or end a deal (amount 0 ends it). */
export function setDeal(
  sim: Sim,
  neighbourId: number,
  resource: DealResource,
  direction: DealDirection,
  amount: number,
  apply = true,
): { ok: true } | { ok: false; reason: string } {
  const n = neighbour(sim, neighbourId);
  if (!n) return { ok: false, reason: 'No such neighbour' };
  if (!DEAL_RESOURCES.includes(resource)) return { ok: false, reason: 'Nothing to trade there' };
  const cap = capacity(sim, n, resource, direction);
  const deals = sim.state.region.deals;
  const i = deals.findIndex(
    (d) => d.neighbour === n.id && d.resource === resource && d.direction === direction,
  );
  if (!(amount > 0)) {
    if (i >= 0 && apply) deals.splice(i, 1);
    return { ok: true };
  }
  if (cap <= 0)
    return {
      ok: false,
      reason: `${n.name} doesn't ${direction === 'buy' ? 'sell' : 'buy'} ${resource === 'garbage' ? 'garbage processing' : resource}`,
    };
  const amt = Math.min(Math.round(amount), cap);
  if (!apply) return { ok: true };
  if (i >= 0) deals[i]!.amount = amt;
  else
    deals.push({
      id: sim.state.region.nextDeal++,
      neighbour: n.id,
      resource,
      direction,
      amount: amt,
      delivered: 0,
      since: sim.state.tick,
    });
  return { ok: true };
}

/** For the region panel: each neighbour with what it offers now, the deals, and the season. */
export interface RegionSummary {
  neighbours: (Neighbour & {
    offers: Record<DealDirection, Record<DealResource, number>>;
  })[];
  deals: Deal[];
  season: string;
  /** Commuters, shoppers and visitors at the last traffic round. */
  flows: RegionFlows;
  /** Truckloads a day put on ships at the seaport (M23), for the ships on screen. */
  shipLoads: number;
}

export function regionSummary(sim: Sim): RegionSummary {
  const r = sim.state.region;
  return {
    neighbours: r.neighbours.map((n) => {
      const offers = { buy: {}, sell: {} } as RegionSummary['neighbours'][number]['offers'];
      for (const dir of ['buy', 'sell'] as const)
        for (const res of DEAL_RESOURCES) offers[dir][res] = capacity(sim, n, res, dir);
      return { ...n, history: [...n.history], offers };
    }),
    deals: r.deals.map((d) => ({ ...d })),
    season: seasonAt(sim.state.weather, sim.state.tick),
    flows: sim.regionFlows,
    shipLoads: [...sim.state.civics.values()]
      .filter((c) => civicDef(c).seaport)
      .reduce((n, c) => n + (sim.railFreight.get(c.id) ?? 0), 0),
  };
}
