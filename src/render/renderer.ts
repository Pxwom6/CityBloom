import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { ClientWorld } from '../client/world';
import { hourOfDay } from '../sim/time';
import { windAngle } from '../sim/systems/pollution';
import { CameraController } from './camera';
import { Lighting } from './lighting';
import { TerrainRenderer } from './terrain';
import { TreeRenderer, lotTree, type Placement } from './trees';
import { WaterRenderer } from './water';
import { RoadRenderer } from './roads';
import { ZoneRenderer } from './zones';
import { GhostRenderer } from './ghost';
import { BuildingRenderer, buildingYaw } from './buildings';
import type { ModelData } from './assets/builder';
import { CivicRenderer } from './civics';
import { VehicleRenderer } from './vehicles';
import { IconRenderer } from './icons';
import { GarbageProps } from './props';
import { EffectsRenderer } from './effects';
import { RoadTint } from './roadTint';
import { TrafficRenderer } from './traffic';
import { TransitRenderer } from './transit';
import { PortRenderer } from './ports';
import { CrossingRenderer } from './crossings';
import { RailVehicleRenderer } from './railVehicles';
import { StreetLightRenderer } from './streetLights';
import { PedestrianRenderer } from './pedestrians';
import { TiltShift } from './tiltShift';
import { PhotoLens, type PhotoLook } from './photo';
import { DisasterRenderer } from './disasters';
import { pureSeason, WeatherRenderer, worldLook, type WeatherLook } from './weather';
import type { Season, WeatherKind } from '../data/climate';

export interface RenderStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  trees: number;
  icons: number;
  vehicles: number;
  fires: number;
  cars: number;
  /** Milliseconds per frame the visible cars take to move (M19). */
  trafficMs: number;
  walkers: number;
  /** Street lamps placed, and how dark it is (0 day … 1 night). */
  lamps: number;
  night: number;
  /** Disaster effects on screen: dust bursts so far, funnels, flood sheets, falling meteors, craters, closed roads. */
  disasters: {
    dust: number;
    funnels: number;
    floods: number;
    meteors: number;
    craters: number;
    closures: number;
  };
  buses: number;
  /** Trams, passenger trains and freight trains drawn (M20). */
  rail: { tram: number; train: number; freight: number };
  /** Planes and ships drawn (M23). */
  ports: { planes: number; ships: number };
  smoke: number;
}

/** Photo mode's view (M16): the lens, time of day, field of view and whether zones show. */
export interface PhotoView extends PhotoLook {
  /** Hour to light the scene at, or null for the city's own clock. */
  hour: number | null;
  /** Season and weather to show (M22), or null for the city's own. */
  season: Season | null;
  weather: WeatherKind | null;
  /** Vertical field of view, degrees. */
  fov: number;
  zones: boolean;
}

/** Photo mode's season and weather over the city's own look (M22). */
function photoWeather(p: PhotoView, base: WeatherLook): Partial<WeatherLook> {
  const out: Partial<WeatherLook> = {};
  if (p.season) {
    out.season = pureSeason(p.season);
    out.snow = p.season === 'winter' ? Math.max(0.7, base.snow) : 0;
  }
  if (p.weather) {
    out.kind = p.weather;
    out.strength = p.weather === 'clear' ? 0 : 0.85;
    out.wet = p.weather === 'rain' || p.weather === 'storm' ? 1 : p.weather === 'heat' ? 0 : base.wet;
    if (p.weather === 'snow') out.snow = Math.max(0.7, out.snow ?? base.snow);
  }
  return out;
}

/** Normal vertical field of view, degrees. */
export const DEFAULT_FOV = 45;

/** Owns the Three.js scene. Reads ClientWorld; never mutates the simulation. */
export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 1, 14000);
  readonly controller: CameraController;
  readonly lighting: Lighting;
  readonly terrain: TerrainRenderer;
  readonly water: WaterRenderer;
  readonly trees: TreeRenderer;
  readonly roads: RoadRenderer;
  readonly zones: ZoneRenderer;
  readonly ghost: GhostRenderer;
  readonly buildings: BuildingRenderer;
  readonly civics: CivicRenderer;
  readonly vehicles: VehicleRenderer;
  readonly icons: IconRenderer;
  readonly garbage: GarbageProps;
  readonly effects: EffectsRenderer;
  readonly traffic: TrafficRenderer;
  /** Milliseconds per frame the visible cars take to move (smoothed). */
  trafficMs = 0;
  readonly transit: TransitRenderer;
  /** Trams and trains (M20). */
  readonly railVehicles: RailVehicleRenderer;
  readonly crossings: CrossingRenderer;
  readonly ports: PortRenderer;
  readonly streetLights: StreetLightRenderer;
  readonly pedestrians: PedestrianRenderer;
  readonly tiltShift = new TiltShift();
  readonly lens = new PhotoLens();
  /** Photo mode's view while it's on (M16). */
  photo: PhotoView | null = null;
  /** Helpers hidden for photo mode, and whether each was showing. */
  private hidden: { obj: { visible: boolean }; was: boolean }[] = [];
  readonly disasters: DisasterRenderer;
  readonly weather: WeatherRenderer;
  /** A look to show instead of the city's own weather (photo mode, dev scenes); null for the city's. */
  weatherOverride: Partial<WeatherLook> | null = null;
  /** Tilt-shift blur when zoomed in (a player setting). */
  tiltShiftOn = false;
  /** Draw-distance setting: scales how far the fog sits. */
  fogScale = 1;
  /** Route of the selected car. */
  readonly routeTint: RoadTint;
  /** Road ribbons for the service coverage data maps. */
  readonly coverageMap: RoadTint;
  private time = 0;
  private tmpSize = new Vector2();
  private treePoints: { x: number; z: number }[] = [];
  private treeRebuildAt = 0;
  lastStats: RenderStats = {
    calls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    trees: 0,
    icons: 0,
    vehicles: 0,
    fires: 0,
    cars: 0,
    trafficMs: 0,
    walkers: 0,
    lamps: 0,
    night: 0,
    disasters: { dust: 0, funnels: 0, floods: 0, meteors: 0, craters: 0, closures: 0 },
    buses: 0,
    rail: { tram: 0, train: 0, freight: 0 },
    ports: { planes: 0, ships: 0 },
    smoke: 0,
  };

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly world: ClientWorld,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    // PCF is soft-filtered in this three.js (PCFSoftShadowMap is deprecated and falls back to it).
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.lighting = new Lighting(this.scene);
    // Seasons and weather (M22): shared uniforms for the ground, roads, buildings and trees.
    this.weather = new WeatherRenderer(world);
    this.scene.add(this.weather.points);
    this.terrain = new TerrainRenderer(world);
    this.terrain.weather = this.weather.uniforms;
    this.scene.add(this.terrain.group);
    this.water = new WaterRenderer();
    this.scene.add(this.water.mesh);
    this.roads = new RoadRenderer(world);
    this.roads.useWeather(this.weather.uniforms);
    this.scene.add(this.roads.group);
    this.zones = new ZoneRenderer(world);
    this.scene.add(this.zones.group);
    this.buildings = new BuildingRenderer(world, this.terrain.uniforms, this.weather.uniforms);
    this.scene.add(this.buildings.group);
    this.civics = new CivicRenderer(world, this.buildings.lodMaterials);
    this.scene.add(this.civics.group);
    this.vehicles = new VehicleRenderer(world);
    this.scene.add(this.vehicles.group);
    this.icons = new IconRenderer(world);
    this.scene.add(this.icons.points);
    this.garbage = new GarbageProps(world);
    this.scene.add(this.garbage.mesh);
    this.effects = new EffectsRenderer(world, this.vehicles, this.buildings.heights, this.civics.heights);
    this.effects.models = {
      civic: (c) => this.civics.model(c),
      building: (b) => this.buildings.model(b),
    };
    this.scene.add(this.effects.group);
    this.coverageMap = new RoadTint((x, z) => world.heightAt(x, z), 'diverging', 0.85);
    this.scene.add(this.coverageMap.group);
    this.traffic = new TrafficRenderer(world, (seg, s, x, z) => world.roadHeight(seg, s, x, z));
    this.scene.add(this.traffic.group);
    this.pedestrians = new PedestrianRenderer(world, (seg, s, x, z) => world.roadHeight(seg, s, x, z));
    this.scene.add(this.pedestrians.group);
    this.disasters = new DisasterRenderer(world);
    this.scene.add(this.disasters.group);
    this.transit = new TransitRenderer(world, (seg, s, x, z) => world.roadHeight(seg, s, x, z));
    this.scene.add(this.transit.group);
    this.railVehicles = new RailVehicleRenderer(world, (seg, s, x, z) => world.roadHeight(seg, s, x, z));
    this.scene.add(this.railVehicles.group);
    // Level-crossing barriers come down while a train is near, and cars wait (Phase 2 review).
    this.crossings = new CrossingRenderer(this.roads);
    this.railVehicles.group.add(this.crossings.mesh);
    this.traffic.closedCrossings = this.railVehicles.holding;
    this.traffic.barrierDown = (node) => this.crossings.downShare(node);
    this.traffic.trainEta = this.railVehicles.eta;
    // Trams and cars keep out of each other's way (Phase 2 review).
    this.traffic.trams = this.railVehicles.tramBodies;
    this.railVehicles.traffic = this.traffic;
    this.ports = new PortRenderer(world);
    this.scene.add(this.ports.group);
    this.streetLights = new StreetLightRenderer(world);
    this.scene.add(this.streetLights.group);
    this.routeTint = new RoadTint((x, z) => world.heightAt(x, z), 'sequential', 0.7);
    this.scene.add(this.routeTint.group);
    this.ghost = new GhostRenderer((x, z) => world.heightAt(x, z));
    this.scene.add(this.ghost.group);
    this.trees = new TreeRenderer(world);
    this.trees.weather = this.weather.uniforms;
    this.trees.blocked = (x, z) =>
      this.roads.onRoad(x, z, 1.5) || this.onBuilding(x, z) || this.world.civicAt(x, z) !== null;
    // Garden trees: a hand-made model's tree_spots, planted with the game's own seasonal trees.
    this.trees.lotTrees = (minX, minZ, maxX, maxZ) => {
      const out: Placement[] = [];
      const plant = (m: ModelData, o: { x: number; y: number; z: number; angle: number; side: number }) => {
        const t = m.trees;
        if (!t?.length) return;
        const yaw = buildingYaw(o);
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        for (let i = 0; i < t.length; i += 3) {
          const x = o.x + t[i]! * c + t[i + 2]! * s;
          const z = o.z - t[i]! * s + t[i + 2]! * c;
          if (x >= minX && x < maxX && z >= minZ && z < maxZ) out.push(lotTree(x, o.y + t[i + 1]!, z));
        }
      };
      const pad = 40;
      for (const id of world.bldHash.query({
        minX: minX - pad,
        minZ: minZ - pad,
        maxX: maxX + pad,
        maxZ: maxZ + pad,
      })) {
        const b = world.buildings.get(id);
        if (b && (b.state === 1 || b.state === 2)) plant(this.buildings.model(b), b);
      }
      for (const c of world.civics.values()) {
        if (c.x < minX - 200 || c.x > maxX + 200 || c.z < minZ - 200 || c.z > maxZ + 200) continue;
        plant(this.civics.model(c), c);
      }
      return out;
    };
    this.trees.rebuildAll();
    this.scene.add(this.trees.group);
    // Names for debugging (the test API's render breakdown).
    const named: [{ name: string }, string][] = [
      [this.terrain.group, 'terrain'],
      [this.water.mesh, 'water'],
      [this.roads.group, 'roads'],
      [this.zones.group, 'zones'],
      [this.buildings.group, 'buildings'],
      [this.civics.group, 'civics'],
      [this.vehicles.group, 'vehicles'],
      [this.icons.points, 'icons'],
      [this.garbage.mesh, 'garbage'],
      [this.effects.group, 'effects'],
      [this.coverageMap.group, 'coverageMap'],
      [this.traffic.group, 'traffic'],
      [this.pedestrians.group, 'pedestrians'],
      [this.disasters.group, 'disasters'],
      [this.transit.group, 'transit'],
      [this.railVehicles.group, 'railVehicles'],
      [this.ports.group, 'ports'],
      [this.streetLights.group, 'streetLights'],
      [this.routeTint.group, 'routeTint'],
      [this.ghost.group, 'ghost'],
      [this.trees.group, 'trees'],
    ];
    for (const [o, name] of named) o.name = name;
    world.onCivics((changed) => {
      for (const id of changed) {
        const c = world.civics.get(id);
        if (c) this.treePoints.push({ x: c.x, z: c.z });
      }
    });
    const lots = new Map<number, { x: number; z: number }>();
    for (const b of world.buildings.values()) lots.set(b.id, { x: b.x, z: b.z });
    world.onBuildings((changed, removed) => {
      for (const id of changed) {
        const b = world.buildings.get(id);
        if (!b) continue;
        this.treePoints.push({ x: b.x, z: b.z });
        lots.set(id, { x: b.x, z: b.z });
      }
      // A building that goes takes its garden trees with it.
      for (const id of removed) {
        const at = lots.get(id);
        if (at) this.treePoints.push(at);
        lots.delete(id);
      }
    });
    world.onNet((c) => {
      const pts: { x: number; z: number }[] = [];
      for (const id of c.segments) {
        const s = world.netState.segments.get(id);
        if (!s) continue;
        const a = world.netState.nodes.get(s.a);
        const b = world.netState.nodes.get(s.b);
        if (a) pts.push(a);
        if (b) pts.push(b);
        pts.push({ x: s.cx, z: s.cz });
      }
      for (const id of c.nodes) {
        const n = world.netState.nodes.get(id);
        if (n) pts.push(n);
      }
      if (pts.length) this.trees.rebuildAround(pts);
    });
    // Earthworks (M13): everything laid on the ground follows it.
    world.onTerrain((box) => {
      this.terrain.refresh(box);
      this.roads.refresh(box);
      this.zones.refresh(box);
      this.trees.rebuildBox(box);
    });

    this.controller = new CameraController(this.camera, canvas, (x, z) => world.heightAt(x, z));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Car, zoned or civic building under a screen position. */
  pick(
    clientX: number,
    clientY: number,
  ): { kind: 'building' | 'civic' | 'car' | 'walker' | 'road' | 'stop'; id: number } | null {
    const ground = this.controller.screenToGround(clientX, clientY);
    if (ground) {
      const walker = this.pedestrians.walkerAt(ground.x, ground.z, 1.4);
      if (walker) return { kind: 'walker', id: walker.id };
      const car = this.traffic.carAt(ground.x, ground.z, 3.5);
      if (car) return { kind: 'car', id: car.id };
      // Bus and tram stops (M20), for their line.
      const stop = this.transit.stopAt(ground.x, ground.z);
      if (stop !== null) return { kind: 'stop', id: stop };
    }
    const cam = this.camera.position;
    const end = ground ?? cam.clone().add(new Vector3(0, -1, 0));
    const dir = end.clone().sub(cam);
    const len = dir.length();
    dir.normalize();
    for (let t = 0; t <= len + 1; t += 1.5) {
      const x = cam.x + dir.x * t;
      const y = cam.y + dir.y * t;
      const z = cam.z + dir.z * t;
      const c = this.world.civicAt(x, z);
      if (c && y <= c.y + (this.civics.heights.get(c.id) ?? 8) + 0.5) return { kind: 'civic', id: c.id };
      const b = this.world.buildingAt(x, z, -0.5);
      if (b && y <= b.y + (this.buildings.heights.get(b.id) ?? 5) + 0.5)
        return { kind: 'building', id: b.id };
    }
    // Roads (M19): the one under the cursor, for its traffic and one-way and junction controls.
    if (ground) {
      const net = this.world.net;
      const hit = net.nearestSegment(ground, 20);
      if (hit && hit.d <= net.halfWidth(hit.seg) + 1) return { kind: 'road', id: hit.seg };
    }
    return null;
  }

  /** Building under a screen position: marches the view ray and tests lot boxes by height. */
  pickBuilding(clientX: number, clientY: number): number | null {
    const ground = this.controller.screenToGround(clientX, clientY);
    const cam = this.camera.position;
    const end = ground ?? cam.clone().add(new Vector3(0, -1, 0));
    const dir = end.clone().sub(cam);
    const len = dir.length();
    dir.normalize();
    for (let t = 0; t <= len + 1; t += 1.5) {
      const x = cam.x + dir.x * t;
      const y = cam.y + dir.y * t;
      const z = cam.z + dir.z * t;
      const b = this.world.buildingAt(x, z, -0.5);
      if (b && y <= b.y + (this.buildings.heights.get(b.id) ?? 5) + 0.5) return b.id;
    }
    return null;
  }

  /** Is (x, z) inside a building lot? Keeps trees off lots. */
  onBuilding(x: number, z: number): boolean {
    return this.world.buildingAt(x, z, 1) !== null;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Build every building mesh the view needs now, rather than a chunk a frame (tests, screenshots). */
  flushBuildings(): void {
    this.buildings.flushAll();
    this.civics.update(this.camera.position, this.buildings.range, true);
    // Garden trees of buildings just built, too (normally planted within half a second).
    if (this.treePoints.length) {
      this.trees.rebuildAround(this.treePoints);
      this.treePoints = [];
    }
  }

  setShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.lighting.sun.castShadow = on;
  }

  /** Graphics settings: resolution, shadows and their detail, draw distance, crowd sizes. */
  applyGraphics(g: {
    pixelRatio: number;
    shadows: boolean;
    shadowMap: number;
    fogScale: number;
    treeDetail: number;
    crowd: number;
  }): void {
    const ratio = Math.min(window.devicePixelRatio || 1, g.pixelRatio);
    if (this.renderer.getPixelRatio() !== ratio) {
      this.renderer.setPixelRatio(ratio);
      this.resize();
    }
    this.setShadows(g.shadows);
    const shadow = this.lighting.sun.shadow;
    if (shadow.mapSize.x !== g.shadowMap) {
      shadow.mapSize.set(g.shadowMap, g.shadowMap);
      shadow.map?.dispose();
      shadow.map = null;
    }
    this.fogScale = g.fogScale;
    // Coarser pixels show less: the levels of detail hand over sooner (High at 2× is the full range).
    this.buildings.lodScale = Math.max(0.45, Math.pow(ratio / 2, 0.7));
    this.trees.lodDistance = g.treeDetail;
    this.pedestrians.crowd = g.crowd;
    this.weather.drops = Math.round(9000 * g.crowd);
    this.traffic.maxCars = Math.round(360 * g.crowd);
  }

  /**
   * Photo mode on or off (M16): hides what isn't part of the city (problem icons, the tool ghost and
   * selection, route and coverage ribbons), and lets the camera come lower and closer.
   */
  setPhoto(view: PhotoView | null): void {
    if (view && !this.photo) {
      this.hidden = [
        this.icons.points,
        this.ghost.group,
        this.routeTint.group,
        this.coverageMap.group,
        this.zones.group,
      ].map((obj) => ({ obj, was: obj.visible }));
      for (const h of this.hidden) h.obj.visible = false;
    } else if (!view && this.photo) {
      for (const h of this.hidden) h.obj.visible = h.was;
      this.hidden = [];
      this.camera.fov = DEFAULT_FOV;
      this.lens.dispose();
    }
    this.photo = view;
    this.controller.photo = !!view;
  }

  /** Scene groups hidden in photo mode (tests check nothing of the interface is drawn). */
  get photoHidden(): string[] {
    return this.photo
      ? ['icons', 'ghost', 'routeTint', 'coverageMap', ...(this.photo.zones ? [] : ['zones'])]
      : [];
  }

  /**
   * The view as a PNG at `scale` times the screen's resolution (M16): the frame is drawn again at
   * that size and read straight from the canvas, so nothing of the interface can be in it.
   */
  capture(scale: number): { blob: Promise<Blob | null>; width: number; height: number } {
    const prev = this.renderer.getPixelRatio();
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const gl = this.renderer.getContext();
    const maxSide = Math.min(
      this.renderer.capabilities.maxTextureSize,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    );
    // Up to `scale` × the screen's pixels, within what the GPU can hold (and ~36 MP).
    let ratio = (window.devicePixelRatio || 1) * scale;
    ratio = Math.min(ratio, maxSide / Math.max(w, h), Math.sqrt(36e6 / (w * h)));
    this.renderer.setPixelRatio(ratio);
    this.resize();
    this.frame(0);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    // toBlob copies the canvas as it is now, so the size can go back straight away.
    const blob = new Promise<Blob | null>((res) => this.canvas.toBlob(res, 'image/png'));
    this.renderer.setPixelRatio(prev);
    this.resize();
    return { blob, width: size.x, height: size.y };
  }

  frame(dt: number): void {
    this.time += dt;
    const p = this.photo;
    if (p) {
      this.camera.fov = p.fov;
      this.zones.group.visible = p.zones;
    }
    this.controller.update(dt);
    // Data maps are read in flat daylight, whatever the time; photo mode can pick its own hour.
    const hour =
      this.terrain.uniforms.uOverlayOn.value > 0.5 ? 13 : (p?.hour ?? hourOfDay(this.world.displayTick));
    const l = this.lighting;
    const bufH0 = this.renderer.getDrawingBufferSize(this.tmpSize).y;
    const pxm = bufH0 / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    // Data maps are read in clear weather too.
    const mapOn = this.terrain.uniforms.uOverlayOn.value > 0.5;
    const base = worldLook(this.world);
    const look = { ...base, ...(this.weatherOverride ?? {}), ...(p ? photoWeather(p, base) : {}) };
    if (mapOn) Object.assign(look, { kind: 'clear', strength: 0 });
    this.weather.update(
      dt,
      this.time,
      look,
      this.controller.target,
      this.controller.current.distance,
      pxm,
      this.camera.position,
    );
    l.update(hour);
    l.applyWeather(this.weather);
    l.follow(
      this.camera.position,
      this.controller.target,
      this.controller.current.distance * 0.9,
      this.camera.far,
    );
    l.fog.near = Math.max(900, this.controller.current.distance * 1.1) * this.fogScale;
    l.fog.far = Math.max(7500, this.controller.current.distance * 3.5) * this.fogScale;
    // Fog, rain and snow close the view in; heat hazes the distance (M22).
    const wf = this.weather.fog;
    l.fog.near *= (1 - 0.92 * wf) * (1 - 0.3 * this.weather.haze);
    l.fog.far *= (1 - 0.8 * wf) * (1 - 0.35 * this.weather.haze);
    this.renderer.toneMappingExposure = (1.0 + l.night * 0.12) * (1 - 0.12 * this.weather.overcast);
    this.terrain.update(this.time);
    this.buildings.update(l.night, this.camera.position);
    this.civics.update(this.camera.position, this.buildings.range);
    this.vehicles.update(this.world.displayTick);
    this.traffic.night = l.night;
    const t0 = performance.now();
    this.traffic.update(this.world.displayTick);
    // Visible cars' own cost (M19: following and giving way), smoothed.
    this.trafficMs = this.trafficMs * 0.9 + (performance.now() - t0) * 0.1;
    this.pedestrians.update(this.world.displayTick, this.controller.current);
    this.streetLights.update(l.night);
    this.transit.update(this.world.displayTick);
    this.railVehicles.update(this.world.displayTick);
    this.crossings.update(this.world.displayTick, this.railVehicles.closed);
    this.ports.update(this.world.displayTick);
    this.icons.update(this.time, this.buildings.heights, this.civics.heights);
    this.garbage.update();
    const bufH = this.renderer.getDrawingBufferSize(this.tmpSize).y;
    this.traffic.setScale(bufH / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    const pxPerMetre = bufH / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.effects.update(this.time, pxPerMetre, windAngle(this.world.options.seed, this.world.displayTick));
    this.disasters.update(dt, this.world.displayTick, pxPerMetre);
    this.camera.position.add(this.disasters.shake);
    // Trees under new buildings: rebuilt at most twice a second.
    if (this.treePoints.length && this.time - this.treeRebuildAt > 0.5) {
      this.treeRebuildAt = this.time;
      this.trees.rebuildAround(this.treePoints);
      this.treePoints = [];
    }
    this.trees.update();
    this.trees.updateLod(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    this.water.update(this.time);
    const wu = this.water.material.uniforms;
    wu.uSky!.value.copy(l.horizon);
    wu.uSunDir!.value.copy(l.sunDir);
    wu.uSunColor!.value.copy(l.sunColor);
    wu.uLight!.value = l.light;

    this.renderer.info.reset();
    // Photo mode draws through its lens when it has anything to do.
    const lensOn = p && (p.dof > 0 || p.tiltShift > 0 || p.grade !== 'natural');
    if (lensOn) this.lens.render(this.renderer, this.scene, this.camera, p);
    else this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info;
    const stats = { calls: info.render.calls, triangles: info.render.triangles };
    if (this.tiltShiftOn && !p) {
      const d = this.controller.current.distance;
      this.tiltShift.apply(this.renderer, Math.min(1, Math.max(0, (520 - d) / 380)));
    }
    this.lastStats = {
      calls: stats.calls,
      triangles: stats.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      trees: this.trees.instanceCount,
      icons: this.icons.count,
      vehicles: this.vehicles.positions.size,
      fires: this.effects.fires,
      cars: this.traffic.count,
      trafficMs: Math.round(this.trafficMs * 100) / 100,
      walkers: this.pedestrians.count,
      lamps: this.streetLights.count,
      night: this.lighting.night,
      disasters: { ...this.disasters.stats },
      buses: this.transit.busCount,
      rail: { ...this.railVehicles.counts },
      ports: { ...this.ports.counts },
      smoke: this.effects.smokeParticles,
    };
  }
}
