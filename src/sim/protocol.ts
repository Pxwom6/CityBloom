import type { ScenarioSummary } from './systems/scenario';
import type { Crater, Disaster } from './systems/disasters';
/** Typed messages between the main thread and the sim worker. DESIGN.md §1.4. */
import type { TerrainParams } from './terrain/generate';
import type { Command, CommandResult } from './commands';
import type { GameOptions } from './state';
import type { SaveFile } from './save';
import type { Speed } from './time';
import type { RoadTypeId } from '../data/roads';
import type { Factor } from './systems/demand';
import type { UtilityStats } from './systems/utilities';
import type { OverlayMap } from './systems/overlays';
import type { TripSample } from './systems/traffic';
import type { BusStop } from './systems/transit';
import type { Leg } from './systems/graph';
import type { ServiceKind } from '../data/civic';

export interface CityStats {
  tick: number;
  treasury: number;
  cityName: string;
  population: number;
  undoAvailable: boolean;
  /** Undo and redo (M14): whether there's a step, and what it was ("road", "bulldozing"). */
  redoAvailable: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  jobs: number;
  jobsFilled: number;
  unemployed: number;
  workers: number;
  approval: number;
  demand: { R: number; C: number; I: number };
  demandFactors: { R: Factor[]; C: Factor[]; I: Factor[] };
  buildings: number;
  abandoned: number;
  highwayConnected: boolean;
  netMonthly: number;
  loans: number;
  bankrupt: boolean;
  negativeHours: number;
  utilities: UtilityStats;
  unlockAll: boolean;
  /** Highest population reached (what unlocks go by) and the milestone index. */
  peak: number;
  milestone: number;
  /** Achievements earned (id → tick), visitors a day, policies in force. */
  achievements: Record<string, number>;
  visitors: number;
  policies: string[];
  civics: number;
  vehicles: number;
  /** Average commute of employed residents, seconds. */
  avgCommute: number;
  /** Bus trips per day across all lines. */
  busRiders: number;
  /** Share of the workforce educated to level 1 and 2 (big project requirements, M17). */
  eduWorkforce: [number, number];
  /** Elections (M17): the next vote, the campaign, promises made, a term in force, the last result. */
  election: ElectionSummary | null;
  /** The scenario being played (M18), or null. */
  scenario: ScenarioSummary | null;
}

export interface ElectionSummary {
  /** Month (since the city began) of the next vote, and months to go. */
  nextMonth: number;
  monthsToVote: number;
  campaign: boolean;
  promises: { id: string; kept: boolean }[];
  /** Vote share if the vote were held now. */
  projected: number;
  term: { won: boolean; until: number } | null;
  last: { tick: number; share: number; won: boolean; promises: { id: string; kept: boolean }[] } | null;
}

export interface CivicDetails {
  id: number;
  def: string;
  name: string;
  category: string;
  blurb: string;
  upkeep: number;
  funding: number;
  access: boolean;
  produces: { utility: string; output: number }[];
  polluted: boolean;
  garbage: {
    /** Trucks it runs at current funding, out now, and extra ones bought (of the most it can take). */
    trucks: number;
    out: number;
    extraTrucks: number;
    maxExtraTrucks: number;
    stored: number;
    storage: number;
    processedToday: number;
    process: number;
    /** Units its trucks brought back today so far and yesterday, and all sites' yesterday. */
    collectedToday: number;
    collectedLastDay: number;
    collectedAllLastDay: number;
    /** Garbage the whole city makes a day, and what's lying on the streets (and at how many buildings with piles). */
    producedPerDay: number;
    backlog: number;
    piles: number;
    /** Its trucks' rounds yesterday (or today so far): hours out, stops and load per round. */
    roundHours: number;
    stopsPerRound: number;
    loadPerRound: number;
    truckCapacity: number;
  } | null;
  service: {
    kind: string;
    /** Vehicles the station can run at current funding, and how many are out now. */
    vehicles: number;
    out: number;
    /** Occupied buildings this building covers well (≥ 50%). */
    reach: number;
    /** Schools: seats at current funding and seats filled. */
    seats: number;
    used: number;
  } | null;
  /**
   * Bus and tram depots: their line; stations (M20): the train line they're on. `here` is riders a
   * day getting on or off at a station; `why` says why there's no line yet.
   */
  transit: {
    mode: 'bus' | 'tram' | 'train';
    stops: number;
    buses: number;
    loopMinutes: number;
    headwayMinutes: number;
    capacity: number;
    riders: number;
    full: boolean;
    here: number;
    why: string | null;
  } | null;
  /** Rail freight terminals (M20): linked to the regional railway, and truckloads a day onto trains. */
  railFreight: { linked: boolean; trucks: number } | null;
  refund: number;
  /** Mines and wells: units a day and the share of the deposit left; landmarks and hotels. */
  special:
    | { kind: 'resource'; perDay: number; left: number }
    | { kind: 'tourism'; draw: number; rooms: number }
    | null;
  /** Big projects (M17): the stages, how far along it is, and its perk. */
  project: {
    stages: { name: string; months: number; cost: number }[];
    /** Stage in hand (stages.length once open), months into it, and waiting for money. */
    stage: number;
    months: number;
    waiting: boolean;
    monthsLeft: number;
    perk: string;
    /** Match days or launches, when open. */
    nextEvent: string | null;
  } | null;
}

export interface BudgetReport {
  treasury: number;
  /** Ledger for the month so far (signed integer dollars per category). */
  month: Record<string, number>;
  /** Monthly rates at current conditions. */
  projection: Record<string, number>;
  history: { month: number; lines: Record<string, number>; treasury: number }[];
  taxes: Record<'R' | 'C' | 'I', [number, number, number]>;
  funding: Record<string, number>;
  loans: {
    id: number;
    principal: number;
    annualRate: number;
    months: number;
    payment: number;
    balance: number;
  }[];
  negativeHours: number;
  bankrupt: boolean;
  monthStartTreasury: number;
}

/** Render-relevant building fields (details come from the `building` query). */
export interface BuildingData {
  id: number;
  def: string;
  zone: number;
  density: number;
  wealth: number;
  level: number;
  x: number;
  z: number;
  y: number;
  angle: number;
  side: 1 | -1;
  w: number;
  d: number;
  state: number;
  progress: number;
  variant: number;
  /**
   * Bit flags: 1 no highway link, 2 no power, 4 no water, 8 no sewage, 16 garbage, 32 closed,
   * 64 polluted water, 128 on fire, 256 sick without care, 512 smog, 1024 flooded.
   */
  flags: number;
  /** Fire intensity 0..1 (tenths). */
  fire: number;
}

export interface BuildingDetails {
  id: number;
  name: string;
  zone: number;
  density: number;
  wealth: number;
  level: number;
  state: number;
  progress: number;
  pop: number;
  cap: number;
  employed: number;
  commute: number;
  shop: number;
  happiness: number;
  base: number;
  factors: Factor[];
  distress: number;
  abandonAt: number;
  isResidential: boolean;
  connected: boolean;
  born: number;
  power: number;
  water: number;
  sewage: number;
  polluted: number;
  garbage: number;
  closed: boolean;
  coverage: { fire: number; police: number; health: number; education: number; park: number };
  crime: number;
  fire: number;
  /** Residents: sick now, share of them in care, average education (0..3); air pollution here. */
  sick: number;
  treated: number;
  edu: number;
  air: number;
}

export interface NodeData {
  id: number;
  x: number;
  z: number;
  /** Roundabout ring radius (M19). */
  roundabout?: number;
}
export interface SegmentData {
  id: number;
  a: number;
  b: number;
  cx: number;
  cz: number;
  type: RoadTypeId;
  left: number;
  right: number;
  /** Viaduct deck heights (M13), see RoadSegment.deck. */
  deck?: number[];
  /** One-way direction (M19), see RoadSegment.oneway. */
  oneway?: 1 | -1;
  /** Tram track (M20). */
  tram?: true;
}
export interface BlockData {
  id: number;
  seg: number;
  side: 1 | -1;
  s0: number;
  cols: number;
  zone: Uint8Array;
  valid: Uint8Array;
  bld: Int32Array;
}
export interface NetDiff {
  nodes: NodeData[];
  segments: SegmentData[];
  blocks: BlockData[];
  removedNodes: number[];
  removedSegments: number[];
  removedBlocks: number[];
}

/** Everything the main thread needs to build its mirror and the scene. */
export interface Snapshot {
  options: GameOptions;
  terrainParams: TerrainParams;
  heights: Float32Array;
  /** Earthworks (M13): height change at each sample, on top of the seed's terrain. */
  terrainDelta: Float32Array;
  trees: Uint8Array;
  groundwater: Uint8Array;
  ore: Uint8Array;
  oil: Uint8Array;
  stats: CityStats;
  net: { nodes: NodeData[]; segments: SegmentData[]; blocks: BlockData[] };
  highway: { outside: number; connect: number; segment: number };
  railway: { outside: number; connect: number; segment: number } | null;
  buildings: BuildingData[];
  civics: CivicData[];
  vehicles: VehicleData[];
  traffic: TrafficData;
  transit: TransitData;
  disasters: DisasterData;
  /** Districts (M21). */
  districts: DistrictData;
}

export interface CivicData {
  id: number;
  def: string;
  x: number;
  z: number;
  y: number;
  angle: number;
  side: 1 | -1;
  access: boolean;
  /** Landfill fill level 0..1. */
  fill: number;
  out: number;
  variant: number;
  /** Hours until disaster damage is repaired (offline until then), and under flood water now. */
  damage: number;
  flooded: boolean;
  /** Add-on modules installed. */
  modules: string[];
  /** Big projects (M17): the stage under construction, absent once finished. */
  stage?: number;
}

export interface VehicleData {
  id: number;
  kind: string;
  phase: 'out' | 'work' | 'back';
  leg: number;
  t: number;
  /** Legs with their speed in metres per tick. */
  legs: { seg: number; s0: number; s1: number; v: number }[];
}

export interface FrameDiff {
  tick: number;
  stats: CityStats;
  /** Tree density changes: raster index → new density. */
  trees?: { idx: number[]; val: number[] };
  /** Earthworks (M13): terrain samples whose height changed, their new height and delta. */
  terrain?: { idx: number[]; h: number[]; d: number[] };
  net?: NetDiff;
  buildings?: { upserts: BuildingData[]; removed: number[] };
  civics?: { upserts: CivicData[]; removed: number[] };
  /** Full list of active service vehicles whenever any changed. */
  vehicles?: VehicleData[];
  events?: { kind: string; id: number; info?: Record<string, number | string> }[];
  traffic?: TrafficData;
  transit?: TransitData;
  disasters?: DisasterData;
  districts?: DistrictData;
}

/** Disasters under way and what they've left: damaged or flooded roads, craters. */
export interface DisasterData {
  active: Disaster[];
  /** Damaged road segments (impassable until repaired) and segments under flood water. */
  damaged: number[];
  flooded: number[];
  craters: Crater[];
}

/** Traffic for the client: daily volumes per segment and sampled trips for visible vehicles. */
export interface TrafficData {
  vol: [number, number][];
  trips: TripSample[];
  /** Capacity factor from road maintenance funding. */
  capScale: number;
}

/** Bus stops and lines for the client. */
export interface TransitData {
  stops: BusStop[];
  lines: {
    /** Buses, trams or trains (M20). */
    mode: 'bus' | 'tram' | 'train';
    shuttle: boolean;
    depot: number;
    stops: number[];
    /** Metres along `legs` to each stop (M20). */
    stopDist: number[];
    legs: Leg[];
    /** Seconds round the loop (there and back for a shuttle), and between vehicles. */
    loopTime: number;
    headway: number;
    /** Passengers an hour it can carry past any point. */
    capacity: number;
    buses: number;
    riders: number;
    /** Share of would-be riders who fit (1 unless it's full). */
    load: number;
  }[];
  /** Riders a day getting on or off at each stop or station (M20), by stop or station id. */
  use: [number, number][];
  /**
   * Rail freight (M20): each terminal loading trains, the truckloads it moves a day and the track
   * from the regional railway's link (at the map edge) to its siding, for the visible freight trains.
   */
  freight: { id: number; trucks: number; legs: Leg[] }[];
}

export interface WorkerPerf {
  tickMsAvg: number;
  tickMsMax: number;
  ticksPerSecond: number;
  droppedTicks: number;
}

export type Query =
  | { type: 'hash' }
  | { type: 'summary' }
  | { type: 'building'; id: number }
  | { type: 'budget' }
  /** City history (M16): the recorded figures, their spacing and the timeline events. */
  | { type: 'chronicle' }
  | { type: 'civic'; id: number }
  | { type: 'overlay'; map: OverlayMap }
  | { type: 'coveragePreview'; def: string; x: number; z: number; angle: number; side: 1 | -1 }
  | { type: 'advisors' }
  | { type: 'thoughts'; count?: number }
  /** Coverage samples along every road for one service (for the coverage data maps). */
  | { type: 'coverageRoads'; kind: ServiceKind }
  /** Districts' figures and budgets (M21). */
  | { type: 'districts' };

/** Districts (M21) for the client: each district, and the district of every raster cell. */
export interface DistrictData {
  list: { id: number; name: string; color: number; policies: string[] }[];
  cells: Uint8Array;
}

/** One district's figures for its panel (M21); id 0 is everywhere outside a district. */
export interface DistrictReport {
  id: number;
  population: number;
  jobs: number;
  workers: number;
  happiness: number;
  landValue: number;
  buildings: number;
  cells: number;
  /** Monthly: taxes its homes and businesses pay, upkeep of the civic buildings in it, its policies. */
  taxes: number;
  upkeep: number;
  policies: number;
}

export type MainToWorker =
  | { type: 'init'; options: Partial<GameOptions>; testMode?: boolean }
  | { type: 'load'; save: SaveFile; testMode?: boolean }
  | { type: 'command'; id: number; cmd: Command }
  | { type: 'preview'; id: number; cmd: Command }
  | { type: 'query'; id: number; q: Query }
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'advance'; id: number; ticks: number }
  | { type: 'save'; id: number };

export type WorkerToMain =
  | { type: 'ready'; snapshot: Snapshot }
  | { type: 'frame'; diff: FrameDiff; perf: WorkerPerf; speed: Speed }
  | { type: 'reply'; id: number; result: unknown }
  | { type: 'loadFailed'; message: string }
  | { type: 'error'; message: string };

export type { CommandResult };
