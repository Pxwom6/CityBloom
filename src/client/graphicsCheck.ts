/**
 * First-launch graphics check (M15). While the main menu first circles its demo town, time the
 * frames at the high preset and pick the preset this device can hold, so weaker laptops start on a
 * lighter one. Runs once per device (the result is kept in the settings); Settings can run it again.
 */
import type { Quality, Settings } from './settings';

export type GraphicsPreset = Quality;

/** What each preset sets. */
export const GRAPHICS_PRESETS: Record<
  GraphicsPreset,
  Pick<Settings, 'quality' | 'shadows' | 'drawDistance'>
> = {
  low: { quality: 'low', shadows: false, drawDistance: 'near' },
  medium: { quality: 'medium', shadows: true, drawDistance: 'medium' },
  high: { quality: 'high', shadows: true, drawDistance: 'medium' },
};

export const CHECK = {
  /** Frames in the first moments compile shaders and upload meshes: not counted. */
  warmupMs: 1500,
  /** Then frames are timed for this long (and at least `minFrames` of them)… */
  measureMs: 2500,
  minFrames: 8,
  /** …but a very slow device is judged after this long whatever it has managed. */
  maxMs: 9000,
  /** Median frame time that still counts as smooth at high (≈ 45 fps), and at medium (25 fps). */
  highMs: 22,
  mediumMs: 40,
};

/** Renderers that draw on the CPU: always the light preset. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

export interface CheckResult {
  preset: GraphicsPreset;
  /** Median frame time measured at the high preset (0 when the renderer alone decided). */
  frameMs: number;
  frames: number;
  gpu: string;
  /** Why, in a few words for the player ("about 24 fps", "software rendering"). */
  reason: string;
}

/** The preset for a measured median frame time, the graphics renderer's name and CPU cores. */
export function choosePreset(
  frameMs: number,
  gpu: string,
  cores: number,
): { preset: GraphicsPreset; reason: string } {
  if (SOFTWARE.test(gpu)) return { preset: 'low', reason: 'software rendering' };
  const fps = `about ${Math.round(1000 / Math.max(frameMs, 1))} fps`;
  if (frameMs > CHECK.mediumMs) return { preset: 'low', reason: fps };
  if (frameMs > CHECK.highMs) return { preset: 'medium', reason: fps };
  // A dual-core machine may draw the menu smoothly but struggles once a big city is ticking.
  if (cores > 0 && cores <= 2) return { preset: 'medium', reason: `${cores} processor cores` };
  return { preset: 'high', reason: fps };
}

/** The graphics renderer's name, as the browser reports it. */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

/** Feed it every animation frame; it answers once. */
export class GraphicsCheck {
  result: CheckResult | null = null;
  /** Time on screen since the check began (time in a hidden tab doesn't count). */
  private elapsed = 0;
  private last = -1;
  private readonly deltas: number[] = [];

  constructor(
    readonly gpu: string,
    private readonly cores: number,
  ) {}

  /** `now` is the frame's timestamp (ms); frames while the tab is hidden are throttled and skipped. */
  frame(now: number, visible: boolean): CheckResult | null {
    if (this.result) return null;
    if (SOFTWARE.test(this.gpu)) return this.finish(0);
    if (!visible) {
      this.last = -1;
      return null;
    }
    if (this.last >= 0) {
      const dt = now - this.last;
      this.elapsed += dt;
      if (this.elapsed > CHECK.warmupMs) this.deltas.push(dt);
    }
    this.last = now;
    const t = this.elapsed;
    const enough = t - CHECK.warmupMs >= CHECK.measureMs && this.deltas.length >= CHECK.minFrames;
    if (!enough && t < CHECK.maxMs) return null;
    const sorted = [...this.deltas].sort((a, b) => a - b);
    // Nothing timed by the deadline means frames longer than the whole window: very slow.
    return this.finish(sorted.length ? sorted[sorted.length >> 1]! : CHECK.maxMs);
  }

  private finish(frameMs: number): CheckResult {
    const { preset, reason } = choosePreset(frameMs, this.gpu, this.cores);
    this.result = { preset, frameMs, frames: this.deltas.length, gpu: this.gpu, reason };
    return this.result;
  }
}
