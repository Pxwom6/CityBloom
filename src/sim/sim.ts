import { fnv1a } from './hash';
import { Rng } from './rng';
import { fail, ok, type Command, type CommandLogEntry, type CommandResult } from './commands';
import { RNG_STREAMS, DEFAULT_OPTIONS, type GameOptions, type RngStream, type SimState } from './state';
import { Terrain } from './terrain/terrain';
import { SAVE_VERSION, makeSaveFile, readSaveFile, stateToCanonicalJson, type SaveFile } from './save';
import type {
  BlockData,
  BudgetReport,
  CivicData,
  CivicDetails,
  DisasterData,
  VehicleData,
  BuildingData,
  CityStats,
  FrameDiff,
  NetDiff,
  NodeData,
  SegmentData,
  Snapshot,
  TrafficData,
  TransitData,
  BuildingDetails,
  Query,
} from './protocol';
import { checkInvariants } from './invariants';
import { Network, type ZoneBlock } from './world/network';
import {
  FULL_SCOPE,
  HISTORY_LIMIT,
  ZONING_SCOPE,
  applyEdit,
  capture,
  diff,
  merge,
  type Edit,
  type Scope,
  type Touched,
} from './history';
import { buildRoad, bulldoze, upgradeRoad } from './actions/roads';
import { zone } from './actions/zoning';
import { v2 } from './geom';
import { GRID_RES, HEIGHT_RES } from '../data/world';
import {
  BState,
  accessOf,
  buildingCapacity,
  defOf,
  footprint,
  placeOnLot,
  setLotCells,
  type Building,
} from './world/buildings';
import { RoadGraph } from './systems/graph';
import { SpatialHash } from './world/spatial';
import { seatHeight } from './world/earthworks';
import { computeTotals, emptyTotals } from './systems/totals';
import { emptyDemand, updateDemand } from './systems/demand';
import { updateLandValue, waterDistance } from './systems/landValue';
import { growthPass, lifecycle } from './systems/growth';
import { happinessFactors, updateHappiness } from './systems/happiness';
import { MatchRound } from './systems/commute';
import { advise } from './systems/advisors';
import { thoughts } from './systems/thoughts';
import { deckAt, deckProfile, viaductDeck, type DeckProfile } from './world/bridge';
import { computeLines, emptyTransit, placeStop, relocateStops, type BusLine } from './systems/transit';
import { congestedEdgeCosts, congestedSeconds, hourShare, segVC, type TripSample } from './systems/traffic';
import { GROWTH, HAPPINESS, TRANSIT } from '../data/balance';
import { ZONE_I, ZONE_R } from '../data/zones';
import { HOURLY_AT, MATCH_SLICES, TICKS_PER_HOUR, dateOf, isMonthStart } from './time';
import {
  addModule,
  civicCapacity,
  civicDef,
  civicRect,
  civicUpkeep,
  civicVehicles,
  findAccess,
  placeCivic,
  type Civic,
} from './world/civic';
import { civicOutput, emptyUtilityStats, updateUtilities, utilityConsequences } from './systems/utilities';
import { dispatchGarbage, garbageHour, garbageRate, rollCollectionDay, trucksFor } from './systems/garbage';
import { segSpeed, stepVehicles } from './systems/vehicles';
import { computeOverlay } from './systems/overlays';
import {
  applyCoverageFields,
  applyServiceLoads,
  computeCoverage,
  coverageNear,
  coveragePreview,
  sampleAt,
  stationCoverage,
  type Coverage,
} from './systems/services';
import { ignite, incidentsHour, incidentsTick } from './systems/incidents';
import { disastersHour, disastersTick, floodedSegments, startDisaster } from './systems/disasters';
import { progressHour } from './systems/progress';
import { extractionPerDay, specialisationsHour } from './systems/specialisations';
import { POLICY, type PolicyId } from '../data/policies';
import { decayCrime, splatField } from './systems/pollution';
import type { ServiceKind } from '../data/civic';
import { CIVIC, GARBAGE, UTILITIES, VEHICLE_SPEED_SCALE } from '../data/civic';
import { MODULE } from '../data/modules';
import { fieldAt, updateAirPollution, updateGroundPollution } from './systems/pollution';
import { healthHour } from './systems/health';
import { rectsOverlap, type ORect } from './geom';
import {
  book,
  closeMonth,
  defaultEconomy,
  economyHour,
  monthlyRates,
  repayLoan,
  setFunding,
  setTax,
  takeLoan,
} from './systems/economy';
import { DIFFICULTY, SANDBOX_FUNDS, fundingEffect, type Dept } from '../data/economy';

/** The highway connection node sits this far inside the west edge. */
export const HIGHWAY_CONNECT_X = 24;

export type SimEvent = {
  kind:
    | 'fire'
    | 'crime'
    | 'death'
    | 'destroyed'
    | 'fireOut'
    | 'crimeStopped'
    | 'patientSaved'
    | 'built'
    | 'abandoned'
    | 'upgrading'
    | 'demolished'
    | 'loanRepaid'
    | 'moneyNegative'
    | 'bankrupt'
    | 'closed'
    | 'civicBuilt'
    | 'civicRemoved'
    | 'disaster'
    | 'disasterOver'
    | 'civicDamaged'
    | 'civicRepaired'
    | 'civicDestroyed'
    | 'roadRepaired'
    | 'decayed'
    | 'collapsed'
    | 'milestone'
    | 'achievement';
  id: number;
  /** Extra details for the notification (disaster reports, destroyed buildings). */
  info?: Record<string, number | string>;
};

/**
 * The simulation. Pure TypeScript, deterministic, runs in the worker and headlessly in tests.
 * All mutation goes through `dispatch` (commands) and `step` (one fixed tick).
 */
export class Sim {
  state: SimState;
  readonly terrain: Terrain;
  readonly rng: Record<RngStream, Rng>;
  readonly net: Network;
  /** Every applied command with the tick it was applied at (for replays). Not part of the hash. */
  readonly log: CommandLogEntry[] = [];
  /** When true, invariants are checked after every tick and violations throw. */
  testMode = false;
  /** Things that happened since the last frame (for notifications and sounds). Not saved. */
  events: SimEvent[] = [];

  private dirtyTrees = new Set<number>();
  private dirtyTerrain = new Set<number>();
  private dirtyBuildings = new Set<number>();
  private removedBuildings = new Set<number>();
  private graphCache: RoadGraph | null = null;
  private blockOrderCache: number[] | null = null;
  private highwayComponent = -1;
  private waterDistCache: Float32Array | null = null;
  readonly bldHash = new SpatialHash(32);
  readonly civHash = new SpatialHash(64);
  private vehiclesDirty = true;
  /** Sampled trips for visible traffic (derived each assignment round; not saved). */
  tripSamples: TripSample[] = [];
  private trafficDirty = true;
  private congestedCache: { key: string; costs: Float64Array } | null = null;
  private flagCache = new Map<number, number>();
  private dirtyCivics = new Set<number>();
  private removedCivics = new Set<number>();

  private constructor(state: SimState, terrain: Terrain) {
    this.state = state;
    this.terrain = terrain;
    terrain.applyDelta(state.terrainDelta);
    this.rng = {} as Record<RngStream, Rng>;
    for (const s of RNG_STREAMS) this.rng[s] = new Rng(state.rng[s]);
    this.net = new Network(state.net, terrain, {
      nextId: () => this.state.nextId++,
      footprintBlocked: (rect) => this.civicBlocks(rect),
      buildingMoved: (id, block, col) => this.buildingMoved(id, block, col),
      buildingLost: (id) => this.removeBuilding(id),
    });
    for (const b of state.buildings.values()) this.indexBuilding(b);
    for (const c of state.civics.values()) this.indexCivic(c);
  }

  static create(opts: Partial<GameOptions> = {}): Sim {
    const options: GameOptions = { ...DEFAULT_OPTIONS, ...opts };
    const terrain = new Terrain(options.seed, options.preset, options.terrain);
    const rng = {} as SimState['rng'];
    for (const s of RNG_STREAMS) rng[s] = Rng.fromSeed(`${options.seed}:${s}`).getState();
    const state: SimState = {
      version: SAVE_VERSION,
      options,
      tick: 0,
      nextId: 1,
      rng,
      treasury: options.sandbox ? SANDBOX_FUNDS : DIFFICULTY[options.difficulty].funds,
      cityName: options.cityName,
      trees: terrain.initialTrees.slice(),
      net: { nodes: new Map(), segments: new Map(), blocks: new Map() },
      highway: { outside: 0, connect: 0, segment: 0 },
      buildings: new Map(),
      totals: emptyTotals(),
      demand: emptyDemand(),
      landValue: new Float32Array(GRID_RES * GRID_RES),
      cursors: { growth: 0, matchRound: 0 },
      economy: defaultEconomy(options.sandbox ? SANDBOX_FUNDS : DIFFICULTY[options.difficulty].funds),
      civics: new Map(),
      vehicles: new Map(),
      groundPollution: new Float32Array(GRID_RES * GRID_RES),
      utilityStats: emptyUtilityStats(),
      unlockAll: false,
      burning: [],
      incidents: new Map(),
      crime: new Float32Array(GRID_RES * GRID_RES),
      terrainDelta: new Float32Array(HEIGHT_RES * HEIGHT_RES),
      traffic: new Map(),
      transit: emptyTransit(),
      airPollution: new Float32Array(GRID_RES * GRID_RES),
      disasters: [],
      roadDamage: new Map(),
      craters: [],
      progress: { peak: 0, milestone: 0, achievements: {}, recoverTo: 0 },
      policies: [],
      tourism: { visitors: 0, overnight: 0 },
    };
    const sim = new Sim(state, terrain);
    sim.buildHighway();
    updateLandValue(sim, true);
    updateDemand(sim);
    return sim;
  }

  static fromSave(save: SaveFile): Sim {
    const state = readSaveFile(save);
    const terrain = new Terrain(state.options.seed, state.options.preset, state.options.terrain);
    return new Sim(state, terrain);
  }

  private buildHighway(): void {
    const hw = this.terrain.gen.params.highway;
    const outside = this.net.createNode(hw.lineX, hw.connectZ);
    const connect = this.net.createNode(HIGHWAY_CONNECT_X, hw.connectZ);
    const seg = this.net.createSegment(
      outside.id,
      connect.id,
      v2((hw.lineX + HIGHWAY_CONNECT_X) / 2, hw.connectZ),
      'highway',
      { zoned: false },
    );
    this.state.highway = { outside: outside.id, connect: connect.id, segment: seg.id };
  }

  get tick(): number {
    return this.state.tick;
  }

  // ---------------------------------------------------------------- money (DESIGN §3.5)

  /** One-off expense booked to the ledger. */
  spend(amount: number, category: string): void {
    book(this, category, -Math.round(amount));
  }

  /** One-off income booked to the ledger. */
  earn(amount: number, category: string): void {
    book(this, category, Math.round(amount));
  }

  /** Tax rate (percent) for a zone and wealth level. */
  taxRate(zone: 'R' | 'C' | 'I', wealth: number): number {
    return this.state.economy.taxes[zone][wealth] ?? 9;
  }

  /** Monthly upkeep at 100 % funding of every department's civic buildings. */
  /** Running costs scale with difficulty. */
  upkeepScale(): number {
    return DIFFICULTY[this.state.options.difficulty]?.upkeep ?? 1;
  }

  departmentUpkeep(): Partial<Record<Dept, number>> {
    const out: Partial<Record<Dept, number>> = {};
    for (const c of this.state.civics.values()) {
      const d = civicDef(c);
      out[d.dept] = (out[d.dept] ?? 0) + civicUpkeep(c);
    }
    if (this.state.transit.stops.size)
      out.transit = (out.transit ?? 0) + this.state.transit.stops.size * TRANSIT.stopUpkeep;
    return out;
  }

  /** Speed factor (≤ 1) on a segment from its traffic at the current hour. */
  congestionFactor(segId: number): number {
    const t0 = this.graph().segSeconds.get(segId) ?? 1;
    return t0 / congestedSeconds(t0, segVC(this, segId, hourShare(this.state.tick)));
  }

  /** Congested seconds per graph edge at the current hour (cached per hour and assignment). */
  congestedCosts(): Float64Array {
    const g = this.graph();
    const key = `${Math.floor(this.state.tick / TICKS_PER_HOUR)}:${this.state.cursors.matchRound}:${g.size}:${g.cost.length}`;
    if (this.congestedCache?.key !== key)
      this.congestedCache = { key, costs: congestedEdgeCosts(this, g, hourShare(this.state.tick)) };
    return this.congestedCache.costs;
  }

  private deckCache = new Map<number, DeckProfile | null>();

  /** Bridge deck profile of a segment (null on dry land). Segment geometry never changes per id. */
  deck(segId: number): DeckProfile | null {
    let d = this.deckCache.get(segId);
    if (d === undefined) {
      const seg = this.state.net.segments.get(segId);
      d = !seg
        ? null
        : seg.deck
          ? viaductDeck(seg.deck, this.net.curve(segId), (x, z) => this.terrain.heightAt(x, z))
          : deckProfile(this.net.curve(segId), (x, z) => this.terrain.heightAt(x, z));
      this.deckCache.set(segId, d);
    }
    return d;
  }

  /** New volumes and trip samples are ready for the client. */
  trafficChanged(): void {
    this.trafficDirty = true;
    this.linesCache = null;
    this.peakCache = null;
  }

  private peakCache: Float64Array | null = null;

  /** Rush-hour seconds per graph edge (cached until roads or traffic change). */
  peakCosts(): Float64Array {
    if (!this.peakCache || this.peakCache.length !== this.graph().cost.length)
      this.peakCache = congestedEdgeCosts(this, this.graph(), 1);
    return this.peakCache;
  }

  private linesCache: BusLine[] | null = null;
  private transitDirty = true;

  /** Bus lines (cached; a pure function of roads, depots, stops, funding and traffic). */
  lines(): BusLine[] {
    if (!this.linesCache) this.linesCache = computeLines(this);
    return this.linesCache;
  }

  /** Stops or depots changed: rebuild the lines and tell the client. */
  transitChanged(): void {
    this.linesCache = null;
    this.transitDirty = true;
  }

  transitData(): TransitData {
    const t = this.state.transit;
    return {
      stops: [...t.stops.values()].sort((a, b) => a.id - b.id).map((x) => ({ ...x })),
      lines: this.lines().map((l) => ({
        depot: l.depot,
        stops: [...l.stops],
        legs: l.legs.map((x) => ({ ...x })),
        loopTime: l.loopTime,
        buses: l.buses,
        riders: t.riders.get(l.depot) ?? 0,
      })),
    };
  }

  trafficData(): TrafficData {
    return {
      vol: [...this.state.traffic].sort((a, b) => a[0] - b[0]),
      trips: this.tripSamples.map((t) => ({ ...t, legs: t.legs.map((l) => ({ ...l })) })),
      capScale: 0.8 + 0.2 * Math.min(1, this.fundingEff('roads')),
    };
  }

  groundPollutionAt(x: number, z: number): number {
    return fieldAt(this.state.groundPollution, x, z);
  }

  crimeAt(x: number, z: number): number {
    return fieldAt(this.state.crime, x, z);
  }

  /** Crime committed near (x, z): raise the crime raster in a small radius. */
  addCrime(x: number, z: number, amount: number): void {
    splatField(this.state.crime, x, z, amount * 12, 3);
    for (let k = 0; k < this.state.crime.length; k++) if (this.state.crime[k]! > 1) this.state.crime[k] = 1;
  }

  private coverageCache: Coverage | null = null;

  /** Per-node service coverage; cached, and dropped whenever roads, services or funding change. */
  get coverage(): Coverage {
    if (!this.coverageCache) this.coverageCache = computeCoverage(this);
    return this.coverageCache;
  }

  serviceCoverageNear(x: number, z: number, kind: ServiceKind): number {
    return coverageNear(this, this.coverage, x, z, kind);
  }

  /** Effectiveness (0..1.25) of a department at its current funding. */
  fundingEff(dept: Dept): number {
    return fundingEffect(this.state.economy.funding[dept] / 100);
  }

  avgTax(zone: 'R' | 'C' | 'I'): number {
    return (this.taxRate(zone, 0) + this.taxRate(zone, 1) + this.taxRate(zone, 2)) / 3;
  }

  // ---------------------------------------------------------------- derived caches

  /** Is a policy in force? */
  policy(id: PolicyId): boolean {
    return this.state.policies.includes(id);
  }

  /** Is something that unlocks at `population` available? (Unlocks keep once reached.) */
  isUnlocked(population: number): boolean {
    return this.state.unlockAll || this.reached(population);
  }

  /**
   * Has the city itself grown this big (sandbox counts)? Zone densities go by this: the unlock-all
   * cheat opens up things to build, not how tall the city grows.
   */
  reached(population: number): boolean {
    const s = this.state;
    return s.options.sandbox || Math.max(s.progress.peak, s.totals.population) >= population;
  }

  /** Roads nothing can drive along right now: damaged by a disaster, or under flood water. */
  blockedSegments(): Set<number> {
    if (!this.blockedCache) {
      const out = floodedSegments(this);
      for (const id of this.state.roadDamage.keys()) out.add(id);
      this.blockedCache = out;
    }
    return this.blockedCache;
  }

  private blockedCache: Set<number> | null = null;
  private disastersDirty = true;

  /** Roads were damaged, repaired, flooded or drained: routing and everything built on it changes. */
  roadsBlockedChanged(): void {
    this.blockedCache = null;
    this.graphCache = null;
    this.coverageCache = null;
    this.peakCache = null;
    this.transitChanged();
    this.disastersDirty = true;
  }

  /** Disasters started, ended or left a crater: resend them to the client. */
  disastersChanged(): void {
    this.disastersDirty = true;
  }

  /** Flood levels moved: recompute which roads are under water, and reroute if that changed. */
  floodChanged(): void {
    const prev = this.blockedCache;
    this.blockedCache = null;
    const now = this.blockedSegments();
    if (!prev || prev.size !== now.size || [...now].some((id) => !prev.has(id))) this.roadsBlockedChanged();
    this.disastersDirty = true;
  }

  /** A civic building went offline or came back (disaster damage, floods, repairs). */
  civicStatusChanged(id: number): void {
    this.coverageCache = null;
    this.transitChanged();
    this.dirtyCivics.add(id);
  }

  /** Road surface height (bridge deck or ground) at arc length `s` of a segment. */
  roadHeightAt(segId: number, s: number, x: number, z: number): number {
    const g = Math.max(0, this.terrain.heightAt(x, z));
    const d = this.deck(segId);
    return d ? Math.max(g, deckAt(d, s)) : g;
  }

  graph(): RoadGraph {
    if (!this.graphCache) {
      this.graphCache = new RoadGraph(this.net, this.blockedSegments());
      this.highwayComponent = this.graphCache.componentOfNode(this.state.highway.connect);
    }
    return this.graphCache;
  }

  private fullGraphCache: RoadGraph | null = null;
  private fullHighwayComponent = -1;

  /**
   * The network as built, ignoring temporary closures (damaged or flooded roads): whether a place is
   * linked to the highway at all. Routing uses `graph()`, which leaves closed roads out.
   */
  private fullGraph(): RoadGraph {
    if (!this.blockedSegments().size) {
      const g = this.graph();
      this.fullHighwayComponent = this.highwayComponent;
      return g;
    }
    if (!this.fullGraphCache) {
      this.fullGraphCache = new RoadGraph(this.net);
      this.fullHighwayComponent = this.fullGraphCache.componentOfNode(this.state.highway.connect);
    }
    return this.fullGraphCache;
  }

  isSegmentConnected(segId: number): boolean {
    const seg = this.state.net.segments.get(segId);
    if (!seg) return false;
    const g = this.fullGraph();
    return g.componentOfNode(seg.a) === this.fullHighwayComponent;
  }

  isBuildingConnected(b: Building): boolean {
    const block = this.state.net.blocks.get(b.block);
    return !!block && this.isSegmentConnected(block.seg);
  }

  highwayConnectedBlocks(): number {
    let n = 0;
    for (const b of this.state.net.blocks.values()) if (this.isSegmentConnected(b.seg)) n++;
    return n;
  }

  blockOrder(): number[] {
    if (!this.blockOrderCache) this.blockOrderCache = [...this.state.net.blocks.keys()].sort((a, b) => a - b);
    return this.blockOrderCache;
  }

  waterDist(): Float32Array {
    if (!this.waterDistCache) this.waterDistCache = waterDistance(this);
    return this.waterDistCache;
  }

  markNetworkChanged(): void {
    this.graphCache = null;
    this.fullGraphCache = null;
    this.blockedCache = null;
    this.disastersDirty = true;
    // A damaged road that was bulldozed or rebuilt is no longer damaged.
    for (const id of [...this.state.roadDamage.keys()])
      if (!this.state.net.segments.has(id)) this.state.roadDamage.delete(id);
    this.coverageCache = null;
    this.peakCache = null;
    this.transitChanged();
    relocateStops(this);
    this.blockOrderCache = null;
    // Civic buildings re-attach to whatever road now runs past their front.
    for (const c of this.state.civics.values()) {
      const acc = findAccess(this, c);
      const changed = (acc?.seg ?? -1) !== (c.access?.seg ?? -1);
      c.access = acc;
      if (changed) this.dirtyCivics.add(c.id);
    }
  }

  // ---------------------------------------------------------------- civic buildings

  private indexCivic(c: Civic): void {
    const r = civicRect(c);
    const rad = Math.hypot(r.hw, r.hd);
    this.civHash.insert(c.id, { minX: c.x - rad, minZ: c.z - rad, maxX: c.x + rad, maxZ: c.z + rad });
  }

  private civicBlocks(rect: ORect): boolean {
    for (const id of this.civHash.queryPoint(rect.x, rect.z, 8)) {
      const c = this.state.civics.get(id);
      if (c && rectsOverlap(rect, civicRect(c, 0.3))) return true;
    }
    return false;
  }

  addCivic(c: Civic): void {
    this.state.civics.set(c.id, c);
    this.coverageCache = null;
    this.transitChanged();
    this.indexCivic(c);
    this.dirtyCivics.add(c.id);
    const r = civicRect(c);
    const pad = Math.hypot(r.hw, r.hd) + 40;
    this.net.revalidate({ minX: c.x - pad, minZ: c.z - pad, maxX: c.x + pad, maxZ: c.z + pad });
    this.events.push({ kind: 'civicBuilt', id: c.id });
  }

  removeCivic(id: number): void {
    const c = this.state.civics.get(id);
    if (!c) return;
    for (const v of [...this.state.vehicles.values()]) if (v.home === id) this.state.vehicles.delete(v.id);
    this.state.civics.delete(id);
    this.coverageCache = null;
    this.transitChanged();
    this.civHash.remove(id);
    this.dirtyCivics.delete(id);
    this.removedCivics.add(id);
    this.vehiclesDirty = true;
    const r = civicRect(c);
    const pad = Math.hypot(r.hw, r.hd) + 40;
    this.net.revalidate({ minX: c.x - pad, minZ: c.z - pad, maxX: c.x + pad, maxZ: c.z + pad });
    this.events.push({ kind: 'civicRemoved', id });
  }

  markVehiclesDirty(): void {
    this.vehiclesDirty = true;
  }

  /** Where a zoned building meets the road. */
  buildingAccess(b: Building): { seg: number; s: number } | null {
    return accessOf(this, b);
  }

  // ---------------------------------------------------------------- buildings

  private indexBuilding(b: Building): void {
    const r = footprint(b);
    const rad = Math.hypot(r.hw, r.hd);
    this.bldHash.insert(b.id, { minX: b.x - rad, minZ: b.z - rad, maxX: b.x + rad, maxZ: b.z + rad });
  }

  markBuildingDirty(id: number): void {
    this.dirtyBuildings.add(id);
    const b = this.state.buildings.get(id);
    if (b) this.indexBuilding(b);
  }

  /** Re-seat the buildings on a segment's blocks after its cell geometry changed. */
  relocateBuildingsOn(segId: number): void {
    const seg = this.state.net.segments.get(segId);
    if (!seg) return;
    const ids = new Set<number>();
    for (const bid of [seg.left, seg.right]) {
      const bl = bid ? this.state.net.blocks.get(bid) : undefined;
      if (bl) for (const x of bl.bld) if (x) ids.add(x);
    }
    for (const id of [...ids].sort((a, b) => a - b)) {
      const b = this.state.buildings.get(id);
      if (b) this.buildingMoved(id, b.block, b.col);
    }
  }

  private buildingMoved(id: number, block: number, col: number): void {
    const b = this.state.buildings.get(id);
    if (!b) return;
    b.block = block;
    b.col = col;
    placeOnLot(this, b);
    this.markBuildingDirty(id);
  }

  removeBuilding(id: number): void {
    const b = this.state.buildings.get(id);
    if (!b) return;
    setLotCells(this, b, 0);
    this.net.clearBuildingCells(id);
    this.state.buildings.delete(id);
    this.bldHash.remove(id);
    this.dirtyBuildings.delete(id);
    this.removedBuildings.add(id);
    this.events.push({ kind: 'demolished', id });
  }

  // ---------------------------------------------------------------- commands

  dispatch(cmd: Command): CommandResult {
    const scope = this.state.economy.bankrupt ? null : this.undoScope(cmd);
    if (scope) this.syncRng();
    const pre = scope ? capture(this.state, scope) : null;
    const result = this.apply(cmd, false);
    if (result.ok) {
      this.log.push({ tick: this.state.tick, cmd: JSON.parse(JSON.stringify(cmd)) as Command });
      if (pre) this.record(cmd, pre);
    }
    return result;
  }

  /** Dry run: validity and cost without changing any state. */
  preview(cmd: Command): CommandResult {
    return this.apply(cmd, true);
  }

  private apply(cmd: Command, dryRun: boolean): CommandResult {
    if (this.state.economy.bankrupt && cmd.type !== 'cheat') return fail('The city is bankrupt');
    switch (cmd.type) {
      case 'cheat': {
        if (cmd.cheat === 'unlockAll') {
          if (!dryRun) this.state.unlockAll = true;
          return ok(0);
        }
        if (cmd.cheat === 'ignite') {
          const b = this.state.buildings.get(cmd.id);
          if (!b || (b.state !== BState.Active && b.state !== BState.Abandoned))
            return fail('Nothing to burn');
          if (b.fire > 0) return fail('Already on fire');
          if (!dryRun) ignite(this, b);
          return ok(0);
        }
        if (!Number.isFinite(cmd.amount)) return fail('Invalid amount');
        if (!dryRun) this.earn(cmd.amount, 'cheats');
        return ok(0);
      }
      case 'placeBuilding':
        return placeCivic(this, cmd.def, cmd.x, cmd.z, cmd.angle, cmd.side, dryRun);
      case 'renameCity': {
        const name = cmd.name.trim().slice(0, 40);
        if (!name) return fail('Name cannot be empty');
        if (!dryRun) this.state.cityName = name;
        return ok(0);
      }
      case 'buildRoad':
        return buildRoad(this, cmd.road, cmd.points, dryRun);
      case 'bulldoze':
        return bulldoze(this, cmd.target, dryRun);
      case 'upgradeRoad':
        return upgradeRoad(this, cmd.seg, cmd.road, dryRun);
      case 'placeStop':
        return placeStop(this, cmd.x, cmd.z, dryRun);
      case 'zone':
        return zone(this, cmd.zone, cmd.area, dryRun);
      case 'undo':
        return this.undoRedo('undo', dryRun);
      case 'redo':
        return this.undoRedo('redo', dryRun);
      case 'setTax':
        return setTax(this, cmd.zone, cmd.wealth, cmd.rate, dryRun);
      case 'setFunding':
        return setFunding(this, cmd.dept, cmd.pct, dryRun);
      case 'takeLoan':
        return takeLoan(this, cmd.amount, dryRun);
      case 'repayLoan':
        return repayLoan(this, cmd.id, dryRun);
      case 'disaster': {
        const r = startDisaster(this, cmd.kind, cmd.at, { size: cmd.size, heading: cmd.heading }, dryRun);
        if (r.ok && !dryRun) this.disastersDirty = true;
        return r;
      }
      case 'setPolicy': {
        const def = POLICY.get(cmd.id);
        if (!def) return fail('No such policy');
        if (cmd.on && !this.isUnlocked(def.unlockPopulation))
          return fail(`Unlocks at ${def.unlockPopulation.toLocaleString('en-US')} residents`);
        if (!dryRun) {
          const set = new Set(this.state.policies);
          if (cmd.on) set.add(cmd.id);
          else set.delete(cmd.id);
          this.state.policies = [...set].sort();
          if (cmd.id === 'freeTransit') this.transitChanged();
        }
        return ok(0);
      }
      case 'addModule':
        return addModule(this, cmd.civic, cmd.module, dryRun);
      case 'setDisasters':
        if (!dryRun) this.state.options = { ...this.state.options, disasters: cmd.on };
        return ok(0);
      default: {
        const never: never = cmd;
        return fail(`Unknown command ${(never as { type: string }).type}`);
      }
    }
  }

  // ---------------------------------------------------------------- undo and redo (M14)

  /** The last actions, for undo, and those taken back, for redo. Not saved. */
  readonly history: { undo: Edit[]; redo: Edit[] } = { undo: [], redo: [] };

  /** What an undoable command may change; null for commands that aren't undone. */
  private undoScope(cmd: Command): Scope | null {
    switch (cmd.type) {
      case 'zone':
        return ZONING_SCOPE;
      case 'buildRoad':
      case 'bulldoze':
      case 'placeStop':
      case 'upgradeRoad':
      case 'placeBuilding':
      case 'addModule':
        return FULL_SCOPE;
      default:
        return null;
    }
  }

  private undoLabel(cmd: Command): string {
    switch (cmd.type) {
      case 'buildRoad':
        return 'road';
      case 'zone':
        return cmd.zone === 'none' ? 'dezoning' : 'zoning';
      case 'bulldoze':
        return 'bulldozing';
      case 'placeStop':
        return 'bus stop';
      case 'upgradeRoad':
        return 'road change';
      case 'placeBuilding':
        return (CIVIC.get(cmd.def)?.name ?? 'building').toLowerCase();
      case 'addModule':
        return (MODULE.get(cmd.module)?.name ?? 'add-on').toLowerCase();
      default:
        return cmd.type;
    }
  }

  /** Keep the difference a command made, as the newest undo step (a zoning stroke is one step). */
  private record(cmd: Command, pre: ReturnType<typeof capture>): void {
    this.syncRng();
    const d = diff(pre, capture(this.state, pre.scope));
    if (!d.changes.length && !d.treasury) return;
    const top = this.history.undo[this.history.undo.length - 1];
    const stroke = cmd.type === 'zone' ? cmd.stroke : undefined;
    if (stroke !== undefined && top?.stroke === stroke) merge(top, d);
    else {
      this.history.undo.push({
        label: this.undoLabel(cmd),
        tick: this.state.tick,
        ...d,
        ...(stroke !== undefined ? { stroke } : {}),
      });
      if (this.history.undo.length > HISTORY_LIMIT) this.history.undo.shift();
    }
    this.history.redo = [];
  }

  private undoRedo(dir: 'undo' | 'redo', dryRun: boolean): CommandResult {
    const from = dir === 'undo' ? this.history.undo : this.history.redo;
    const edit = from[from.length - 1];
    if (!edit) return fail(dir === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
    const cost = dir === 'undo' ? edit.treasury : -edit.treasury;
    if (dryRun) return ok(cost, { info: { label: edit.label } });
    this.syncRng();
    const r = applyEdit(this.state, edit, dir);
    if (!r.ok) return fail(`Can't ${dir} the ${edit.label}: ${r.reason}`, { info: { label: edit.label } });
    from.pop();
    (dir === 'undo' ? this.history.redo : this.history.undo).push(edit);
    this.afterEdit(r.touched);
    return ok(cost, { info: { label: edit.label } });
  }

  /** Re-index and tell the client about everything an undo or redo changed. */
  private afterEdit(t: Touched): void {
    if (t.values.has('rng')) for (const s of RNG_STREAMS) this.rng[s] = new Rng(this.state.rng[s]);
    const net = this.net;
    if (t.ids.nodes || t.ids.segments || t.ids.blocks) {
      net.rebuildDerived();
      const kinds = [
        ['nodes', this.state.net.nodes],
        ['segments', this.state.net.segments],
        ['blocks', this.state.net.blocks],
      ] as const;
      for (const [k, map] of kinds)
        for (const id of t.ids[k] ?? []) {
          if (map.has(id)) {
            net.dirty[k].add(id);
            net.removed[k].delete(id);
          } else {
            net.dirty[k].delete(id);
            net.removed[k].add(id);
          }
        }
      this.markNetworkChanged();
      this.deckCache.clear();
    }
    for (const id of t.ids.buildings ?? []) {
      if (this.state.buildings.has(id)) {
        this.removedBuildings.delete(id);
        this.markBuildingDirty(id);
      } else {
        this.bldHash.remove(id);
        this.dirtyBuildings.delete(id);
        this.removedBuildings.add(id);
      }
    }
    for (const id of t.ids.civics ?? []) {
      const c = this.state.civics.get(id);
      if (c) {
        this.indexCivic(c);
        this.removedCivics.delete(id);
        this.dirtyCivics.add(id);
      } else {
        this.civHash.remove(id);
        this.dirtyCivics.delete(id);
        this.removedCivics.add(id);
      }
    }
    if (t.ids.civics || t.ids.stops || t.ids.segments) {
      this.coverageCache = null;
      this.transitChanged();
    }
    if (t.ids.vehicles || t.ids.incidents) this.vehiclesDirty = true;
    const ground = t.arrays.terrainDelta;
    if (ground?.length) {
      for (const i of ground) {
        this.terrain.heights[i] = this.terrain.base[i]! + this.state.terrainDelta[i]!;
        this.markTerrainDirty(i);
      }
      this.waterDistCache = null;
      this.deckCache.clear();
    }
    for (const i of t.arrays.trees ?? []) this.markTreesDirty(i);
    this.flagCache.clear();
  }

  // ---------------------------------------------------------------- time

  /** The commute matching round under way, if one is (it runs over four ticks). */
  private matchRound: MatchRound | null = null;

  /** Commute matching, a quarter of the origins per tick over `MATCH_SLICES` ticks. */
  private matchSlice(i: number): void {
    if (i === 0) {
      this.matchRound?.finish();
      this.matchRound = new MatchRound(this);
    }
    const r = this.matchRound;
    if (!r) return;
    if (i >= MATCH_SLICES - 1) {
      r.finish();
      this.matchRound = null;
    } else r.step(Math.ceil(r.size / MATCH_SLICES));
  }

  /** Complete any matching round under way (before a save, so a loaded city carries on the same). */
  finishMatching(): void {
    this.matchRound?.finish();
    this.matchRound = null;
  }

  /** Optional hook around each system (benchmarks time them); the sim itself never reads a clock. */
  timer: ((name: string, fn: () => void) => void) | null = null;

  step(): void {
    const s = this.state;
    s.tick++;
    const t = s.tick;
    if (s.economy.bankrupt) {
      if (this.testMode) checkInvariants(this);
      return;
    }
    if (isMonthStart(t)) {
      closeMonth(this, dateOf(t).totalMonths - 1);
      for (const c of s.civics.values()) {
        c.lastDay = c.processedToday;
        c.processedToday = 0;
        rollCollectionDay(c);
      }
    }
    const run = this.timer ?? ((_name: string, fn: () => void) => fn());
    run('vehicles', () => stepVehicles(this));
    run('incidents', () => incidentsTick(this));
    run('disasters', () => disastersTick(this));
    if (t % GROWTH.passInterval === 0) run('growth', () => growthPass(this));
    // Hourly systems, spread over the hour in their usual order (HOURLY_AT).
    const minute = t % TICKS_PER_HOUR;
    const hour = Math.floor(t / TICKS_PER_HOUR);
    switch (minute) {
      case HOURLY_AT.utilities:
        run('disastersHour', () => disastersHour(this));
        run('utilities', () => {
          updateUtilities(this);
          utilityConsequences(this);
        });
        break;
      case HOURLY_AT.coverageCache:
        // After a change to roads or services, rebuild the coverage cache on a quiet tick rather
        // than inside the coverage pass (it's a pure function of the city, so when doesn't matter).
        if (!this.coverageCache) run('coverageCache', () => this.coverage);
        break;
      case HOURLY_AT.coverage:
        run('coverage', () => applyServiceLoads(this, this.coverage));
        break;
      case HOURLY_AT.coverage + 1:
        run('coverage2', () => applyCoverageFields(this, this.coverage));
        break;
      case HOURLY_AT.health:
        run('health', () => healthHour(this));
        run('flags', () => this.refreshFlags());
        break;
      case HOURLY_AT.garbage:
        run('garbage', () => {
          garbageHour(this);
          dispatchGarbage(this);
        });
        break;
      case HOURLY_AT.pollution:
        if (hour % 3 === 0) run('pollution', () => updateGroundPollution(this, 3));
        break;
      case HOURLY_AT.pollution + 1:
        if (hour % 3 === 0)
          run('air', () => {
            updateAirPollution(this, 3);
            decayCrime(this, 3);
          });
        break;
      case HOURLY_AT.matcher:
      case HOURLY_AT.matcher + 1:
      case HOURLY_AT.matcher + 2:
      case HOURLY_AT.matcher + 3:
        if (hour % 2 === 0) run('matcher', () => this.matchSlice(minute - HOURLY_AT.matcher));
        break;
      case HOURLY_AT.happiness:
        run('happiness', () => updateHappiness(this));
        break;
      case HOURLY_AT.lifecycle:
        run('incidentsHour', () => incidentsHour(this));
        run('lifecycle', () => lifecycle(this));
        break;
      case HOURLY_AT.economy:
        run('totals', () => {
          s.totals = computeTotals(this);
          updateDemand(this);
        });
        run('economy', () => economyHour(this));
        run('progress', () => {
          specialisationsHour(this);
          progressHour(this);
        });
        break;
      case HOURLY_AT.landValue:
        if (hour % 3 === 0) run('landValue', () => updateLandValue(this));
        break;
    }
    if (this.testMode) checkInvariants(this);
  }

  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /** Re-run a command log from a fresh sim: apply each entry at its tick. */
  static replay(opts: Partial<GameOptions>, log: CommandLogEntry[], untilTick: number): Sim {
    const sim = Sim.create(opts);
    let i = 0;
    for (;;) {
      while (i < log.length && log[i]!.tick === sim.tick) sim.dispatch(log[i++]!.cmd);
      if (sim.tick >= untilTick) break;
      sim.step();
    }
    return sim;
  }

  // ---------------------------------------------------------------- persistence

  private syncRng(): void {
    for (const s of RNG_STREAMS) this.state.rng[s] = this.rng[s].getState();
  }

  save(savedAt = ''): SaveFile {
    this.finishMatching();
    this.syncRng();
    return makeSaveFile(this.state, this.state.totals.population, savedAt);
  }

  hash(): string {
    this.syncRng();
    return fnv1a(stateToCanonicalJson(this.state));
  }

  // ---------------------------------------------------------------- views for the main thread

  stats(): CityStats {
    const t = this.state.totals;
    const d = this.state.demand;
    return {
      tick: this.state.tick,
      treasury: this.state.treasury,
      cityName: this.state.cityName,
      population: t.population,
      undoAvailable: this.history.undo.length > 0,
      redoAvailable: this.history.redo.length > 0,
      undoLabel: this.history.undo[this.history.undo.length - 1]?.label ?? null,
      redoLabel: this.history.redo[this.history.redo.length - 1]?.label ?? null,
      jobs: t.jobs,
      jobsFilled: t.jobsFilled,
      unemployed: t.unemployed,
      workers: t.workers,
      approval: t.approval,
      demand: { R: d.R, C: d.C, I: d.I },
      demandFactors: d.factors,
      buildings: t.buildings,
      abandoned: t.abandoned,
      highwayConnected: t.highwayConnected,
      netMonthly: this.projectedNet(),
      loans: this.state.economy.loans.length,
      bankrupt: this.state.economy.bankrupt,
      negativeHours: this.state.economy.negativeHours,
      utilities: this.state.utilityStats,
      unlockAll: this.state.unlockAll || this.state.options.sandbox,
      peak: Math.max(this.state.progress.peak, this.state.totals.population),
      milestone: this.state.progress.milestone,
      achievements: { ...this.state.progress.achievements },
      visitors: this.state.tourism.visitors,
      policies: [...this.state.policies],
      civics: this.state.civics.size,
      vehicles: this.state.vehicles.size,
      avgCommute: this.avgCommute(),
      busRiders: [...this.state.transit.riders.values()].reduce((a, b) => a + b, 0),
    };
  }

  /** Average door-to-door commute of employed residents, seconds. */
  avgCommute(): number {
    let n = 0;
    let t = 0;
    for (const b of this.state.buildings.values()) {
      if (b.state !== BState.Active || b.employed <= 0) continue;
      n += b.employed;
      t += b.commute * b.employed;
    }
    return n ? Math.round(t / n) : 0;
  }

  /** Projected net income per month at current rates (whole dollars). */
  projectedNet(): number {
    const r = monthlyRates(this);
    return Math.round(Object.values(r).reduce((a, b) => a + b, 0));
  }

  budget(): BudgetReport {
    const e = this.state.economy;
    const rates = monthlyRates(this);
    return {
      treasury: this.state.treasury,
      month: { ...e.month },
      projection: Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Math.round(v)])),
      history: e.history.map((h) => ({ month: h.month, lines: { ...h.lines }, treasury: h.treasury })),
      taxes: {
        R: [...e.taxes.R] as [number, number, number],
        C: [...e.taxes.C] as [number, number, number],
        I: [...e.taxes.I] as [number, number, number],
      },
      funding: { ...e.funding },
      loans: e.loans.map((l) => ({
        id: l.id,
        principal: l.principal,
        annualRate: l.annualRate,
        months: l.months,
        payment: Math.round(l.payment),
        balance: Math.ceil(l.balance),
      })),
      negativeHours: e.negativeHours,
      bankrupt: e.bankrupt,
      monthStartTreasury: e.monthStartTreasury,
    };
  }

  private netData(): { nodes: NodeData[]; segments: SegmentData[]; blocks: BlockData[] } {
    const n = this.state.net;
    return {
      nodes: [...n.nodes.values()].map((x) => ({ ...x })),
      segments: [...n.segments.values()].map((x) => ({ ...x })),
      blocks: [...n.blocks.values()].map(blockData),
    };
  }

  snapshot(): Snapshot {
    const d = this.net.dirty;
    const r = this.net.removed;
    for (const set of [
      d.nodes,
      d.segments,
      d.blocks,
      r.nodes,
      r.segments,
      r.blocks,
      this.dirtyBuildings,
      this.removedBuildings,
      this.dirtyCivics,
      this.removedCivics,
    ])
      set.clear();
    this.vehiclesDirty = false;
    this.trafficDirty = false;
    this.transitDirty = false;
    this.events = [];
    return {
      options: { ...this.state.options },
      terrainParams: this.terrain.gen.params,
      heights: this.terrain.heights.slice(),
      terrainDelta: this.state.terrainDelta.slice(),
      trees: this.state.trees.slice(),
      groundwater: this.terrain.groundwater.slice(),
      ore: this.terrain.ore.slice(),
      oil: this.terrain.oil.slice(),
      stats: this.stats(),
      net: this.netData(),
      highway: { ...this.state.highway },
      buildings: [...this.state.buildings.values()].map((b) => this.buildingData(b)),
      civics: [...this.state.civics.values()].map((c) => this.civicData(c)),
      vehicles: this.vehicleData(),
      traffic: this.trafficData(),
      transit: this.transitData(),
      disasters: this.disasterData(),
    };
  }

  disasterData(): DisasterData {
    const s = this.state;
    const flooded = floodedSegments(this);
    return {
      active: s.disasters.map((d) => ({ ...d })),
      damaged: [...s.roadDamage.keys()].sort((a, b) => a - b),
      flooded: [...flooded].sort((a, b) => a - b),
      craters: s.craters.map((c) => ({ ...c })),
    };
  }

  /** Problem flags shown as icons: see BuildingData.flags. */
  buildingFlags(b: Building): number {
    if (b.state === BState.Rubble) return b.fire > 0 ? 128 : 0;
    let f = this.isBuildingConnected(b) ? 0 : 1;
    if (b.state === BState.Active) {
      if (b.power < 0.99) f |= 2;
      if (b.water < 0.99) f |= 4;
      if (b.sewage < 0.99) f |= 8;
      if (b.garbage >= GARBAGE.visible) f |= 16;
      if (b.closed) f |= 32;
      if (b.polluted > 0.2) f |= 64;
      if (b.zone === ZONE_R && b.pop > 0 && (b.sick * (1 - b.treated)) / b.pop > 0.04) f |= 256;
      if (b.zone !== ZONE_I && fieldAt(this.state.airPollution, b.x, b.z) > 0.35) f |= 512;
    }
    if (b.fire > 0) f |= 128;
    if (b.flooded > 0) f |= 1024;
    return f;
  }

  /** Mark buildings whose problem flags changed so the renderer updates their icons. */
  private refreshFlags(): void {
    for (const b of this.state.buildings.values()) {
      const f = this.buildingFlags(b);
      if (this.flagCache.get(b.id) !== f) {
        this.flagCache.set(b.id, f);
        this.dirtyBuildings.add(b.id);
      }
    }
  }

  civicData(c: Civic): CivicData {
    const d = civicDef(c);
    return {
      id: c.id,
      def: c.def,
      x: c.x,
      z: c.z,
      y: c.y,
      angle: c.angle,
      side: c.side,
      access: !!c.access,
      fill: d.garbage?.storage ? c.stored / d.garbage.storage : 0,
      out: c.out,
      variant: c.variant,
      damage: c.damage,
      flooded: c.flooded,
      modules: [...c.modules],
    };
  }

  private vehicleData(): VehicleData[] {
    return [...this.state.vehicles.values()].map((v) => ({
      id: v.id,
      kind: v.kind,
      phase: v.phase,
      leg: v.leg,
      t: v.t,
      legs: v.legs.map((l) => ({ ...l, v: VEHICLE_SPEED_SCALE * segSpeed(this, l.seg) })),
    }));
  }

  buildingData(b: Building): BuildingData {
    return {
      id: b.id,
      def: b.def,
      zone: b.zone,
      density: b.density,
      wealth: b.wealth,
      level: b.level,
      x: b.x,
      z: b.z,
      y: b.y,
      angle: b.angle,
      side: b.side,
      w: b.w,
      d: b.d,
      state: b.state,
      progress: b.progress,
      variant: b.variant,
      flags: this.buildingFlags(b),
      fire: Math.round(b.fire * 10) / 10,
    };
  }

  /** Changes since the last call, for the main-thread mirror. */
  collectFrame(): FrameDiff {
    const frame: FrameDiff = { tick: this.state.tick, stats: this.stats() };
    if (this.dirtyTrees.size) {
      const idx = [...this.dirtyTrees].sort((a, b) => a - b);
      frame.trees = { idx, val: idx.map((i) => this.state.trees[i]!) };
      this.dirtyTrees.clear();
    }
    if (this.dirtyTerrain.size) {
      const idx = [...this.dirtyTerrain].sort((a, b) => a - b);
      frame.terrain = {
        idx,
        h: idx.map((i) => this.terrain.heights[i]!),
        d: idx.map((i) => this.state.terrainDelta[i]!),
      };
      this.dirtyTerrain.clear();
    }
    const d = this.net.dirty;
    const r = this.net.removed;
    if (
      d.nodes.size ||
      d.segments.size ||
      d.blocks.size ||
      r.nodes.size ||
      r.segments.size ||
      r.blocks.size
    ) {
      const n = this.state.net;
      const diff: NetDiff = {
        nodes: [...d.nodes]
          .filter((id) => n.nodes.has(id))
          .sort((a, b) => a - b)
          .map((id) => ({ ...n.nodes.get(id)! })),
        segments: [...d.segments]
          .filter((id) => n.segments.has(id))
          .sort((a, b) => a - b)
          .map((id) => ({ ...n.segments.get(id)! })),
        blocks: [...d.blocks]
          .filter((id) => n.blocks.has(id))
          .sort((a, b) => a - b)
          .map((id) => blockData(n.blocks.get(id)!)),
        removedNodes: [...r.nodes].sort((a, b) => a - b),
        removedSegments: [...r.segments].sort((a, b) => a - b),
        removedBlocks: [...r.blocks].sort((a, b) => a - b),
      };
      frame.net = diff;
      for (const s of [d.nodes, d.segments, d.blocks, r.nodes, r.segments, r.blocks]) s.clear();
    }
    if (this.dirtyBuildings.size || this.removedBuildings.size) {
      frame.buildings = {
        upserts: [...this.dirtyBuildings]
          .filter((id) => this.state.buildings.has(id))
          .sort((a, b) => a - b)
          .map((id) => this.buildingData(this.state.buildings.get(id)!)),
        removed: [...this.removedBuildings].sort((a, b) => a - b),
      };
      this.dirtyBuildings.clear();
      this.removedBuildings.clear();
    }
    if (this.dirtyCivics.size || this.removedCivics.size) {
      frame.civics = {
        upserts: [...this.dirtyCivics]
          .filter((id) => this.state.civics.has(id))
          .sort((a, b) => a - b)
          .map((id) => this.civicData(this.state.civics.get(id)!)),
        removed: [...this.removedCivics].sort((a, b) => a - b),
      };
      this.dirtyCivics.clear();
      this.removedCivics.clear();
    }
    if (this.vehiclesDirty) {
      frame.vehicles = this.vehicleData();
      this.vehiclesDirty = false;
    }
    if (this.trafficDirty) {
      frame.traffic = this.trafficData();
      this.trafficDirty = false;
    }
    if (this.transitDirty) {
      frame.transit = this.transitData();
      this.transitDirty = false;
    }
    if (this.disastersDirty) {
      frame.disasters = this.disasterData();
      this.disastersDirty = false;
    }
    if (this.events.length) {
      frame.events = this.events;
      this.events = [];
    }
    return frame;
  }

  /** Terrain samples changed by earthworks, for the client (M13). */
  markTerrainDirty(idx: number): void {
    this.dirtyTerrain.add(idx);
  }

  /**
   * The ground moved inside `box` (earthworks, M13): buildings and civic buildings settle onto it
   * and bridge decks near it are recomputed. Zone cells are rechecked by the caller.
   */
  groundMoved(box: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    const h = (x: number, z: number) => this.terrain.heightAt(x, z);
    for (const id of this.bldHash.query(box)) {
      const b = this.state.buildings.get(id)!;
      const y = seatHeight(h, footprint(b), false);
      if (y !== b.y) {
        b.y = y;
        this.markBuildingDirty(id);
      }
    }
    for (const id of this.civHash.query(box)) {
      const c = this.state.civics.get(id)!;
      const y = seatHeight(h, civicRect(c), true);
      if (y !== c.y) {
        c.y = y;
        this.dirtyCivics.add(id);
      }
    }
    for (const id of this.net.segHash.query(box)) this.deckCache.delete(id);
    // Water distance and the land's setting (views) are derived from the ground.
    this.waterDistCache = null;
  }

  markTreesDirty(idx: number): void {
    this.dirtyTrees.add(idx);
  }

  // ---------------------------------------------------------------- queries

  query(q: Query): unknown {
    switch (q.type) {
      case 'hash':
        return this.hash();
      case 'summary':
        return this.stats();
      case 'building':
        return this.buildingDetails(q.id);
      case 'budget':
        return this.budget();
      case 'civic':
        return this.civicDetails(q.id);
      case 'overlay':
        return computeOverlay(this, q.map);
      case 'coveragePreview':
        return coveragePreview(this, q.def, q.x, q.z, q.angle, q.side);
      case 'advisors':
        return advise(this);
      case 'thoughts':
        return thoughts(this, q.count ?? 6);
      case 'coverageRoads': {
        const cov = this.coverage.kinds[q.kind];
        const out: { seg: number; v: number[] }[] = [];
        for (const seg of this.state.net.segments.values()) {
          if (seg.type === 'highway') continue;
          const arr = cov.get(seg.id);
          out.push({ seg: seg.id, v: arr ? [...arr].map((x) => Math.round(x * 100) / 100) : [0, 0] });
        }
        return out;
      }
    }
  }

  civicDetails(id: number): CivicDetails | null {
    const c = this.state.civics.get(id);
    if (!c) return null;
    const d = civicDef(c);
    const produces: { utility: string; output: number }[] = [];
    for (const u of ['power', 'water', 'sewage'] as const) {
      const out = civicOutput(this, c, u);
      if (out > 0) produces.push({ utility: u, output: Math.round(out) });
    }
    return {
      id: c.id,
      def: c.def,
      name: d.name,
      category: d.category,
      blurb: d.blurb,
      upkeep: Math.round(civicUpkeep(c) * (this.state.economy.funding[d.dept] / 100) * this.upkeepScale()),
      funding: this.state.economy.funding[d.dept],
      access: !!c.access,
      produces,
      polluted:
        produces.some((p) => p.utility === 'water') &&
        this.groundPollutionAt(c.x, c.z) > UTILITIES.pollutedPumpThreshold,
      garbage: d.garbage ? this.garbageDetails(c) : null,
      service: d.service ? this.serviceDetails(c) : null,
      transit: d.transit ? this.transitDetails(c) : null,
      refund: Math.round(c.cost * 0.25),
      special: d.resource
        ? {
            kind: 'resource',
            perDay: Math.round(extractionPerDay(this, c)),
            left: Math.max(0, Math.round((1 - c.stored / d.resource.reserve) * 100)),
          }
        : d.tourism
          ? { kind: 'tourism', draw: d.tourism.draw ?? 0, rooms: d.tourism.rooms ?? 0 }
          : null,
    };
  }

  private transitDetails(c: Civic): NonNullable<CivicDetails['transit']> {
    const line = this.lines().find((l) => l.depot === c.id);
    return {
      stops: line?.stops.length ?? 0,
      buses: line?.buses ?? 0,
      loopMinutes: line ? Math.round(line.loopTime / 6) / 10 : 0,
      riders: this.state.transit.riders.get(c.id) ?? 0,
      full: (this.state.transit.load.get(c.id) ?? 1) < 0.95,
    };
  }

  /** Seats filled per school at the last hourly coverage pass (UI only; not saved). */
  schoolUse = new Map<number, number>();

  /** What a garbage facility's inspector shows: its trucks, rounds and collection against production. */
  private garbageDetails(c: Civic): NonNullable<CivicDetails['garbage']> {
    const g = civicDef(c).garbage!;
    let produced = 0;
    let backlog = 0;
    let piles = 0;
    for (const b of this.state.buildings.values()) {
      produced += garbageRate(this, b) * 24;
      backlog += b.garbage;
      if (b.garbage >= GARBAGE.visible) piles++;
    }
    let collectedAll = 0;
    for (const o of this.state.civics.values()) collectedAll += o.collection?.last.units ?? 0;
    // Yesterday's rounds, or today's so far for a site that opened today.
    const day = c.collection && c.collection.last.rounds > 0 ? c.collection.last : c.collection?.today;
    const extra = c.modules.filter((m) => m === 'garbageTruck').length;
    return {
      trucks: trucksFor(this, c),
      out: c.out,
      extraTrucks: extra,
      maxExtraTrucks: MODULE.get('garbageTruck')!.max ?? 0,
      stored: Math.round(c.stored),
      storage: g.storage ?? 0,
      processedToday: Math.round(c.processedToday),
      process: g.process ?? 0,
      collectedToday: Math.round(c.collection?.today.units ?? 0),
      collectedLastDay: Math.round(c.collection?.last.units ?? 0),
      collectedAllLastDay: Math.round(collectedAll),
      producedPerDay: Math.round(produced),
      backlog: Math.round(backlog),
      piles,
      roundHours: day && day.rounds ? Math.round((day.ticks / day.rounds / 60) * 10) / 10 : 0,
      stopsPerRound: day && day.rounds ? Math.round((day.stops / day.rounds) * 10) / 10 : 0,
      loadPerRound: day && day.rounds ? Math.round(day.units / day.rounds) : 0,
      truckCapacity: g.truckCapacity,
    };
  }

  private serviceDetails(c: Civic): NonNullable<CivicDetails['service']> {
    const d = civicDef(c);
    const svc = d.service!;
    const eff = Math.min(1.25, this.fundingEff(d.dept));
    const mine = new Map<number, Float32Array>();
    stationCoverage(this, this.graph(), c, mine);
    let reach = 0;
    for (const b of this.state.buildings.values()) {
      if (b.state !== BState.Active) continue;
      const acc = this.buildingAccess(b);
      if (!acc) continue;
      const arr = mine.get(acc.seg);
      if (arr && sampleAt(arr, acc.s, this.net.curve(acc.seg).length) >= 0.5) reach++;
    }
    return {
      kind: svc.kind,
      vehicles: Math.max(0, Math.round(civicVehicles(c) * eff)),
      out: [...this.state.vehicles.values()].filter((v) => v.home === c.id).length,
      reach,
      seats: Math.round(civicCapacity(c) * eff),
      used: this.schoolUse.get(c.id) ?? 0,
    };
  }

  buildingDetails(id: number): BuildingDetails | null {
    const b = this.state.buildings.get(id);
    if (!b) return null;
    const def = defOf(b);
    const factors = b.state === BState.Active || b.pop > 0 ? happinessFactors(this, b) : [];
    return {
      id: b.id,
      name: def.name,
      zone: b.zone,
      density: b.density,
      wealth: b.wealth,
      level: b.level,
      state: b.state,
      progress: b.progress,
      pop: b.pop,
      cap: b.cap || buildingCapacity(b),
      employed: b.employed,
      commute: b.commute,
      shop: b.shop,
      happiness: b.happiness,
      base: HAPPINESS.base,
      factors,
      distress: b.distress,
      abandonAt: GROWTH.abandonAt,
      isResidential: b.zone === ZONE_R,
      connected: this.isBuildingConnected(b),
      born: b.born,
      power: b.power,
      water: b.water,
      sewage: b.sewage,
      polluted: b.polluted,
      garbage: Math.round(b.garbage),
      closed: b.closed,
      coverage: {
        fire: b.covFire,
        police: b.covPolice,
        health: b.covHealth,
        education: b.covEdu,
        park: b.covPark,
      },
      crime: Math.round(this.crimeAt(b.x, b.z) * 100) / 100,
      sick: Math.round(b.sick),
      treated: b.treated,
      edu: Math.round(b.edu * 100) / 100,
      air: Math.round(fieldAt(this.state.airPollution, b.x, b.z) * 100) / 100,
      fire: b.fire,
    };
  }
}

function blockData(b: ZoneBlock): BlockData {
  return {
    id: b.id,
    seg: b.seg,
    side: b.side,
    s0: b.s0,
    cols: b.cols,
    zone: b.zone.slice(),
    valid: b.valid.slice(),
    bld: b.bld.slice(),
  };
}
