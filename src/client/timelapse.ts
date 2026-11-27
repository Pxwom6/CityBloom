/**
 * The timelapse's recorder (M45): while a city plays, every `TIMELAPSE.step` game ticks it draws one
 * small frame from one of two fixed views, taking turns (the whole map, and an orbit of the busiest
 * part of town), always by day, and keeps it in IndexedDB with the city's population then; past its
 * limits a view's frames are thinned evenly. Only on this machine: a shared city records on each
 * player's own, and nothing is sent.
 */
import type { Game } from '../game';
import { MAP_SIZE } from '../data/world';
import type { CameraPose } from '../render/camera';
import { TICKS_PER_MONTH } from '../sim/time';
import { TimelapseStore, type CityRecord } from './timelapseStore';
import { TIMELAPSE, busiestCell, orbitCentre, thinFrames, type TimelapseView } from './timelapseThin';

/** The hour every frame is lit at (early afternoon: long enough shadows to read the town). */
const FRAME_HOUR = 13.5;

/** The whole map, from high over its middle (the overview's pose). */
export const WIDE_POSE: CameraPose = {
  x: MAP_SIZE / 2,
  z: MAP_SIZE / 2 + 150,
  distance: 2750,
  yaw: 0.28,
  tilt: 0,
};

/** A new city's timelapse key (kept beside the city in its saves). */
export function newTimelapseKey(): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return `tl-${[...b].map((x) => x.toString(36).padStart(2, '0')).join('')}`;
}

export interface TimelapseInfo {
  key: string;
  startTick: number;
  late: boolean;
  frames: Record<TimelapseView, number>;
  bytes: number;
}

export class TimelapseRecorder {
  /** The city being recorded (null: none, e.g. the menu or a battle's viewer). */
  key: string | null = null;
  private rec: CityRecord | null = null;
  /** Game ticks between frames (test builds may take a longer one: `setTimelapseStep`). */
  step: number = TIMELAPSE.step;
  private nextTick = -1;
  private turn = 0;
  private busy = false;
  private orbit: { x: number; z: number; score: number } | null = null;
  private orbitMonth = -1;
  private yaw = 0.3;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  /** The last capture's main-thread time (ms), and the slowest so far (the frame budget's log). */
  lastMs = 0;
  worstMs = 0;
  captures = 0;
  /** Why the last frame wasn't kept (an encoder or a store that failed), for the tests. */
  error: string | null = null;

  constructor(
    private game: Game,
    readonly store = new TimelapseStore(),
  ) {}

  /**
   * Start recording this city under `key` (null: a new key; the city is older than its recording
   * unless it was founded just now). Resolves with the key, to keep beside the city in its saves.
   */
  async begin(key: string | null, founded: boolean): Promise<string> {
    const k = key ?? newTimelapseKey();
    this.key = k;
    this.nextTick = -1;
    this.turn = 0;
    this.orbit = null;
    const tick = this.game.world.stats.tick;
    const kept = await this.store.city(k).catch(() => null);
    this.rec = kept ?? {
      id: k,
      name: this.game.world.stats.cityName,
      startTick: tick,
      // An older city (saved before timelapses came, or before this browser recorded it) starts now.
      late: !founded,
      lastAt: Date.now(),
      bytes: 0,
      frames: { wide: 0, orbit: 0 },
    };
    if (!kept) await this.store.putCity(this.rec).catch(() => undefined);
    this.game.notify();
    return k;
  }

  stop(): void {
    this.key = null;
    this.rec = null;
  }

  info(): TimelapseInfo | null {
    const r = this.rec;
    return r && this.key
      ? { key: this.key, startTick: r.startTick, late: r.late, frames: { ...r.frames }, bytes: r.bytes }
      : null;
  }

  /** Is this the moment to keep frames? Only a city being played on this screen, setting on. */
  private recording(): boolean {
    const g = this.game;
    return (
      !!this.key &&
      g.settings.timelapse &&
      g.mode === 'play' &&
      !g.photo &&
      !g.readOnly &&
      !g.viewing &&
      !g.watchingRun &&
      !g.lessonTown &&
      document.visibilityState === 'visible'
    );
  }

  /** Each frame, before the player's: a capture when the city has passed the next step. */
  frame(): void {
    if (!this.recording() || this.busy) return;
    const tick = this.game.world.stats.tick;
    if (this.nextTick < 0) this.nextTick = (Math.floor(tick / this.step) + 1) * this.step;
    if (tick < this.nextTick) return;
    // However many steps were jumped (a fast-forward, a tab in the background), one frame.
    this.nextTick = (Math.floor(tick / this.step) + 1) * this.step;
    this.capture();
  }

  /** The pose of a view now. */
  pose(view: TimelapseView): CameraPose {
    if (view === 'wide') return WIDE_POSE;
    const w = this.game.world;
    const month = Math.floor(w.stats.tick / TICKS_PER_MONTH);
    if (month !== this.orbitMonth || !this.orbit) {
      this.orbitMonth = month;
      this.orbit = orbitCentre(this.orbit, busiestCell(w.buildings.values()));
    }
    const hw = w.netState.nodes.get(w.highway.connect);
    const at = this.orbit ?? { x: (hw?.x ?? MAP_SIZE / 2) + 250, z: hw?.z ?? MAP_SIZE / 2 };
    return { x: at.x, z: at.z, distance: TIMELAPSE.orbitDistance, yaw: this.yaw, tilt: 0 };
  }

  /** Draw one frame of the next view and keep it. */
  capture(): void {
    const key = this.key;
    const rec = this.rec;
    if (!key || !rec) return;
    const view: TimelapseView = this.turn++ % 2 === 0 ? 'wide' : 'orbit';
    const t0 = performance.now();
    const c = (this.canvas ??= makeCanvas());
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;
    this.game.renderer.captureView(this.pose(view), ctx, TIMELAPSE.width, TIMELAPSE.height, FRAME_HOUR);
    if (view === 'orbit') this.yaw += TIMELAPSE.orbitTurn;
    this.lastMs = performance.now() - t0;
    this.worstMs = Math.max(this.worstMs, this.lastMs);
    this.captures++;
    const tick = this.game.world.stats.tick;
    const population = this.game.world.stats.population;
    this.busy = true;
    void encode(c)
      .then(async (blob) => {
        if (this.key !== key) return;
        await this.store.putFrame({ city: key, view, tick, population, bytes: blob.size, blob }, rec);
        // Within the view's limits: its older frames thinned evenly.
        const frames = await this.store.frames(key, view);
        const drop = new Set(thinFrames(frames, TIMELAPSE.perView, TIMELAPSE.cityBytes / 2));
        if (drop.size)
          await this.store.dropFrames(
            key,
            view,
            frames.filter((f) => drop.has(f.tick)),
            rec,
          );
        await this.store.makeRoom(key);
        this.error = null;
      })
      .catch((e: unknown) => {
        this.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        this.busy = false;
        this.game.notify();
      });
  }
}

function makeCanvas(): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(TIMELAPSE.width, TIMELAPSE.height);
  const c = document.createElement('canvas');
  c.width = TIMELAPSE.width;
  c.height = TIMELAPSE.height;
  return c;
}

/** A frame as JPEG, encoded off the frame. */
function encode(c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality: TIMELAPSE.quality });
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The frame could not be encoded'))),
      'image/jpeg',
      TIMELAPSE.quality,
    ),
  );
}
