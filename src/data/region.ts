/**
 * The region (M23): two or three neighbouring towns beyond the map edges, each with a character,
 * that grow or shrink over time, trade power, water and garbage processing under deals the player
 * makes, send commuters and shoppers in and take the city's unemployed out. DESIGN.md §3.24.
 */

export type NeighbourKind = 'industrial' | 'resort' | 'suburb';
export const NEIGHBOUR_KINDS: readonly NeighbourKind[] = ['industrial', 'suburb', 'resort'];

/** Where a neighbour lies: up or down the regional highway, or out along the railway. */
export type NeighbourSide = 'north' | 'south' | 'west';

export type DealResource = 'power' | 'water' | 'garbage';
export const DEAL_RESOURCES: readonly DealResource[] = ['power', 'water', 'garbage'];

/** `buy`: the city buys from the neighbour; `sell`: the city sells to it. */
export type DealDirection = 'buy' | 'sell';

/** Per 1,000 of a neighbour's residents. */
interface PerThousand {
  /** What it will sell the city at most (MW, water units, garbage units a day it will process). */
  sell: Record<DealResource, number>;
  /** What it will buy from the city at most (garbage: units a day it sends for the city to process). */
  buy: Record<DealResource, number>;
  /** Its workers who'd take a job in the city, and its jobs open to the city's unemployed. */
  commutersIn: number;
  jobsOut: number;
  /** Its residents shopping in the city each day, and visitors passing through to it. */
  shoppers: number;
}

export interface NeighbourKindDef {
  kind: NeighbourKind;
  /** Character, for the region panel. */
  label: string;
  blurb: string;
  /** Starting population range, and monthly growth drift bounds. */
  startPop: [number, number];
  trend: [number, number];
  per: PerThousand;
}

export const NEIGHBOUR_KIND: Record<NeighbourKind, NeighbourKindDef> = {
  industrial: {
    kind: 'industrial',
    label: 'Industrial town',
    blurb: 'Mills and power stations: spare power to sell, a big landfill, and jobs for your unemployed.',
    startPop: [16_000, 26_000],
    trend: [-0.012, 0.01],
    per: {
      sell: { power: 40, water: 0, garbage: 30 },
      buy: { power: 0, water: 15, garbage: 0 },
      commutersIn: 8,
      jobsOut: 30,
      shoppers: 4,
    },
  },
  suburb: {
    kind: 'suburb',
    label: 'Commuter suburb',
    blurb: 'Homes and gardens: plenty of workers looking for jobs, and water to spare from its reservoir.',
    startPop: [20_000, 34_000],
    trend: [-0.006, 0.016],
    per: {
      sell: { power: 0, water: 30, garbage: 0 },
      buy: { power: 20, water: 0, garbage: 0 },
      commutersIn: 35,
      jobsOut: 6,
      shoppers: 10,
    },
  },
  resort: {
    kind: 'resort',
    label: 'Resort town',
    blurb: 'Hotels and a promenade: it buys power and water, sends garbage to process, and shoppers.',
    startPop: [7_000, 13_000],
    trend: [-0.01, 0.014],
    per: {
      sell: { power: 0, water: 0, garbage: 0 },
      buy: { power: 30, water: 25, garbage: 25 },
      commutersIn: 5,
      jobsOut: 12,
      shoppers: 20,
    },
  },
};

export const REGION = {
  /** Deal prices, dollars a month per unit of the contract (MW, water units, garbage units a day). */
  price: {
    buy: { power: 3, water: 3, garbage: 15 },
    sell: { power: 2, water: 2, garbage: 12 },
  } as Record<DealDirection, Record<DealResource, number>>,
  /** A neighbour's trend drifts by up to this much a month. */
  trendStep: 0.004,
  /** Minutes of regional highway between a neighbour and the city's edge. */
  approachMinutes: 12,
  /** Of regional commuters and shoppers, the share that takes the train when a station serves the regional line. */
  railShare: 0.3,
  /** Winter heating eats into an industrial town's spare power (share at the coldest). */
  winterPowerCut: 0.3,
  /** Resort shoppers: more in summer, fewer in winter. */
  resortSeason: { spring: 1, summer: 1.5, autumn: 0.9, winter: 0.6 },
  /**
   * Neighbours' commuters and shoppers come as the city draws them: this share at first, rising to
   * all of them at `attractJobs` jobs (commuters) and `attractShops` shop jobs (shoppers).
   */
  attractBase: 0.1,
  /** Of the residents without a job in town, the share who'll take one in a neighbour. */
  outShare: 0.5,
  attractJobs: 8_000,
  attractShops: 2_000,
  /** Neighbours never shrink below this. */
  minPopulation: 2_000,
};

const PREFIX = [
  'Ash',
  'Bram',
  'Cal',
  'Dun',
  'Elm',
  'Fen',
  'Gold',
  'Hart',
  'Ivy',
  'Kest',
  'Lark',
  'Marl',
  'Nor',
  'Oak',
  'Pen',
  'Quar',
  'Rook',
  'Stan',
  'Thorn',
  'Wil',
];
const SUFFIX = [
  'ford',
  'bury',
  'wick',
  'ley',
  'ton',
  'field',
  'gate',
  'holm',
  'stead',
  'by',
  'combe',
  'well',
];
/** Resorts get seaside or spa endings. */
const RESORT_SUFFIX = ['mouth', 'sands', '-on-Sea', ' Spa', 'haven', 'cliffe'];

/** An original town name from two random picks (`pick(n)` returns 0..n-1). */
export function neighbourName(kind: NeighbourKind, pick: (n: number) => number): string {
  const p = PREFIX[pick(PREFIX.length)]!;
  const list = kind === 'resort' ? RESORT_SUFFIX : SUFFIX;
  return `${p}${list[pick(list.length)]}`;
}
