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
  phone: { quality: 'phone', shadows: false, drawDistance: 'near' },
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

/** What kind of device the game runs on (M49): a phone, a tablet, or a computer. */
export type DeviceKind = 'phone' | 'tablet' | 'computer';

export interface DeviceInfo {
  /** The browser's user agent. */
  ua: string;
  /** Touch points the screen takes (0 on most computers). */
  touchPoints: number;
  /** Whether the main pointer is coarse (a finger). */
  coarse: boolean;
  /** The screen's size in CSS pixels. */
  screenW: number;
  screenH: number;
}

/**
 * A phone, a tablet or a computer, from what the browser says it is and its screen and pointer
 * (M49). iPadOS reports itself as a Mac, so a "Mac" with a touch screen is a tablet; a touch screen
 * whose short side is under 600 px is a phone whatever it says.
 */
export function deviceKind(d: DeviceInfo): DeviceKind {
  const short = Math.min(d.screenW, d.screenH);
  if (/iPhone|iPod|Windows Phone/i.test(d.ua)) return 'phone';
  if (/Android/i.test(d.ua)) return /Mobile/i.test(d.ua) || short < 600 ? 'phone' : 'tablet';
  if (/iPad|Tablet/i.test(d.ua) || (/Macintosh/i.test(d.ua) && d.touchPoints > 1))
    return short < 600 ? 'phone' : 'tablet';
  if (d.coarse && d.touchPoints > 0 && short > 0)
    return short < 600 ? 'phone' : short < 1050 ? 'tablet' : 'computer';
  return 'computer';
}

/** This device's kind (a computer where there is no window to ask). */
export function currentDevice(): DeviceKind {
  try {
    return deviceKind({
      ua: navigator.userAgent,
      touchPoints: navigator.maxTouchPoints || 0,
      coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
      screenW: screen.width,
      screenH: screen.height,
    });
  } catch {
    return 'computer';
  }
}

export interface CheckResult {
  preset: GraphicsPreset;
  /** The kind of device it was decided for (M49; a computer when not known). */
  device?: DeviceKind;
  /** Median frame time measured at the high preset (0 when the renderer alone decided). */
  frameMs: number;
  frames: number;
  gpu: string;
  /** Why, in a few words for the player ("about 24 fps", "software rendering"). */
  reason: string;
}

/**
 * The preset for a measured median frame time, the graphics renderer's name and CPU cores, on a
 * device of this kind (M49): a phone is always Phone; a tablet at most Medium, and Phone when slow.
 */
export function choosePreset(
  frameMs: number,
  gpu: string,
  cores: number,
  device: DeviceKind = 'computer',
): { preset: GraphicsPreset; reason: string } {
  if (device === 'phone') return { preset: 'phone', reason: 'a phone' };
  if (SOFTWARE.test(gpu)) return { preset: 'low', reason: 'software rendering' };
  const fps = `about ${Math.round(1000 / Math.max(frameMs, 1))} fps`;
  if (device === 'tablet')
    return {
      preset: frameMs > CHECK.mediumMs ? 'phone' : frameMs > CHECK.highMs ? 'low' : 'medium',
      reason: `a tablet, ${fps}`,
    };
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
    private readonly device: DeviceKind = 'computer',
  ) {}

  /** `now` is the frame's timestamp (ms); frames while the tab is hidden are throttled and skipped. */
  frame(now: number, visible: boolean): CheckResult | null {
    if (this.result) return null;
    if (SOFTWARE.test(this.gpu) || this.device === 'phone') return this.finish(0);
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
    const { preset, reason } = choosePreset(frameMs, this.gpu, this.cores, this.device);
    this.result = { preset, device: this.device, frameMs, frames: this.deltas.length, gpu: this.gpu, reason };
    return this.result;
  }
}
