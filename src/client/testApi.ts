import type { WeatherLook } from '../render/weather';
import type { CivicData } from '../sim/protocol';
import { Vector3, type Mesh } from 'three';
import { CIVIC } from '../data/civic';
import { roadsidePose } from '../sim/world/civic';
import { ROAD_TYPES, isRail } from '../data/roads';
import type { Game } from '../game';
import type { ClientWorld } from './world';
import type { Command, CommandResult } from '../sim/commands';
import type { CameraPose, CameraPresetName } from '../render/camera';
import type { RenderStats } from '../render/renderer';
import type { BuildingData, CityStats, DisasterData } from '../sim/protocol';
import { ZONED_DEFS } from '../data/buildings';
import { CELL } from '../data/zones';
import { renderSounds, type SoundCheck } from '../audio/check';
import { BUILD_ID } from '../config';
import type { CheckResult } from './graphicsCheck';
import type { Chronicle } from '../sim/systems/chronicle';
import type { SupplyBalance } from '../sim/systems/utilities';
import type { PhotoState } from '../game';
import { HEIGHT_RES, HEIGHT_STEP } from '../data/world';
import type { ModelData } from '../render/assets/builder';
import { handmade } from '../render/assets/handmade';
import { touching } from '../render/buildings';
import type { AmbientMix } from '../audio/mix';

/** A box in the world: a footprint centred on x, z, `w` along x, `d` along z and `h` tall (m). */
export interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface TestApi {
  ready: boolean;
  dispatch(cmd: Command): Promise<CommandResult>;
  /** Roundabout mode (P5): the size chosen, the last preview's ring and whether it fits, and the short road. */
  getRing(): {
    size: number | null;
    radius: number | null;
    ok: boolean | null;
    short: number[];
    at: { x: number; z: number } | null;
  };
  /** Roads cut off from the highway (P1), and those the traffic map paints red for it. */
  getRoadIslands(): { islands: { segs: number[]; length: number }[]; painted: number[] };
  /** The sim's dry run of a command: what it would cost and do, changing nothing. */
  preview(cmd: Command): Promise<CommandResult>;
  getState(): Promise<
    CityStats & {
      renderStats: RenderStats;
      tick: number;
      highwayZ: number;
      /** Where the regional railway comes in (M20). */
      railway: { x: number; z: number } | null;
      segments: number;
      nodes: number;
      zoned: { R: number; C: number; I: number };
      /** Roads shaded by the service placement preview / the coverage data map. */
      coveragePreview: number;
      coverageMap: number;
      /** The options the city was founded with. */
      options: ClientWorld['options'];
    }
  >;
  /** Place a civic building beside any road that has room (test helper). Returns its id or null. */
  placeCivic(def: string, near?: { x: number; z: number }): Promise<number | null>;
  /** Id of the first civic building with this def, or null. */
  findCivic(def: string): number | null;
  /** Civic buildings on the client mirror. */
  getCivics(): { id: number; def: string; x: number; z: number; angle: number; stage?: number }[];
  /** Vehicles as last drawn. */
  getVehicles(): { id: number; kind: string; phase: string; x: number; z: number }[];
  /** Road segment nearest (x, z) within 20 m. */
  segmentAt(
    x: number,
    z: number,
  ): {
    id: number;
    type: string;
    name: string;
    oneway: number;
    deck: boolean;
    a: number;
    b: number;
    tram: boolean;
  } | null;
  /** The junction nearest a point within 20 m (M19): its roads, and its roundabout's radius. */
  junctionAt(x: number, z: number): { id: number; arms: number; roundabout: number; kind: string } | null;
  /** Volume/capacity on a segment at the rush-hour peak. */
  segVC(id: number): number;
  /** Visible cars: where they are, which way they face, ticks spent held up, and the ring they're on. */
  getCars(): {
    id: number;
    x: number;
    z: number;
    heading: number;
    waited: number;
    ring: number | null;
    /** The road it's on, its lane (0 inner, 1 outer), which leg of how many, and metres along it. */
    seg: number;
    lane: number;
    leg: number;
    legs: number;
    t: number;
  }[];
  /**
   * Level crossings (Phase 2 review): each crossing's node and place, whether a train holds it
   * closed, and how far its barrier arms are down (0 up, 1 down).
   */
  getCrossings(): { node: number; x: number; z: number; closed: boolean; down: number }[];
  /** Trams on the streets as cars see them: front, rear, heading and points along the track (Phase 2 review). */
  getTrams(): { fx: number; fz: number; rx: number; rz: number; hx: number; hz: number; pts: number[] }[];
  /** Pedestrians on screen (close zoom only), with their trip purpose and route length. */
  getWalkers(): { id: number; x: number; z: number; purpose: string; route: number }[];
  /** Bus stops and lines on the client mirror: stops per line, and each line's mode and riders (M20). */
  getTransit(): {
    stops: number;
    lines: number[];
    modes: { mode: string; stops: number; vehicles: number; riders: number }[];
    freight: { id: number; trucks: number }[];
    /** Where each stop's shelter stands (click there to select it). */
    shelters: { id: number; x: number; z: number; tram: boolean }[];
  };
  /** Districts on the client mirror (M21): each with its cells painted, and the one selected. */
  getDistricts(): {
    list: { id: number; name: string; color: number; policies: string[]; cells: number }[];
    selected: number;
  };
  /** Trams and trains as last drawn (M20): the front of each. */
  getRailVehicles(): { kind: 'tram' | 'train' | 'freight'; x: number; y: number; z: number }[];
  /** Planes and ships drawn last frame (M23), with their positions. */
  getPorts(): {
    counts: { planes: number; ships: number };
    shown: { kind: 'plane' | 'ship'; x: number; y: number; z: number }[];
  };
  /** Terrain height (water below 0.6). */
  heightAt(x: number, z: number): number;
  /** Show a data map (or null to hide). */
  setOverlay(map: string | null): Promise<void>;
  /** Render-side building list (id, position, state). */
  getBuildings(): {
    id: number;
    x: number;
    z: number;
    state: number;
    zone: number;
    fire: number;
    flags: number;
  }[];
  /** Client (CSS pixel) coordinates of a world point on the ground. */
  worldToScreen(x: number, z: number): { x: number; y: number };
  /**
   * Earthworks as the client sees them (M13): samples changed from the generated terrain, the box
   * around them, the biggest cut and fill, and the terrain version.
   */
  /** The road ghost's last graded drawing (M13): quads per grade colour and cut/fill posts. */
  ghostGrade(): { ok: number; warn: number; bad: number; viaduct: number; posts: number };
  getTerrainEdits(): {
    edited: number;
    box: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
    maxCut: number;
    maxFill: number;
    version: number;
  };
  advance(ticks: number): Promise<number>;
  setCamera(preset: CameraPresetName | Partial<CameraPose>): void;
  getCamera(): CameraPose;
  hash(): Promise<string>;
  setSpeed(speed: 0 | 1 | 2 | 3): void;
  /** Every frame's interval (from one animation frame to the next) and work (the game's own frame), in ms, over `ms`. */
  recordFrames(ms: number): Promise<{ interval: number[]; work: number[] }>;
  /** Resolves after n rendered frames (lets screenshots settle). */
  waitFrames(n: number): Promise<void>;
  errors: string[];
  /**
   * Dev gallery: show client-side copies of zoned buildings (no sim state) in rows from `at`, one
   * row per def and `variants` columns. Screenshots only; the sim knows nothing about them.
   */
  showGallery(
    defs: string[],
    at: { x: number; z: number },
    variants: number,
    /** Column by column (repeating): under construction, abandoned, on fire, rubble… */
    states?: { state?: number; progress?: number; fire?: number; variant?: number }[],
  ): void;
  /** Every big project at every construction stage and finished, in rows from `at` (dev, M17). */
  showProjects(at: { x: number; z: number }): void;
  /**
   * Levels of detail (phase 3): draw one level everywhere (null: by distance, as in play), what is
   * on show now, and the model each zoned building wears.
   */
  /**
   * The view as drawn: the share of pixels that are lit-window warm, near white, and the mean
   * brightness (0–1). With a box (a building's lot up to its roof), only the part of the view it
   * covers on screen.
   */
  pixelStats(box?: Box): { warm: number; white: number; lum: number };
  /** As `pixelStats`, of a whole frame as the player sees it (the post pipeline's effects and all; M26). */
  frameStats(): { warm: number; white: number; lum: number };
  /** The pixels of a whole frame as the player sees it (RGBA, bottom row first; M26). */
  framePixels(): Uint8Array;
  setLod(level: 'near' | 'far' | 'sky' | null): void;
  /**
   * How different the view is drawn at one level of detail and at another (null: by distance, as
   * in play): the share of pixels that differ visibly, and the mean difference per channel (0–255).
   * With a box, only the part of the view it covers on screen.
   */
  compareLod(
    a: 'near' | 'far' | 'sky' | null,
    b: 'near' | 'far' | 'sky' | null,
    box?: Box,
  ): { changed: number; mean: number };
  /**
   * Streets (M27): junction approaches painted with a zebra crossing or a give-way line, and the
   * benches, bins and planters along the pavements (and whether they're on show).
   */
  getStreets(): { zebra: number; giveWay: number; props: number; propsShown: boolean };
  /**
   * Neighbours (M28): pairs of finished buildings whose lots touch, and how many of them look the
   * same: drawn with the very same model (the same type, lot size and look), or with the same
   * hand-made design painted and mirrored the same way (on lots of different depths).
   */
  getNeighbours(): { pairs: number; identical: number; looks: number };
  /** Dev: the visible cars' instance colours per model (count, how many are black, a sample). */
  carColours(): Record<string, { count: number; black: number; hasColour: boolean; sample: number[] }>;
  /** The zone paint (M27): triangles and whether each part is shown (full look only while zoning). */
  getZoneLook(): Record<'zoned' | 'grid' | 'fill' | 'edge', { tris: number; shown: boolean }>;
  getLod(): {
    range: { nearStart: number; nearEnd: number; skyStart: number; skyEnd: number };
    buildings: Record<'plain' | 'near' | 'far' | 'sky', number>;
    civics: Record<'plain' | 'near' | 'far' | 'sky', number>;
    rebuilt: number;
  };
  getModels(): {
    id: number;
    def: string;
    w: number;
    d: number;
    look: number;
    /** The hand-made design it is drawn with (a file name without .glb), or null if generated. */
    hand: string | null;
    triangles: number;
    far: number;
    sky: number;
    trees: number;
  }[];
  /** Dev (phase 3): every hand-made design loaded, with the footprint it was accepted at (m). */
  getHandDesigns(): { id: string; kind: 'zoned' | 'civic' | 'annex'; def: string; w: number; d: number }[];
  /** A civic building's site, in metres. */
  civicSize(def: string): { w: number; d: number };
  /** Dev (phase 3): civic buildings side by side, wrapping after `width` metres; each with its add-ons, fill and stage. */
  showCivics(
    items: { def: string; variant?: number; modules?: string[]; fill?: number; stage?: number }[],
    at: { x: number; z: number },
    width: number,
  ): { id: number; def: string; x: number; z: number }[];
  /** Disasters under way, damaged and flooded roads and craters, as the client sees them. */
  getDisasters(): DisasterData;
  /** What a click at this screen position would select. */
  pickAt(x: number, y: number): { kind: string; id: number } | null;
  /** Change player settings (as the menu does); returns the tilt-shift frame count. */
  setSettings(patch: Record<string, unknown>): number;
  /** Render every sound effect and the ambient bed offline, and measure them. */
  renderSounds(): Promise<SoundCheck[]>;
  /** Visible meshes per top-level scene object, and how many of them cast shadows (dev). */
  renderBreakdown(): { name: string; meshes: number; shadow: number }[];
  /**
   * Triangles and draw calls each top-level scene object costs in the colour pass and in the
   * shadow pass of one frame drawn now (phase 3; dev and benchmarks).
   */
  passBreakdown(): {
    name: string;
    colour: number;
    shadow: number;
    colourCalls: number;
    shadowCalls: number;
  }[];
  /** Dev (M26): try the post pipeline's settings (and `samples`, `off`) on the running game; null goes back to the graphics settings'. */
  setPost(
    p: { aoSamples?: number; aoBlur?: boolean; glow?: boolean; samples?: number; off?: boolean } | null,
  ): void;
  /** Dev (M27): the country's fields and paths on (1) or off (0) on the running game, whatever the quality. */
  setGround(level: 0 | 1): void;
  /** Dev (M26): try how far shadows reach (camera distances) and when they split in two. */
  setShadowTweak(t: { reach?: number; split?: number; off?: boolean; floor?: number }): void;
  /** Is a top-level scene object (by name) shown? Null if there is none. */
  groupShown(name: string): boolean | null;
  /** Dev: show or hide a top-level scene object by name (what draws that?). */
  showGroup(name: string, visible: boolean): void;
  /** Dev (M26): try a tone mapping and exposure on the running game. */
  setTone(mapping: 'aces' | 'neutral' | 'agx' | 'none', exposure?: number): void;
  /**
   * How many sampled pixels of the current view a top-level scene object changes when it's shown.
   * Shadows are frozen for both renders, so this counts only the object's own drawing.
   */
  drawnPixels(name: string): number;
  /** The meshes in one top-level scene object (by name): visibility, size and bounds (dev). */
  inspectGroup(name: string): {
    name: string;
    visible: boolean;
    triangles: number;
    sphere: [number, number, number, number] | null;
    material: string;
  }[];
  /** Game shell state: menu or city, open screens, settings and what the renderer applied. */
  getShell(): {
    mode: 'menu' | 'play' | 'editor';
    screens: string[];
    slot: string | null;
    settings: Record<string, unknown>;
    applied: {
      pixelRatio: number;
      shadows: boolean;
      fogScale: number;
      uiScale: string;
      edgeScroll: boolean;
      pointer: 'auto' | 'mouse' | 'trackpad';
      detected: 'mouse' | 'trackpad';
      /** The frame's effects (M26): AO taps, its blur, glow, multisampling, shadow cascades. */
      ao: number;
      aoBlur: boolean;
      glow: boolean;
      samples: number;
      cascades: number;
      /** Fields and paths in the country (M27): 0 off, 1 on. */
      ground: number;
    };
    randomDisasters: boolean;
    tip: string | null;
    /** The build shown in the menu, and the service worker's state (M15). */
    build: string;
    app: { waiting: boolean; offlineReady: boolean; controlled: boolean };
    /** First-launch graphics check: running, and its last answer. */
    graphics: { checking: boolean; result: CheckResult | null };
  };
  /** Ask the server for a new version of the app now (M15). */
  checkForUpdate(): Promise<void>;
  /** City history as the sim holds it (M16). */
  getChronicle(): Promise<Chronicle>;
  /** What the city makes, uses, buys and sells of power, water and garbage, and the winter forecast (P20). */
  getSupply(): Promise<SupplyBalance>;
  /** The scenario being played (M18): its goals summary, and whether the brief or end screen is up. */
  getScenario(): {
    summary: CityStats['scenario'];
    brief: boolean;
    end: Game['scenarioEnd'];
  };
  /** Photo mode (M16): its state, what the renderer hides and draws, and where the camera is. */
  getPhoto(): {
    on: boolean;
    state: PhotoState | null;
    hidden: string[];
    lens: boolean;
    fov: number;
    follow: { x: number; z: number } | null;
    cameraY: number;
    groundY: number;
  };
  followNearest(kinds?: ('car' | 'walker' | 'bus' | 'vehicle')[]): boolean;
  /** Change photo mode's settings directly (dev scenes). */
  setPhoto(patch: Partial<PhotoState>): void;
  /** Seasons and weather (M22): force a look on screen (null for the city's own), and read it. */
  setWeatherLook(look: Partial<WeatherLook> | null): void;
  getWeather(): {
    sim: CityStats['weather'];
    look: WeatherLook;
    particles: number;
    strikes: number;
    overcast: number;
    fog: number;
  };
  /** Live audio state: context running, effects played, ambient mix and scheduled events. */
  getAudio(): {
    running: boolean;
    played: Record<string, number>;
    ambient: { mix: AmbientMix; events: Record<string, number> } | null;
  };
}

declare global {
  interface Window {
    __game?: TestApi;
  }
}

export function installTestApi(game: Game): TestApi {
  /** Where a dev-gallery building sits: on the highest ground under its footprint, as the sim seats lots. */
  const seat = (x: number, z: number, W: number, D: number): number => {
    let y = 0;
    for (let i = 0; i <= 8; i++)
      for (let j = 0; j <= 8; j++) y = Math.max(y, game.world.heightAt(x + (W * i) / 8, z + (D * j) / 8));
    return y;
  };
  /** Colours in the frame: lit windows, white, mean brightness (sampled every fourth pixel). */
  /** The part of the drawing buffer (x, y from the bottom left, w, h) a box in the world covers, or all of it. */
  const screenRect = (box?: Box): [number, number, number, number] => {
    const r = game.renderer;
    const gl = r.renderer.getContext();
    const [W, H] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    if (!box) return [0, 0, W, H];
    const ground = Math.max(0, game.world.heightAt(box.x, box.z));
    let [a, b, c, e] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const sx of [-0.5, 0.5])
      for (const sz of [-0.5, 0.5])
        for (const y of [0, box.h]) {
          const v = new Vector3(box.x + sx * box.w, ground + y, box.z + sz * box.d).project(r.camera);
          [a, b] = [Math.min(a, ((v.x + 1) / 2) * W), Math.min(b, ((v.y + 1) / 2) * H)];
          [c, e] = [Math.max(c, ((v.x + 1) / 2) * W), Math.max(e, ((v.y + 1) / 2) * H)];
        }
    const [x0, y0] = [Math.max(0, Math.floor(a)), Math.max(0, Math.floor(b))];
    return [x0, y0, Math.max(1, Math.min(W, Math.ceil(c)) - x0), Math.max(1, Math.min(H, Math.ceil(e)) - y0)];
  };
  const stats = (full: boolean, box?: Box) => {
    const r = game.renderer;
    const gl = r.renderer.getContext();
    const [x0, y0, w, h] = screenRect(box);
    if (full) r.frame(0);
    else {
      r.renderer.setRenderTarget(null);
      r.renderer.render(r.scene, r.camera);
    }
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let warm = 0;
    let white = 0;
    let lum = 0;
    let n = 0;
    for (let i = 0; i < px.length; i += 16) {
      const [red, green, blue] = [px[i]!, px[i + 1]!, px[i + 2]!];
      // A lit window: bright, and warmer than white.
      if (red > 215 && green > 185 && blue < green - 12 && blue > 110) warm++;
      if (red > 215 && green > 215 && blue > 215) white++;
      lum += 0.299 * red + 0.587 * green + 0.114 * blue;
      n++;
    }
    return { warm: warm / n, white: white / n, lum: lum / n / 255 };
  };
  const api: TestApi = {
    ready: true,
    dispatch: (cmd) => game.dispatch(cmd),
    preview: (cmd) => game.client.preview(cmd),
    getRing: () => game.tools.road.ringPreview(),
    getRoadIslands: () => ({
      islands: game.world
        .roadIslands()
        .list.map((i) => ({ segs: [...i.segs], length: Math.round(i.length) })),
      painted: game.overlay.active === 'traffic' ? [...game.overlay.islandPainted] : [],
    }),
    getState: async () => {
      const stats = await game.client.query<CityStats>({ type: 'summary' });
      const w = game.world;
      return {
        ...stats,
        renderStats: game.renderer.lastStats,
        highwayZ: w.netState.nodes.get(w.highway.connect)?.z ?? w.gen.params.highway.connectZ,
        railway: w.railway ? { ...w.netState.nodes.get(w.railway.connect)! } : null,
        segments: w.netState.segments.size,
        nodes: w.netState.nodes.size,
        zoned: countZones(game),
        coveragePreview: game.renderer.ghost.coveragePieces,
        coverageMap: game.renderer.coverageMap.pieces,
        options: { ...w.options },
      };
    },
    advance: async (ticks) => {
      const t = await game.client.advance(ticks);
      game.world.displayTick = t;
      return t;
    },
    setCamera: (preset) => game.setCamera(preset, true),
    getCamera: () => ({ ...game.renderer.controller.goal }),
    placeCivic: async (def, near) => {
      const d = CIVIC.get(def);
      if (!d) return null;
      const net = game.world.net;
      // Stations face a railway, tram depots a road with tram track (M20).
      const segs = [...game.world.netState.segments.values()]
        .filter((s) =>
          d.track === 'rail' ? isRail(s.type) : ROAD_TYPES[s.type].access && (!d.tram || s.tram),
        )
        .map((s) => ({ s, mid: net.curve(s.id).pointAt(net.curve(s.id).length / 2) }))
        .sort((a, b) =>
          near
            ? Math.hypot(a.mid.x - near.x, a.mid.z - near.z) - Math.hypot(b.mid.x - near.x, b.mid.z - near.z)
            : a.s.id - b.s.id,
        );
      for (const { s } of segs) {
        const len = net.curve(s.id).length;
        for (let at = d.w / 2 + 10; at < len - d.w / 2 - 10; at += 8) {
          for (const side of [1, -1] as const) {
            const pose = roadsidePose(net, s.id, at, side, d.d);
            const r = await game.dispatch({ type: 'placeBuilding', def, ...pose });
            if (r.ok) return r.created![0]!;
          }
        }
      }
      return null;
    },
    heightAt: (x, z) => game.world.heightAt(x, z),
    ghostGrade: () => ({ ...game.renderer.ghost.gradeStats }),
    getTerrainEdits: () => {
      const d = game.world.terrainDelta;
      let edited = 0;
      let maxCut = 0;
      let maxFill = 0;
      let box: { minX: number; minZ: number; maxX: number; maxZ: number } | null = null;
      for (let i = 0; i < d.length; i++) {
        if (!d[i]) continue;
        edited++;
        maxCut = Math.max(maxCut, -d[i]!);
        maxFill = Math.max(maxFill, d[i]!);
        const x = (i % HEIGHT_RES) * HEIGHT_STEP;
        const z = Math.floor(i / HEIGHT_RES) * HEIGHT_STEP;
        box = box
          ? {
              minX: Math.min(box.minX, x),
              minZ: Math.min(box.minZ, z),
              maxX: Math.max(box.maxX, x),
              maxZ: Math.max(box.maxZ, z),
            }
          : { minX: x, minZ: z, maxX: x, maxZ: z };
      }
      return { edited, box, maxCut, maxFill, version: game.world.terrainVersion };
    },
    segmentAt: (x, z) => {
      const hit = game.world.net.nearestSegment({ x, z }, 20);
      if (!hit) return null;
      const s = game.world.net.segment(hit.seg);
      return {
        id: hit.seg,
        type: s.type,
        name: s.name ?? '',
        oneway: s.oneway ?? 0,
        deck: !!s.deck,
        a: s.a,
        b: s.b,
        tram: !!s.tram,
      };
    },
    junctionAt: (x, z) => {
      const n = game.world.net.nearestNode({ x, z }, 20);
      if (!n) return null;
      return {
        id: n.id,
        arms: game.world.net.segmentsAt(n.id).length,
        roundabout: n.roundabout ?? 0,
        kind: game.world.junctionKind(n.id),
      };
    },
    segVC: (id) => game.world.segVC(id, 1),
    getCars: () =>
      game.renderer.traffic.cars.map((c) => ({
        id: c.id,
        x: c.x,
        z: c.z,
        heading: c.heading,
        waited: c.waited,
        ring: c.ring ? c.ring.node : null,
        seg: c.legs[c.leg]?.seg ?? -1,
        lane: c.lane,
        leg: c.leg,
        legs: c.legs.length,
        t: c.t,
      })),
    getCrossings: () =>
      [...game.renderer.roads.crossings.keys()].map((node) => {
        const n = game.world.netState.nodes.get(node);
        return {
          node,
          x: n?.x ?? 0,
          z: n?.z ?? 0,
          closed: game.renderer.railVehicles.closed.has(node),
          down: game.renderer.crossings.downShare(node),
        };
      }),
    getTrams: () => game.renderer.railVehicles.tramBodies.map((t) => ({ ...t, pts: [...t.pts] })),
    getWalkers: () =>
      game.renderer.pedestrians.walkers.map((w) => ({
        id: w.id,
        x: w.x,
        z: w.z,
        purpose: w.trip.purpose,
        route: w.legs.reduce((s, l) => s + Math.abs(l.s1 - l.s0), 0),
      })),
    getTransit: () => ({
      stops: game.world.stops.size,
      lines: game.world.lines.map((l) => l.stops.length),
      modes: game.world.lines.map((l) => ({
        mode: l.mode,
        stops: l.stops.length,
        vehicles: l.buses,
        riders: l.riders,
      })),
      freight: game.world.freight.map((f) => ({ id: f.id, trucks: f.trucks })),
      shelters: game.renderer.transit.shelters.map((s) => ({
        ...s,
        tram: !!game.world.stops.get(s.id)?.tram,
      })),
    }),
    getRailVehicles: () => game.renderer.railVehicles.fronts.map((f) => ({ ...f })),
    getPorts: () => ({
      counts: { ...game.renderer.ports.counts },
      shown: game.renderer.ports.shown.map((f) => ({ ...f })),
    }),
    getDistricts: () => {
      const w = game.world;
      const count = new Map<number, number>();
      for (const d of w.districtCells) if (d) count.set(d, (count.get(d) ?? 0) + 1);
      return {
        list: [...w.districts.values()].map((d) => ({
          ...d,
          policies: [...d.policies],
          cells: count.get(d.id) ?? 0,
        })),
        selected: game.districts.selected,
      };
    },
    findCivic: (def) => [...game.world.civics.values()].find((c) => c.def === def)?.id ?? null,
    getCivics: () =>
      [...game.world.civics.values()].map((c) => ({
        id: c.id,
        def: c.def,
        x: c.x,
        z: c.z,
        angle: c.angle,
        stage: c.stage,
      })),
    getVehicles: () =>
      [...game.renderer.vehicles.positions].map(([id, v]) => ({
        id,
        kind: v.kind,
        phase: v.phase,
        x: v.x,
        z: v.z,
      })),
    setOverlay: async (map) => {
      game.overlay.set(map as never);
      if (map) await game.overlay.refresh();
    },
    getBuildings: () =>
      [...game.world.buildings.values()].map((b) => ({
        id: b.id,
        x: b.x,
        z: b.z,
        state: b.state,
        zone: b.zone,
        fire: b.fire,
        flags: b.flags,
      })),
    worldToScreen: (x, z) => {
      const v = new Vector3(x, Math.max(0, game.world.heightAt(x, z)), z).project(game.renderer.camera);
      const rect = game.renderer.canvas.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
    hash: () => game.client.query<string>({ type: 'hash' }),
    setSpeed: (s) => game.setSpeed(s),
    recordFrames: (ms) =>
      new Promise((resolve) => {
        game.frameSamples = [];
        setTimeout(() => {
          const s = game.frameSamples ?? [];
          game.frameSamples = null;
          resolve({ interval: s.filter((_, i) => i % 2 === 0), work: s.filter((_, i) => i % 2 === 1) });
        }, ms);
      }),
    waitFrames: (n) =>
      new Promise((resolve) => {
        game.renderer.flushBuildings();
        let k = 0;
        const step = () => (++k >= n ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    errors: [],
    renderSounds,
    pickAt: (x, y) => game.renderer.pick(x, y),
    getDisasters: () => game.world.disasters,
    setSettings: (patch) => {
      game.updateSettings(patch);
      return game.renderer.tiltShift.frames;
    },
    renderBreakdown: () =>
      game.renderer.scene.children.map((o, i) => {
        let meshes = 0;
        let shadow = 0;
        o.traverseVisible((m) => {
          const mesh = m as Mesh & { count?: number; isMesh?: boolean; isPoints?: boolean };
          if (!(mesh.isMesh || mesh.isPoints)) return;
          if (mesh.count === 0) return;
          meshes++;
          if (mesh.castShadow) shadow++;
        });
        return { name: o.name || `${o.type}#${i}`, meshes, shadow };
      }),
    setGround: (level) => {
      game.renderer.groundDetail = level;
    },
    setPost: (p) => {
      const post = game.renderer.post;
      if (!p) {
        game.renderer.postOverride = null;
        game.applySettings();
        return;
      }
      post.settings = {
        aoSamples: p.off ? 0 : (p.aoSamples ?? post.settings.aoSamples),
        aoBlur: p.aoBlur ?? post.settings.aoBlur,
        glow: p.off ? false : (p.glow ?? post.settings.glow),
        samples: p.samples ?? post.settings.samples,
        aoFar: post.settings.aoFar,
      };
      game.renderer.postOverride = { ...post.settings };
    },
    setShadowTweak: (t) => {
      if (t.reach !== undefined) game.renderer.shadowReach = t.reach;
      if (t.split !== undefined) game.renderer.lighting.shadow.splitRatio = t.split;
      if (t.floor !== undefined) game.renderer.shadowFloor = t.floor;
      if (t.off) game.renderer.setShadows(false);
    },
    groupShown: (name) => game.renderer.scene.children.find((c) => c.name === name)?.visible ?? null,
    showGroup: (name, visible) => {
      const o = game.renderer.scene.children.find((c) => c.name === name);
      if (o) o.visible = visible;
    },
    setTone: (mapping, exposure) => {
      game.renderer.toneOverride = { mapping, exposure: exposure ?? 1 };
    },
    passBreakdown: () => {
      const r = game.renderer;
      const three = r.renderer;
      const scene = r.scene;
      const kids = scene.children;
      const was = kids.map((k) => k.visible);
      const auto = three.shadowMap.autoUpdate;
      const draw = (shadow: boolean) => {
        three.shadowMap.autoUpdate = false;
        three.shadowMap.needsUpdate = shadow;
        three.info.reset();
        three.render(scene, r.camera);
        return { tris: three.info.render.triangles, calls: three.info.render.calls };
      };
      const out: {
        name: string;
        colour: number;
        shadow: number;
        colourCalls: number;
        shadowCalls: number;
      }[] = [];
      try {
        kids.forEach((k, i) => {
          if (!was[i] || (k as { isLight?: boolean }).isLight || k.name === 'sky') return;
          // Only this object (and the lights and sky, which every shader needs).
          kids.forEach((o, j) => {
            o.visible = j === i || (was[j]! && ((o as { isLight?: boolean }).isLight || o.name === 'sky'));
          });
          const colour = draw(false);
          const both = draw(true);
          out.push({
            name: k.name || `${k.type}#${i}`,
            colour: colour.tris,
            shadow: both.tris - colour.tris,
            colourCalls: colour.calls,
            shadowCalls: both.calls - colour.calls,
          });
        });
      } finally {
        kids.forEach((k, i) => (k.visible = was[i]!));
        three.shadowMap.autoUpdate = auto;
        three.shadowMap.needsUpdate = true;
      }
      return out.filter((o) => o.colour || o.shadow);
    },
    drawnPixels: (name) => {
      const r = game.renderer;
      const group = r.scene.children.find((o) => o.name === name);
      if (!group) return 0;
      // Render to the canvas itself (an offscreen target would compile different shader programs)
      // and read it back straight away, sampling every 4th pixel each way.
      const gl = r.renderer.getContext();
      const [w, h] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
      const read = () => {
        r.renderer.setRenderTarget(null);
        r.renderer.render(r.scene, r.camera);
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const [visible, autoUpdate] = [group.visible, r.renderer.shadowMap.autoUpdate];
      r.renderer.shadowMap.autoUpdate = false;
      group.visible = false;
      const without = read();
      group.visible = true;
      const shown = read();
      group.visible = visible;
      r.renderer.shadowMap.autoUpdate = autoUpdate;
      let n = 0;
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4;
          const d =
            Math.abs(shown[i]! - without[i]!) +
            Math.abs(shown[i + 1]! - without[i + 1]!) +
            Math.abs(shown[i + 2]! - without[i + 2]!);
          if (d > 24) n++;
        }
      return n;
    },
    inspectGroup: (name) => {
      const group = game.renderer.scene.children.find((o) => o.name === name);
      const out: ReturnType<TestApi['inspectGroup']> = [];
      group?.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const g = m.geometry;
        const s = g.boundingSphere;
        const tris = (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
        out.push({
          name: m.name,
          visible: m.visible,
          triangles: Math.round(tris),
          sphere: s ? [s.center.x, s.center.y, s.center.z, s.radius] : null,
          material: (m.material as { type?: string }).type ?? '?',
        });
      });
      return out;
    },
    getShell: () => ({
      mode: game.mode,
      screens: [...game.screens],
      slot: game.slot,
      settings: { ...game.settings },
      applied: {
        pixelRatio: game.renderer.renderer.getPixelRatio(),
        shadows: game.renderer.renderer.shadowMap.enabled,
        fogScale: game.renderer.fogScale,
        uiScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
        edgeScroll: game.renderer.controller.edgeScroll,
        pointer: game.renderer.controller.pointerDevice,
        detected: game.renderer.controller.detected,
        ao: game.renderer.post.settings.aoSamples,
        aoBlur: game.renderer.post.settings.aoBlur,
        glow: game.renderer.post.settings.glow,
        samples: game.renderer.post.settings.samples,
        cascades: game.renderer.lighting.shadow.splitRatio === Infinity ? 1 : 2,
        ground: game.renderer.groundDetail,
      },
      randomDisasters: game.randomDisasters,
      tip: game.tip?.id ?? null,
      build: BUILD_ID,
      app: {
        waiting: game.updates.waiting,
        offlineReady: game.updates.offlineReady,
        controlled: !!navigator.serviceWorker?.controller,
      },
      graphics: { checking: !!game.graphicsCheck, result: game.graphicsResult },
    }),
    checkForUpdate: () => game.updates.check(),
    getChronicle: () => game.client.query<Chronicle>({ type: 'chronicle' }),
    getSupply: () => game.client.query<SupplyBalance>({ type: 'supply' }),
    getScenario: () => ({
      summary: game.world.stats.scenario,
      brief: game.scenarioBrief,
      end: game.scenarioEnd,
    }),
    getPhoto: () => {
      const r = game.renderer;
      const p = game.photo;
      const cam = r.camera.position;
      return {
        on: !!p,
        state: p ? { ...p } : null,
        hidden: r.photoHidden,
        lens: !!p && (p.dof > 0 || p.tiltShift > 0 || p.grade !== 'natural'),
        fov: r.camera.fov,
        follow: r.controller.follow ? { x: r.controller.follow.x, z: r.controller.follow.z } : null,
        cameraY: cam.y,
        groundY: game.world.heightAt(cam.x, cam.z),
      };
    },
    followNearest: (kinds) => game.followNearest(kinds),
    setPhoto: (patch) => game.setPhoto(patch),
    setWeatherLook: (look) => {
      game.renderer.weatherOverride = look;
      game.renderer.weather.snapNext = true;
    },
    getWeather: () => {
      const w = game.renderer.weather;
      return {
        sim: game.world.stats.weather,
        look: { ...w.look, season: [...w.look.season] as WeatherLook['season'] },
        particles: w.stats.particles,
        strikes: w.stats.strikes,
        overcast: w.overcast,
        fog: w.fog,
      };
    },
    showGallery: (defs, at, variants, states) => {
      const w = game.world;
      const upserts: BuildingData[] = [];
      let id = 9_000_000;
      let z = at.z;
      for (const row of defs) {
        // "R103" on the type's own lot, or "R103@2x3" on a lot of that many cells.
        const [key, size] = row.split('@');
        const def = ZONED_DEFS.get(key!);
        if (!def) continue;
        const [lw, ld] = size ? size.split('x').map(Number) : [def.w, def.d];
        const D = ld! * CELL;
        let x = at.x;
        for (let v = 0; v < variants; v++) {
          const W = lw! * CELL;
          upserts.push({
            id: id++,
            def: key!,
            zone: def.zone,
            density: def.density,
            wealth: def.wealth,
            level: def.level,
            x: x + W / 2,
            z: z + D / 2,
            y: seat(x, z, W, D),
            angle: 0,
            side: 1,
            w: lw!,
            d: ld!,
            state: 1,
            progress: 1,
            variant: v,
            flags: 0,
            fire: 0,
            ...(states?.[v % states.length] ?? {}),
          });
          x += W + 4;
        }
        z += D + 6;
      }
      w.applyFrame({ tick: w.stats.tick, stats: w.stats, buildings: { upserts, removed: [] } });
    },
    showCivics: (items, at, width) => {
      const w = game.world;
      const upserts: CivicData[] = [];
      let id = 9_700_000;
      let x = at.x;
      let z = at.z;
      let deep = 0;
      for (const it of items) {
        const def = CIVIC.get(it.def);
        if (!def) continue;
        if (x > at.x && x + def.w > at.x + width) {
          x = at.x;
          z += deep + 12;
          deep = 0;
        }
        upserts.push({
          id: id++,
          def: def.id,
          x: x + def.w / 2,
          z: z + def.d / 2,
          y: seat(x, z, def.w, def.d),
          angle: 0,
          side: 1,
          access: true,
          fill: it.fill ?? 0,
          out: 0,
          variant: it.variant ?? 0,
          damage: 0,
          flooded: false,
          modules: it.modules ?? [],
          stage: it.stage,
        });
        x += def.w + 12;
        deep = Math.max(deep, def.d);
      }
      w.applyFrame({ tick: w.stats.tick, stats: w.stats, civics: { upserts, removed: [] } });
      return upserts.map((c) => ({ id: c.id, def: c.def, x: c.x, z: c.z }));
    },
    setLod: (level) => {
      const f = level === null ? null : ['plain', 'near', 'far', 'sky'].indexOf(level);
      game.renderer.buildings.chunks.force = f;
      game.renderer.civics.chunks.force = f;
      game.renderer.flushBuildings();
    },
    frameStats: () => stats(true),
    framePixels: () => {
      const r = game.renderer;
      const gl = r.renderer.getContext();
      r.frame(0);
      const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    },
    pixelStats: (box) => stats(false, box),

    compareLod: (a, b, box) => {
      const r = game.renderer;
      const gl = r.renderer.getContext();
      const [x0, y0, w, h] = screenRect(box);
      const levels = ['plain', 'near', 'far', 'sky'];
      const read = (level: 'near' | 'far' | 'sky' | null) => {
        const f = level === null ? null : levels.indexOf(level);
        r.buildings.chunks.force = f;
        r.civics.chunks.force = f;
        r.buildings.update(r.buildings.uniforms.uNight.value);
        r.flushBuildings();
        r.renderer.setRenderTarget(null);
        r.renderer.render(r.scene, r.camera);
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const was = r.buildings.chunks.force;
      const A = read(a);
      const B = read(b);
      r.buildings.chunks.force = was;
      r.civics.chunks.force = was;
      r.buildings.update(r.buildings.uniforms.uNight.value);
      r.flushBuildings();
      let changed = 0;
      let sum = 0;
      let n = 0;
      for (let y = 0; y < h; y += 2)
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          const d =
            Math.abs(A[i]! - B[i]!) + Math.abs(A[i + 1]! - B[i + 1]!) + Math.abs(A[i + 2]! - B[i + 2]!);
          if (d > 24) changed++;
          sum += d / 3;
          n++;
        }
      return { changed: changed / n, mean: sum / n };
    },
    getNeighbours: () => {
      const r = game.renderer.buildings;
      const w = game.world;
      // Finished buildings (not being built, not rubble) and the model each is drawn with.
      const done = [...w.buildings.values()].filter((b) => b.state === 1 || b.state === 2);
      const model = new Map(done.map((b) => [b.id, r.model(b)]));
      let pairs = 0;
      let identical = 0;
      for (const b of done) {
        const reach = 4 * CELL + 2;
        for (const id of w.bldHash.query({
          minX: b.x - reach,
          minZ: b.z - reach,
          maxX: b.x + reach,
          maxZ: b.z + reach,
        })) {
          if (id <= b.id || !model.has(id)) continue;
          const o = w.buildings.get(id)!;
          if (!touching(b, o)) continue;
          pairs++;
          if (model.get(id) === model.get(b.id) || r.appearance(o) === r.appearance(b)) identical++;
        }
      }
      return { pairs, identical, looks: new Set(model.values()).size };
    },
    carColours: () => game.renderer.traffic.colourStats(),
    getZoneLook: () => game.renderer.zones.stats(),
    getStreets: () => {
      let zebra = 0;
      let giveWay = 0;
      for (const p of game.renderer.roads.paint.values()) {
        zebra += p.zebra;
        giveWay += p.giveWay;
      }
      const sp = game.renderer.streetProps;
      return { zebra, giveWay, props: sp.count, propsShown: sp.group.visible };
    },
    getLod: () => ({
      range: game.renderer.buildings.range,
      buildings: game.renderer.buildings.chunks.stats(),
      civics: game.renderer.civics.chunks.stats(),
      rebuilt: game.renderer.buildings.chunks.rebuilt + game.renderer.civics.chunks.rebuilt,
    }),
    getModels: () => {
      const r = game.renderer.buildings;
      const tris = (m: ModelData | undefined) => (m ? m.pos.length / 9 : 0);
      return [...game.world.buildings.values()].map((b) => {
        const m = r.model(b);
        return {
          id: b.id,
          def: b.def,
          w: b.w,
          d: b.d,
          look: r.look(b),
          hand: m.hand ?? null,
          triangles: tris(m),
          far: tris(m.far),
          sky: tris(m.sky),
          trees: (m.trees?.length ?? 0) / 3,
        };
      });
    },
    getHandDesigns: () =>
      handmade.list().map((m) => ({ id: m.id, kind: m.kind, def: m.def, w: m.w, d: m.d })),
    civicSize: (def) => ({ w: CIVIC.get(def)?.w ?? 0, d: CIVIC.get(def)?.d ?? 0 }),
    showProjects: (at) => {
      const w = game.world;
      const upserts: CivicData[] = [];
      let id = 9_500_000;
      let z = at.z;
      for (const def of [...CIVIC.values()].filter((d) => d.project)) {
        const n = def.project!.stages.length;
        let x = at.x;
        for (let stage = 0; stage <= n; stage++) {
          upserts.push({
            id: id++,
            def: def.id,
            x: x + def.w / 2,
            z: z + def.d / 2,
            y: seat(x, z, def.w, def.d),
            angle: 0,
            side: 1,
            access: true,
            fill: 0,
            out: 0,
            variant: 0,
            damage: 0,
            flooded: false,
            modules: [],
            stage: stage < n ? stage : undefined,
          });
          x += def.w + 12;
        }
        z += def.d + 14;
      }
      w.applyFrame({ tick: w.stats.tick, stats: w.stats, civics: { upserts, removed: [] } });
    },
    getAudio: () => ({
      running: game.audio?.running ?? false,
      played: { ...game.audio?.played },
      ambient: game.audio?.ambient ?? null,
    }),
  };
  window.__game = api;
  return api;
}

function countZones(game: Game): { R: number; C: number; I: number } {
  const out = { R: 0, C: 0, I: 0 };
  for (const b of game.world.netState.blocks.values()) {
    for (let i = 0; i < b.zone.length; i++) {
      if (!b.valid[i]) continue;
      if (b.zone[i] === 1) out.R++;
      else if (b.zone[i] === 2) out.C++;
      else if (b.zone[i] === 3) out.I++;
    }
  }
  return out;
}
