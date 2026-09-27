import { Vector3, type Mesh } from 'three';
import { CIVIC } from '../data/civic';
import { roadsidePose } from '../sim/world/civic';
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
import type { PhotoState } from '../game';
import { HEIGHT_RES, HEIGHT_STEP } from '../data/world';
import type { AmbientMix } from '../audio/mix';

export interface TestApi {
  ready: boolean;
  dispatch(cmd: Command): Promise<CommandResult>;
  getState(): Promise<
    CityStats & {
      renderStats: RenderStats;
      tick: number;
      highwayZ: number;
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
  getCivics(): { id: number; def: string; x: number; z: number; angle: number }[];
  /** Vehicles as last drawn. */
  getVehicles(): { id: number; kind: string; phase: string; x: number; z: number }[];
  /** Road segment nearest (x, z) within 20 m. */
  segmentAt(x: number, z: number): { id: number; type: string } | null;
  /** Volume/capacity on a segment at the rush-hour peak. */
  segVC(id: number): number;
  /** Visible cars (id and position). */
  getCars(): { id: number; x: number; z: number }[];
  /** Pedestrians on screen (close zoom only), with their trip purpose and route length. */
  getWalkers(): { id: number; x: number; z: number; purpose: string; route: number }[];
  /** Bus stops and lines on the client mirror. */
  getTransit(): { stops: number; lines: number[] };
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
  /** Resolves after n rendered frames (lets screenshots settle). */
  waitFrames(n: number): Promise<void>;
  errors: string[];
  /**
   * Dev gallery: show client-side copies of zoned buildings (no sim state) in rows from `at`, one
   * row per def and `variants` columns. Screenshots only; the sim knows nothing about them.
   */
  showGallery(defs: string[], at: { x: number; z: number }, variants: number): void;
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
    mode: 'menu' | 'play';
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
  const api: TestApi = {
    ready: true,
    dispatch: (cmd) => game.dispatch(cmd),
    getState: async () => {
      const stats = await game.client.query<CityStats>({ type: 'summary' });
      const w = game.world;
      return {
        ...stats,
        renderStats: game.renderer.lastStats,
        highwayZ: w.netState.nodes.get(w.highway.connect)!.z,
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
      const segs = [...game.world.netState.segments.values()]
        .filter((s) => s.type !== 'highway')
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
      return hit ? { id: hit.seg, type: game.world.net.segment(hit.seg).type } : null;
    },
    segVC: (id) => game.world.segVC(id, 1),
    getCars: () => game.renderer.traffic.cars.map((c) => ({ id: c.id, x: c.x, z: c.z })),
    getWalkers: () =>
      game.renderer.pedestrians.walkers.map((w) => ({
        id: w.id,
        x: w.x,
        z: w.z,
        purpose: w.trip.purpose,
        route: w.legs.reduce((s, l) => s + Math.abs(l.s1 - l.s0), 0),
      })),
    getTransit: () => ({ stops: game.world.stops.size, lines: game.world.lines.map((l) => l.stops.length) }),
    findCivic: (def) => [...game.world.civics.values()].find((c) => c.def === def)?.id ?? null,
    getCivics: () =>
      [...game.world.civics.values()].map((c) => ({ id: c.id, def: c.def, x: c.x, z: c.z, angle: c.angle })),
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
    waitFrames: (n) =>
      new Promise((resolve) => {
        game.renderer.buildings.flushAll();
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
    showGallery: (defs, at, variants) => {
      const w = game.world;
      const upserts: BuildingData[] = [];
      let id = 9_000_000;
      let z = at.z;
      for (const key of defs) {
        const def = ZONED_DEFS.get(key);
        if (!def) continue;
        const D = def.d * CELL;
        let x = at.x;
        for (let v = 0; v < variants; v++) {
          const W = def.w * CELL;
          upserts.push({
            id: id++,
            def: key,
            zone: def.zone,
            density: def.density,
            wealth: def.wealth,
            level: def.level,
            x: x + W / 2,
            z: z + D / 2,
            y: Math.max(0, w.heightAt(x + W / 2, z + D / 2)),
            angle: 0,
            side: 1,
            w: def.w,
            d: def.d,
            state: 1,
            progress: 1,
            variant: v,
            flags: 0,
            fire: 0,
          });
          x += W + 4;
        }
        z += D + 6;
      }
      w.applyFrame({ tick: w.stats.tick, stats: w.stats, buildings: { upserts, removed: [] } });
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
