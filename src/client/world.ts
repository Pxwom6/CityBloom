import { TerrainGen, sampleHeights } from '../sim/terrain/generate';
import type {
  BuildingData,
  CityStats,
  CivicData,
  FrameDiff,
  NetDiff,
  Snapshot,
  TrafficData,
  TransitData,
  VehicleData,
  DisasterData,
  DistrictData,
} from '../sim/protocol';
import { Network, type NetworkState, type RoadSegment, type ZoneBlock } from '../sim/world/network';
import { SpatialHash, type Box } from '../sim/world/spatial';
import { roadIslands, type RoadIsland } from '../sim/world/islands';
import { RoadGraph } from '../sim/systems/graph';
import { CIVIC } from '../data/civic';
import { deckAt, deckProfile, viaductDeck, type DeckProfile } from '../sim/world/bridge';
import { ROAD_TYPES, isRail, type RoadTypeId } from '../data/roads';
import { TRAFFIC, JUNCTION } from '../data/balance';
import type { TripSample } from '../sim/systems/traffic';
import type { GameOptions } from '../sim/state';
import { GRID_CELL, GRID_RES, HEIGHT_RES, HEIGHT_STEP, MAP_SIZE } from '../data/world';

type Listener = () => void;

export interface NetChanges {
  segments: Set<number>;
  nodes: Set<number>;
  blocks: Set<number>;
}

/**
 * Read-only mirror of the sim state that rendering and UI need, updated from worker frames.
 * Nothing here mutates the simulation; all changes go through commands.
 */
/** A railway segment type (M20). */
const isRailType = (t: RoadTypeId | undefined): boolean => !!t && isRail(t);

export class ClientWorld {
  readonly options: GameOptions;
  readonly gen: TerrainGen;
  readonly heights: Float32Array;
  /** Earthworks (M13): each height sample's change from the generated terrain. */
  readonly terrainDelta: Float32Array;
  /** Bumped whenever earthworks change the ground. */
  terrainVersion = 0;
  private terrainListeners: ((box: Box) => void)[] = [];
  readonly trees: Uint8Array;
  readonly groundwater: Uint8Array;
  readonly ore: Uint8Array;
  readonly oil: Uint8Array;
  stats: CityStats;
  readonly netState: NetworkState;
  /** Geometry-only view of the road network (curves, adjacency, cells, spatial queries). */
  readonly net: Network;
  readonly highway: Snapshot['highway'];
  /**
   * The regional railway's link at the west edge (M20), if it fitted; a city without one can lay
   * one later (Phase 2 review), and undo can take it away.
   */
  railway: Snapshot['railway'];
  private railwayListeners: (() => void)[] = [];
  private netListeners: ((c: NetChanges) => void)[] = [];
  readonly buildings = new Map<number, BuildingData>();
  /** Spatial index of building footprints (by bounding circle). */
  readonly bldHash = new SpatialHash(32);
  private buildingListeners: ((changed: number[], removed: number[]) => void)[] = [];
  readonly civics = new Map<number, CivicData>();
  /** Tree grid cells changed since the tree renderer last looked (it takes and clears them). */
  readonly treeChanges = new Set<number>();
  /** Civic footprints by place, for `civicAt` (tree placement asks it for every tree). */
  private readonly civHash = new SpatialHash(64);
  private civicListeners: ((changed: number[], removed: number[]) => void)[] = [];
  /** Active service vehicles and the tick they were reported at (the renderer extrapolates). */
  vehicles: VehicleData[] = [];
  vehiclesTick = 0;
  /** Bumped whenever the road network changes. */
  netVersion = 0;
  /** Daily traffic per segment and sampled trips (updated every assignment round). */
  traffic = new Map<number, number>();
  trips: TripSample[] = [];
  /** Bumped whenever traffic data arrives. */
  trafficVersion = 0;
  /** Bus stops and lines. */
  stops = new Map<number, TransitData['stops'][number]>();
  lines: TransitData['lines'] = [];
  /** Riders a day at each stop or station (M20). */
  stopUse = new Map<number, number>();
  /** Terminals loading freight trains and their track from the regional link (M20). */
  freight: TransitData['freight'] = [];
  transitVersion = 0;
  /** Disasters under way, damaged and flooded roads, craters (bumped version on change). */
  disasters: DisasterData = { active: [], damaged: [], flooded: [], craters: [] };
  disastersVersion = 0;
  /** Recent sim events (built, abandoned, ...) for notifications and sounds. */
  events: { kind: string; id: number; info?: Record<string, number | string> }[] = [];
  /** Fractional tick, advanced smoothly between frames for lighting. */
  displayTick: number;
  private listeners = new Map<string, Set<Listener>>();

  constructor(snap: Snapshot) {
    this.options = snap.options;
    this.gen = new TerrainGen(snap.terrainParams);
    this.heights = snap.heights;
    this.terrainDelta = snap.terrainDelta ?? new Float32Array(snap.heights.length);
    this.trees = snap.trees;
    this.groundwater = snap.groundwater;
    this.ore = snap.ore;
    this.oil = snap.oil;
    this.stats = snap.stats;
    this.displayTick = snap.stats.tick;
    this.highway = snap.highway;
    this.railway = snap.railway;
    this.netState = { nodes: new Map(), segments: new Map(), blocks: new Map() };
    for (const n of snap.net.nodes) this.netState.nodes.set(n.id, { ...n });
    for (const sg of snap.net.segments) this.netState.segments.set(sg.id, { ...sg });
    for (const b of snap.net.blocks) this.netState.blocks.set(b.id, { ...b });
    this.net = new Network(this.netState, null, null);
    for (const b of snap.buildings) this.setBuilding(b);
    for (const c of snap.civics) this.setCivic(c);
    this.vehicles = snap.vehicles;
    this.vehiclesTick = snap.stats.tick;
    this.setTraffic(snap.traffic);
    this.setTransit(snap.transit);
    this.setDisasters(snap.disasters);
    this.setDistricts(snap.districts);
  }

  /** Bumped whenever snow on any road changes (M22); segments carry `snow`. */
  roadSnowVersion = 0;

  /** Districts (M21): each by id, and the district of every raster cell (0: none). */
  districts = new Map<number, DistrictData['list'][number]>();
  districtCells: Uint8Array = new Uint8Array(GRID_RES * GRID_RES);
  districtsVersion = 0;

  private setDistricts(d: DistrictData): void {
    this.districts = new Map(d.list.map((x) => [x.id, x]));
    this.districtCells = d.cells;
    this.districtsVersion++;
  }

  /** The district at a point (0: none). */
  districtAt(x: number, z: number): number {
    const i = Math.floor(x / GRID_CELL);
    const j = Math.floor(z / GRID_CELL);
    if (i < 0 || j < 0 || i >= GRID_RES || j >= GRID_RES) return 0;
    return this.districtCells[j * GRID_RES + i]!;
  }

  private setDisasters(d: DisasterData): void {
    this.disasters = d;
    this.disastersVersion++;
  }

  private setTransit(t: TransitData): void {
    this.stops = new Map(t.stops.map((x) => [x.id, x]));
    this.lines = t.lines;
    this.stopUse = new Map(t.use);
    this.freight = t.freight;
    this.transitVersion++;
  }

  /** Bus stop within `r` metres of (x, z). */
  stopAt(x: number, z: number, r = 7): TransitData['stops'][number] | null {
    let best: TransitData['stops'][number] | null = null;
    let bd = r;
    for (const st of this.stops.values()) {
      const d = Math.hypot(st.x - x, st.z - z);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return best;
  }

  private setTraffic(t: TrafficData): void {
    this.traffic = new Map(t.vol);
    this.trips = t.trips;
    this.capScale = t.capScale;
    this.trafficVersion++;
  }

  private deckCache = new Map<number, DeckProfile | null>();

  /** Bridge deck profile of a segment, or null on dry land (same maths as the sim). */
  deck(segId: number): DeckProfile | null {
    let d = this.deckCache.get(segId);
    if (d === undefined) {
      const seg = this.netState.segments.get(segId);
      d = !seg
        ? null
        : seg.deck
          ? viaductDeck(seg.deck, this.net.curve(segId), (x, z) => this.heightAt(x, z))
          : deckProfile(this.net.curve(segId), (x, z) => this.heightAt(x, z), ROAD_TYPES[seg.type].maxGrade);
      this.deckCache.set(segId, d);
    }
    return d;
  }

  /** Height of the road surface at arc length s along a segment (the deck on bridges). */
  roadHeight(segId: number, s: number, x: number, z: number): number {
    const g = Math.max(0, this.heightAt(x, z));
    const d = this.deck(segId);
    return d ? Math.max(g, deckAt(d, s)) : g;
  }

  /** Volume over capacity on a segment at `share` of the rush-hour peak (mirrors the sim). */
  segVC(segId: number, share: number): number {
    const seg = this.netState.segments.get(segId);
    if (!seg) return 0;
    return ((this.traffic.get(segId) ?? 0) * TRAFFIC.peakShare * share) / this.segCapacity(segId);
  }

  /** Cars per hour a road passes (mirrors the sim, one-way roads included). */
  segCapacity(segId: number): number {
    const seg = this.netState.segments.get(segId);
    if (!seg) return 1;
    return ROAD_TYPES[seg.type].capacity * this.capScale * (seg.oneway ? TRAFFIC.oneWayCapacity : 1);
  }

  private islandMemo: { version: number; list: RoadIsland[]; of: Map<number, number> } | null = null;

  /**
   * Roads that can't reach the highway (P1), as the sim works them out (the same graph, without
   * closures), with each cut-off road's island; worked out once per network change.
   */
  roadIslands(): { list: RoadIsland[]; of: Map<number, number> } {
    if (this.islandMemo?.version !== this.netVersion) {
      const list = roadIslands(this.net, new RoadGraph(this.net), this.highway.connect);
      const of = new Map<number, number>();
      list.forEach((isl, i) => isl.segs.forEach((id) => of.set(id, i)));
      this.islandMemo = { version: this.netVersion, list, of };
    }
    return this.islandMemo;
  }

  /** What kind of junction a node is (mirrors junctionKind in the sim, M19). */
  junctionKind(nodeId: number): 'none' | 'plain' | 'roundabout' | 'crossing' {
    const node = this.netState.nodes.get(nodeId);
    if (!node) return 'none';
    if (node.roundabout) return 'roundabout';
    const segs = this.net.segmentsAt(nodeId);
    const rail = segs.filter((id) => isRailType(this.netState.segments.get(id)?.type)).length;
    if (rail) return rail < segs.length ? 'crossing' : 'none';
    if (segs.length < 3) return 'none';
    if (segs.some((id) => this.netState.segments.get(id)?.type === 'motorway')) return 'none';
    return 'plain';
  }

  private worstJunction = { version: -1, vc: 0 };

  /** The busiest plain junction's load at the rush hour (for the roundabout tip), cached. */
  worstJunctionVC(): number {
    if (this.worstJunction.version !== this.trafficVersion) {
      let worst = 0;
      for (const id of this.netState.nodes.keys())
        if (this.junctionKind(id) === 'plain') worst = Math.max(worst, this.junctionVC(id, 1));
      this.worstJunction = { version: this.trafficVersion, vc: worst };
    }
    return this.worstJunction.vc;
  }

  /** A junction's volume over capacity at `share` of the rush hour (mirrors the sim, M19). */
  junctionVC(nodeId: number, share: number): number {
    const kind = this.junctionKind(nodeId);
    if (kind === 'none') return 0;
    let cap = 0;
    let vol = 0;
    for (const id of this.net.segmentsAt(nodeId)) {
      if (isRailType(this.netState.segments.get(id)?.type)) continue;
      cap += this.segCapacity(id);
      vol += this.traffic.get(id) ?? 0;
    }
    const share2 =
      kind === 'roundabout'
        ? JUNCTION.roundaboutShare
        : kind === 'crossing'
          ? JUNCTION.crossingShare
          : JUNCTION.plainShare;
    return ((vol / 2) * TRAFFIC.peakShare * share) / ((cap / 2) * share2);
  }

  /** Capacity factor from road maintenance funding (sent with the traffic). */
  capScale = 1;

  onCivics(l: (changed: number[], removed: number[]) => void): () => void {
    this.civicListeners.push(l);
    return () => {
      this.civicListeners = this.civicListeners.filter((x) => x !== l);
    };
  }

  /** Civic building whose footprint contains (x, z). */
  civicAt(x: number, z: number): CivicData | null {
    for (const id of this.civHash.queryPoint(x, z, 0)) {
      const c = this.civics.get(id)!;
      const d = CIVIC.get(c.def);
      if (!d) continue;
      const ca = Math.cos(c.angle);
      const sa = Math.sin(c.angle);
      const dx = x - c.x;
      const dz = z - c.z;
      const lx = dx * ca + dz * sa;
      const lz = -dx * sa + dz * ca;
      if (Math.abs(lx) <= d.w / 2 && Math.abs(lz) <= d.d / 2) return c;
    }
    return null;
  }

  private setCivic(c: CivicData): void {
    this.civics.set(c.id, c);
    const d = CIVIC.get(c.def);
    const r = d ? Math.hypot(d.w, d.d) / 2 : 0;
    this.civHash.insert(c.id, { minX: c.x - r, minZ: c.z - r, maxX: c.x + r, maxZ: c.z + r });
  }

  private setBuilding(b: BuildingData): void {
    this.buildings.set(b.id, b);
    const r = Math.hypot(b.w * 4, b.d * 4);
    this.bldHash.insert(b.id, { minX: b.x - r, minZ: b.z - r, maxX: b.x + r, maxZ: b.z + r });
  }

  /** Building whose lot contains (x, z), if any. */
  buildingAt(x: number, z: number, margin = 0): BuildingData | null {
    for (const id of this.bldHash.queryPoint(x, z, 1)) {
      const b = this.buildings.get(id)!;
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const dx = x - b.x;
      const dz = z - b.z;
      const lx = dx * c + dz * s;
      const lz = -dx * s + dz * c;
      if (Math.abs(lx) <= b.w * 4 + margin && Math.abs(lz) <= b.d * 4 + margin) return b;
    }
    return null;
  }

  onBuildings(l: (changed: number[], removed: number[]) => void): () => void {
    this.buildingListeners.push(l);
    return () => {
      this.buildingListeners = this.buildingListeners.filter((x) => x !== l);
    };
  }

  /** Subscribe to network changes (ids of touched segments, nodes and blocks, including removals). */
  onNet(l: (c: NetChanges) => void): () => void {
    this.netListeners.push(l);
    return () => {
      this.netListeners = this.netListeners.filter((x) => x !== l);
    };
  }

  private applyNet(d: NetDiff): void {
    this.netVersion++;
    const st = this.netState;
    const net = this.net;
    const ch: NetChanges = { segments: new Set(), nodes: new Set(), blocks: new Set() };
    for (const id of d.removedBlocks) {
      const b = st.blocks.get(id);
      if (!b) continue;
      net.unindexBlock(b);
      st.blocks.delete(id);
      ch.blocks.add(id);
    }
    const reindexBlocksOf = new Set<number>();
    for (const id of d.removedSegments) {
      const sg = st.segments.get(id);
      if (!sg) continue;
      net.unindexSegment(sg);
      st.segments.delete(id);
      ch.segments.add(id);
      ch.nodes.add(sg.a);
      ch.nodes.add(sg.b);
    }
    for (const n of d.nodes) {
      st.nodes.set(n.id, { ...n });
      if (!net.adj.has(n.id)) net.adj.set(n.id, []);
      ch.nodes.add(n.id);
    }
    for (const sgData of d.segments) {
      const old = st.segments.get(sgData.id);
      if (old) {
        net.unindexSegment(old);
        if (old.type !== sgData.type) reindexBlocksOf.add(sgData.id);
      }
      const sg: RoadSegment = { ...sgData };
      st.segments.set(sg.id, sg);
      net.indexSegment(sg);
      ch.segments.add(sg.id);
      ch.nodes.add(sg.a);
      ch.nodes.add(sg.b);
    }
    for (const bd of d.blocks) {
      const old = st.blocks.get(bd.id);
      const sameGeo =
        old &&
        old.seg === bd.seg &&
        old.side === bd.side &&
        old.s0 === bd.s0 &&
        old.cols === bd.cols &&
        !reindexBlocksOf.has(bd.seg);
      const b: ZoneBlock = { ...bd };
      if (sameGeo) {
        old.zone = b.zone;
        old.valid = b.valid;
        old.bld = b.bld;
      } else {
        if (old) net.unindexBlock(old);
        st.blocks.set(b.id, b);
        net.indexBlock(b);
      }
      ch.blocks.add(b.id);
    }
    for (const segId of reindexBlocksOf) {
      const sg = st.segments.get(segId);
      if (!sg) continue;
      for (const bid of [sg.left, sg.right]) {
        const b = bid ? st.blocks.get(bid) : undefined;
        if (!b) continue;
        net.unindexBlock(b);
        net.indexBlock(b);
        ch.blocks.add(bid);
      }
    }
    for (const id of d.removedNodes) {
      st.nodes.delete(id);
      net.adj.delete(id);
      ch.nodes.add(id);
    }
    for (const l of this.netListeners) l(ch);
    this.emit('net');
  }

  /** Terrain height anywhere: the sim grid inside the map, the generator outside. */
  heightAt(x: number, z: number): number {
    if (x >= 0 && z >= 0 && x <= MAP_SIZE && z <= MAP_SIZE) return sampleHeights(this.heights, x, z);
    const g = this.gen.height(x, z);
    if (!this.gen.params.custom) return g;
    // A custom map (M24): its edge carries on outward, blending into the generated scenery.
    const ex = Math.max(0, Math.min(MAP_SIZE, x));
    const ez = Math.max(0, Math.min(MAP_SIZE, z));
    const t = Math.min(1, Math.hypot(x - ex, z - ez) / 400);
    const edge = sampleHeights(this.heights, ex, ez);
    return edge + (g - edge) * t * t * (3 - 2 * t);
  }

  /** The regional rail link was laid or taken away (Phase 2 review). */
  onRailway(l: () => void): () => void {
    this.railwayListeners.push(l);
    return () => {
      this.railwayListeners = this.railwayListeners.filter((x) => x !== l);
    };
  }

  /** Earthworks changed the ground in `box` (M13): terrain, roads, zones and trees follow it. */
  onTerrain(l: (box: Box) => void): () => void {
    this.terrainListeners.push(l);
    return () => {
      this.terrainListeners = this.terrainListeners.filter((x) => x !== l);
    };
  }

  private applyTerrain(t: NonNullable<FrameDiff['terrain']>): void {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < t.idx.length; k++) {
      const i = t.idx[k]!;
      this.heights[i] = t.h[k]!;
      this.terrainDelta[i] = t.d[k]!;
      const x = (i % HEIGHT_RES) * HEIGHT_STEP;
      const z = Math.floor(i / HEIGHT_RES) * HEIGHT_STEP;
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
    // Everything drawn on the ground within a sample spacing of a changed sample moved with it.
    const box = {
      minX: minX - HEIGHT_STEP,
      minZ: minZ - HEIGHT_STEP,
      maxX: maxX + HEIGHT_STEP,
      maxZ: maxZ + HEIGHT_STEP,
    };
    for (const id of this.net.segHash.query(box)) this.deckCache.delete(id);
    this.terrainVersion++;
    for (const l of this.terrainListeners) l(box);
    this.emit('terrain');
  }

  applyFrame(diff: FrameDiff): void {
    this.stats = diff.stats;
    // Ground first, so roads and buildings arriving in the same frame are laid on it.
    if (diff.terrain) this.applyTerrain(diff.terrain);
    const link = diff.stats.railwayLink ?? null;
    const moved = link?.segment !== this.railway?.segment;
    if (moved) this.railway = link;
    if (diff.net) this.applyNet(diff.net);
    if (moved) for (const l of this.railwayListeners) l();
    if (diff.buildings) {
      for (const id of diff.buildings.removed) {
        this.buildings.delete(id);
        this.bldHash.remove(id);
      }
      for (const b of diff.buildings.upserts) this.setBuilding(b);
      const changed = diff.buildings.upserts.map((b) => b.id);
      for (const l of this.buildingListeners) l(changed, diff.buildings.removed);
      this.emit('buildings');
    }
    if (diff.civics) {
      for (const id of diff.civics.removed) {
        this.civics.delete(id);
        this.civHash.remove(id);
      }
      for (const c of diff.civics.upserts) this.setCivic(c);
      const changed = diff.civics.upserts.map((c) => c.id);
      for (const l of this.civicListeners) l(changed, diff.civics.removed);
      this.emit('civics');
    }
    if (diff.vehicles) {
      this.vehicles = diff.vehicles;
      this.vehiclesTick = diff.tick;
    }
    if (diff.traffic) {
      this.setTraffic(diff.traffic);
      this.emit('traffic');
    }
    if (diff.transit) {
      this.setTransit(diff.transit);
      this.emit('transit');
    }
    if (diff.districts) this.setDistricts(diff.districts);
    if (diff.roadSnow) {
      for (const [id, v] of diff.roadSnow) {
        const seg = this.netState.segments.get(id);
        if (!seg) continue;
        if (v > 0) seg.snow = v;
        else delete seg.snow;
      }
      this.roadSnowVersion++;
    }
    if (diff.disasters) {
      this.setDisasters(diff.disasters);
      this.emit('disasters');
    }
    if (diff.events) {
      this.events = diff.events;
      this.emit('events');
    }
    if (diff.trees) {
      for (let k = 0; k < diff.trees.idx.length; k++) this.trees[diff.trees.idx[k]!] = diff.trees.val[k]!;
      for (const i of diff.trees.idx) this.treeChanges.add(i);
      this.emit('trees');
    }
    this.emit('stats');
  }

  on(topic: string, l: Listener): () => void {
    let set = this.listeners.get(topic);
    if (!set) this.listeners.set(topic, (set = new Set()));
    set.add(l);
    return () => set.delete(l);
  }

  emit(topic: string): void {
    this.listeners.get(topic)?.forEach((l) => l());
  }
}
