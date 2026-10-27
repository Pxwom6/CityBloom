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
import { cleanWarRules, type Personality, type RegionWarRules } from '../../data/war';
import { raidThreat, startWar } from './war';
import { embargoed, forgetNeighbour } from './diplomacy';

/**
 * The region (M23), DESIGN.md §3.24: neighbouring towns beyond the map edges that grow or shrink,
 * and the deals the city makes with them. Power and water bought come in at the highway's
 * connection node as if a plant stood there (`updateUtilities`); power and water sold are taken
 * from the city's own surplus there (what's left after its buildings are served, less what was
 * bought), so a deal never blacks out a home and bought power is never resold. Garbage deals move garbage in or out of the city's landfills and plants each hour.
 * Everything is paid for what was actually delivered, on the 'Imports' and 'Exports' lines.
 */

/**
 * A neighbour that is another player's city in a shared region (M32), as it last reported itself:
 * what it offers this city, and its people and jobs for the commuter flows.
 */
export interface PlayerNeighbour {
  /** Its place in the region. */
  slot: number;
  mayor: string;
  color: number;
  /** What it sells this city at most (`sell`), and buys from it at most (`buy`), per resource. */
  offers: Record<DealDirection, Record<DealResource, number>>;
  /** Its workers looking for a job, its open jobs, and its shoppers a day. */
  workers: number;
  jobs: number;
  shoppers: number;
  /** Playing now (an offline city's last offer stands). */
  online: boolean;
  /**
   * In a region at war (M36): whether the region would let this city raid it now, as the region
   * room decides (`open`), or why not: a newcomer that hasn't raided this city lately, neutral, or
   * raided out for the day.
   */
  raid?: RaidVerdict;
}

/** Why a friend's city can't be raided (M36): its own report says so. */
export type Shield = 'new' | 'neutral';
/** The region's verdict on raiding a friend's city now (M36). */
/** `absent`: its player isn't here, in a region on one player's computer (it keeps nothing for them). */
export type RaidVerdict = 'open' | 'new' | 'neutral' | 'spent' | 'absent';

export interface Neighbour {
  id: number;
  name: string;
  /** Another player's city in a shared region (M32); absent for a simulated town. */
  player?: PlayerNeighbour;
  kind: NeighbourKind;
  side: NeighbourSide;
  population: number;
  /** Monthly growth rate, drifting within the kind's bounds. */
  trend: number;
  /** Population at the end of each of the last 24 months (oldest first), for the panel's chart. */
  history: number[];
  /**
   * A computer neighbour's character and forces in a city with war on (M34); absent otherwise, and
   * for another player's city.
   */
  rival?: RivalNeighbour;
}

/** A computer neighbour as a rival (M34): its character, its forces and defences, how it feels. */
export interface RivalNeighbour {
  personality: Personality;
  /** Fighting strength of its forces and of its fixed defences (strength points). */
  forces: number;
  defences: number;
  /** Its feelings towards the city, −100 (hostile) to 100 (friendly). */
  relation: number;
  /** Other computer neighbours it would stand by (M36): their ids. */
  allies?: number[];
  /** Conquered by the city (M36): it pays a fifth of its taxes, and may rise again. */
  vassal?: { since: number };
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
  /** Signed by the other city in a shared region (M32): this city's side of its deal. */
  remote?: boolean;
}

/**
 * A region project (M32): several cities pay into one great work that one of them hosts, and each
 * contributor gets its share of what it gives.
 */
export interface RegionProjectState {
  /** Paid in by this city, by everyone, and the target. */
  mine: number;
  total: number;
  goal: number;
  /** Fully paid for; this city is the host (it builds it); it has been built. */
  funded: boolean;
  host: boolean;
  built: boolean;
  /** This city's share of the work's power (MW), once built. */
  power: number;
}

export interface RegionState {
  neighbours: Neighbour[];
  deals: Deal[];
  nextDeal: number;
  /** The shared region's project (M32), or null when the city isn't in a shared region. */
  project?: RegionProjectState | null;
  /**
   * The shared region's war rules (M34), set by its host: present only while they allow war, so a
   * peaceful city's state has no such key.
   */
  rules?: RegionWarRules;
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
  return { neighbours, deals: [], nextDeal: 1, project: null };
}

const NEIGHBOUR_KIND_ORDER: NeighbourKind[] = ['industrial', 'suburb', 'resort'];

/** How cold it is for heating (0 mild … 1 bitter), from the day's mean temperature. */
function coldness(w: WeatherState): number {
  return Math.max(0, Math.min(1, (WEATHER.heatBelow - w.mean) / WEATHER.heatSpan));
}

/**
 * The most a neighbour will trade right now: what it sells the city (`buy` from the city's side)
 * or what it buys from it. Winter heating eats into an industrial town's spare power, by the
 * weather `w` (today's, unless a forecast asks about a colder day).
 */
export function capacity(
  sim: Sim,
  n: Neighbour,
  resource: DealResource,
  direction: DealDirection,
  w: WeatherState = sim.state.weather,
): number {
  // Another player's city offers what it last reported (its spare, or its need).
  if (n.player)
    return Math.max(
      0,
      Math.floor(direction === 'buy' ? n.player.offers.sell[resource] : n.player.offers.buy[resource]),
    );
  const per = NEIGHBOUR_KIND[n.kind].per;
  const rate = direction === 'buy' ? per.sell[resource] : per.buy[resource];
  let cap = (rate * n.population) / 1000;
  if (n.kind === 'industrial' && resource === 'power' && direction === 'buy')
    cap *= 1 - REGION.winterPowerCut * coldness(w);
  return Math.floor(cap);
}

/** Neighbour by id. */
export function neighbour(sim: Sim, id: number): Neighbour | undefined {
  return sim.state.region.neighbours.find((n) => n.id === id);
}

/** Power or water coming in under deals now (what the neighbours can actually send). */
export function regionImport(sim: Sim, u: 'power' | 'water' | 'sewage'): number {
  if (u === 'sewage') return 0;
  // A built region project's power (M32): this city's share, free.
  let total = u === 'power' && sim.state.region.project?.built ? sim.state.region.project.power : 0;
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
    // Another player's city signed for it against this city's offer: it takes what it signed for.
    if (d.remote) return n ? d.amount : 0;
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
        .sort((a, b) => b.stored - a.stored || a.id - b.id)) {
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
    // Another player's city grows on its own machine: its reports set its size (M32).
    if (n.player) {
      n.history.push(n.population);
      if (n.history.length > 24) n.history.shift();
      continue;
    }
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
    const player = !!neighbour(sim, d.neighbour)?.player;
    const price = player ? REGION.playerPrice[d.resource] : REGION.price[d.direction][d.resource];
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
  // An embargo (M36) stops trade with that neighbour until a treaty resumes it.
  if (embargoed(sim, n.id)) return { ok: false, reason: `Trade with ${n.name} is under embargo` };
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

/** One of the other cities in a shared region, as the region room passes it on (M32). */
export interface RegionCity {
  slot: number;
  name: string;
  mayor: string;
  color: number;
  population: number;
  kind: NeighbourKind;
  offers: Record<DealDirection, Record<DealResource, number>>;
  workers: number;
  jobs: number;
  shoppers: number;
  online: boolean;
  /** In a region at war (M36): the region's verdict on this city raiding it now. */
  raid?: RaidVerdict;
}

/** A deal another city signed with this one, from this city's side. */
export interface RegionContract {
  slot: number;
  resource: DealResource;
  direction: DealDirection;
  amount: number;
}

export interface RegionUpdate {
  cities: RegionCity[];
  contracts: RegionContract[];
  project: Omit<RegionProjectState, 'mine'> | null;
  /** The region's war rules (M34); none from an older region: peace. */
  rules?: RegionWarRules;
}

/**
 * The shared region's latest news (M32): the other cities take the neighbours' places (in the
 * order they joined; places nobody has taken keep their simulated towns), the deals they signed
 * with this city become its side of them, and the region project's progress.
 */
export function applyRegionUpdate(sim: Sim, u: RegionUpdate): void {
  const r = sim.state.region;
  for (const c of [...u.cities].sort((a, b) => a.slot - b.slot)) {
    const n = r.neighbours.find((x) => x.player?.slot === c.slot) ?? r.neighbours.find((x) => !x.player);
    if (!n) continue;
    // A friend's city isn't a computer rival: its war stance is its own, and whatever the city had
    // with the town it replaces ends (M36).
    if (n.rival) forgetNeighbour(sim, n.id);
    delete n.rival;
    n.name = c.name;
    n.kind = c.kind;
    n.population = Math.max(0, Math.round(c.population));
    n.player = {
      slot: c.slot,
      mayor: c.mayor,
      color: c.color,
      offers: { buy: { ...c.offers.buy }, sell: { ...c.offers.sell } },
      workers: Math.max(0, c.workers),
      jobs: Math.max(0, c.jobs),
      shoppers: Math.max(0, c.shoppers),
      online: c.online,
      ...(c.raid === 'open' ||
      c.raid === 'new' ||
      c.raid === 'neutral' ||
      c.raid === 'spent' ||
      c.raid === 'absent'
        ? { raid: c.raid }
        : {}),
    };
  }
  // The other cities' deals with this one: replaced as a whole with each update.
  const keep = r.deals.filter((d) => !d.remote);
  for (const k of u.contracts) {
    const n = r.neighbours.find((x) => x.player?.slot === k.slot);
    if (!n || !(k.amount > 0)) continue;
    const was = r.deals.find(
      (d) => d.remote && d.neighbour === n.id && d.resource === k.resource && d.direction === k.direction,
    );
    keep.push({
      id: was?.id ?? r.nextDeal++,
      neighbour: n.id,
      resource: k.resource,
      direction: k.direction,
      amount: Math.round(k.amount),
      delivered: was?.delivered ?? 0,
      since: was?.since ?? sim.state.tick,
      remote: true,
    });
  }
  r.deals = keep;
  r.project = u.project ? { ...u.project, mine: r.project?.mine ?? 0 } : null;
  // War (M34): the region's host turns it on, and the city raises forces. Turned off again, the
  // city keeps what it built and trained, but can't fight (later milestones say what that means).
  const rules = u.rules ? cleanWarRules(u.rules) : null;
  if (rules?.war) {
    r.rules = rules;
    startWar(sim);
  } else delete r.rules;
}

/** What this city offers the others in a shared region (M32): its spare and its needs, its people. */
export interface RegionReport {
  population: number;
  kind: NeighbourKind;
  offers: Record<DealDirection, Record<DealResource, number>>;
  workers: number;
  jobs: number;
  shoppers: number;
  /** Its own deals with the other cities (the region room passes each on as the other side's). */
  deals: { slot: number; resource: DealResource; direction: DealDirection; amount: number }[];
  /** The region project's building stands in this city. */
  projectBuilt: boolean;
  /** War (M36): why friends can't raid it, if they can't. */
  shield?: Shield;
}

export function regionReport(sim: Sim): RegionReport {
  const s = sim.state;
  const u = s.utilityStats;
  const t = s.totals;
  const spare = (k: 'power' | 'water') => Math.max(0, Math.floor((u[k].supply - u[k].demand) * 0.8));
  const short = (k: 'power' | 'water') => Math.max(0, Math.ceil(u[k].demand - u[k].supply));
  let process = 0;
  for (const c of s.civics.values()) {
    const g = civicDef(c).garbage;
    if (g?.process && civicOnline(c)) process += g.process;
  }
  const kinds: [NeighbourKind, number][] = [
    ['industrial', t.iJobs],
    ['suburb', t.population * 0.5],
    ['resort', s.tourism.visitors * 2],
  ];
  kinds.sort((a, b) => b[1] - a[1]);
  return {
    population: t.population,
    kind: kinds[0]![0],
    offers: {
      sell: { power: spare('power'), water: spare('water'), garbage: Math.floor(process * 0.3) },
      buy: { power: short('power'), water: short('water'), garbage: 0 },
    },
    workers: Math.round(t.unemployed * REGION.outShare),
    jobs: Math.max(0, t.jobs - t.jobsFilled),
    shoppers: Math.round(t.population * 0.01),
    deals: s.region.deals
      .filter((d) => !d.remote)
      .flatMap((d) => {
        const n = s.region.neighbours.find((x) => x.id === d.neighbour);
        return n?.player
          ? [{ slot: n.player.slot, resource: d.resource, direction: d.direction, amount: d.amount }]
          : [];
      }),
    projectBuilt: [...s.civics.values()].some((c) => civicDef(c).regionProject),
    // War (M36): friends may not raid a neutral city, nor one under the newcomer bar (the region
    // room holds them to it).
    ...(s.war
      ? s.war.diplomacy?.neutral
        ? { shield: 'neutral' as const }
        : !raidThreat(sim).open && !s.war.unshielded
          ? { shield: 'new' as const }
          : {}
      : {}),
  };
}
