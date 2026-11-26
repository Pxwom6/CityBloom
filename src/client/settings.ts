/**
 * Player settings, kept in localStorage (they're per device, not per city): sound, graphics, interface
 * and game options. DESIGN.md §5.
 */
import type { WeatherIntensity } from '../data/climate';
import type { UnitQuality } from '../render/units';

/** Graphics quality; `phone` (M49) is below Low: lighter, for phones and small tablets. */
export type Quality = 'phone' | 'low' | 'medium' | 'high';
export type DrawDistance = 'near' | 'medium' | 'far';
/** How wheel input is read (M14): detected automatically, or fixed to a mouse or a trackpad. */
export type PointerDevice = 'auto' | 'mouse' | 'trackpad';
export const POINTER_DEVICES: PointerDevice[] = ['auto', 'mouse', 'trackpad'];

export interface Settings {
  /** Volumes, 0–1. */
  masterVolume: number;
  effectsVolume: number;
  ambientVolume: number;
  muted: boolean;
  /** Miniature-style blur at the top and bottom of the view when zoomed in. */
  tiltShift: boolean;
  /** Resolution scale, shadow detail and crowd sizes. */
  quality: Quality;
  shadows: boolean;
  /** How far the fog sits and where trees switch to low detail. */
  drawDistance: DrawDistance;
  /** Size of the interface, 0.8–1.4. */
  uiScale: number;
  /** Pan the camera when the pointer is at the edge of the screen. */
  edgeScroll: boolean;
  /** Mouse wheel zooms; a trackpad's two-finger swipe pans and pinch zooms. */
  pointer: PointerDevice;
  /** Random disasters for new cities (the current city's switch is in its disasters menu). */
  disasters: boolean;
  /** Elections every four years for new cities (M17; never in sandbox). */
  elections: boolean;
  /** Seasons, and how wild the weather is (0 off … 3 wild), for this city and new ones (M22). */
  seasons: boolean;
  weather: WeatherIntensity;
  /** Minutes of real time between autosaves; 0 turns autosave off. */
  autosaveMinutes: number;
  /** Contextual tips for new players, and the ones already shown. */
  tips: boolean;
  seenTips: string[];
  /** Step of the running tutorial, or -1 when none is running. */
  tutorialStep: number;
  /** The tutorial was left for now (M42): its card is hidden until "Continue the tutorial". */
  tutorialAway: boolean;
  /** The first-problem lessons already shown (M42: a fire, a power cut, a jam), each once. */
  tutorialSeen: string[];
  /** The card a player joining a friend's room sees the first time has been read (M42). */
  roomIntro: boolean;
  /** Learn's lessons played to the end (M42). */
  lessonsDone: string[];
  /**
   * Tone down the atom bomb's flash (M40 step 11): a short fade in place of the white-out, and no shake.
   * Its default follows the system's "reduce motion" setting. Read by the effects (`src/render/atom.ts`).
   */
  reduceFlashes: boolean;
  /** The first-launch graphics check has run (or the player chose graphics settings first). */
  graphicsChecked: boolean;
  /** The preset that check picked for this device, if it ran. */
  autoGraphics: Quality | null;
  /**
   * Send crash reports (M41): errors, failed saves and desyncs go to the game's maker, without names,
   * chat, cities or anything typed. On unless the player turns it off.
   */
  crashReports: boolean;
  /** The one sentence saying what crash reports send and where the switch is has been shown. */
  reportsNotice: boolean;
  /**
   * The most frames a second drawn (M49): 0 as many as the screen shows, else 30 or 60. The
   * first-launch check sets 30 on a phone.
   */
  fpsCap: FpsCap;
  /**
   * Battery saver (M49): at most 30 frames a second, a lower resolution, and still scenes drawn
   * even less often.
   */
  batterySaver: boolean;
}

export type FpsCap = 0 | 30 | 60;
export const FPS_CAPS: FpsCap[] = [0, 60, 30];

/** Does the system ask for less motion? False where there is no window to ask (tests, the worker). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  effectsVolume: 0.8,
  ambientVolume: 0.6,
  muted: false,
  tiltShift: false,
  quality: 'high',
  shadows: true,
  drawDistance: 'medium',
  uiScale: 1,
  edgeScroll: false,
  pointer: 'auto',
  disasters: true,
  elections: true,
  seasons: true,
  weather: 2,
  autosaveMinutes: 5,
  tips: true,
  seenTips: [],
  tutorialStep: -1,
  tutorialAway: false,
  tutorialSeen: [],
  roomIntro: false,
  lessonsDone: [],
  reduceFlashes: prefersReducedMotion(),
  graphicsChecked: false,
  autoGraphics: null,
  crashReports: true,
  reportsNotice: false,
  fpsCap: 0,
  batterySaver: false,
};

export const QUALITIES: Quality[] = ['phone', 'low', 'medium', 'high'];
export const DRAW_DISTANCES: DrawDistance[] = ['near', 'medium', 'far'];
export const AUTOSAVE_CHOICES = [0, 2, 5, 10];
export const UI_SCALE = { min: 0.8, max: 1.4 };

/**
 * Renderer knobs for each quality level. `maxPixels` caps the drawing buffer (M49: a tablet's big
 * screen at Phone); `trees` the share of trees drawn, `water` the water's full ripples (1) or one
 * gentle swell (0), `effects` the share of smoke and flame particles, `lodGap` a scale on how long a
 * stale building chunk waits before it is built again (M49). `shadowMap` is each of the sun's shadow cascades, of
 * which `cascades` are used (M26); `ao` the ambient occlusion's taps a pixel (0: off) and whether it is smoothed; `glow`
 * the soft glow round lights at night; `samples` the frame's multisampling while one of them is
 * on; `aoFar` how far off the occlusion has faded (the camera distance); `ground` the grass's
 * fields, hedgerows and worn paths out in the country (M27; 0: tone patches only); `closeShadowHz`
 * how often the shadow map is drawn again close up (M28; 0: every frame).
 */
export const QUALITY_PARAMS: Record<
  Quality,
  {
    pixelRatio: number;
    maxPixels: number;
    trees: number;
    water: 0 | 1;
    effects: number;
    lodGap: number;
    /** Scale on where buildings hand over to their lighter versions (M49: Phone sooner). */
    lodDistance: number;
    shadowMap: number;
    crowd: number;
    ao: number;
    aoBlur: boolean;
    glow: boolean;
    samples: number;
    cascades: 1 | 2;
    aoFar: number;
    ground: 0 | 1;
    closeShadowHz: number;
    /**
     * Units (M34): how far the near and far versions reach before dots, whether parts move, their
     * shadows, and per base how many squads drill, vehicles and boats go out, and aircraft fly.
     * M40: the atom bomb's cloud and trail puffs and the fallout's tint on the ground (off at Low).
     */
    units: UnitQuality;
  }
> = {
  phone: {
    pixelRatio: 1,
    maxPixels: 1_000_000,
    trees: 0.5,
    water: 0,
    effects: 0.4,
    lodGap: 2,
    lodDistance: 0.7,
    shadowMap: 512,
    crowd: 0.25,
    ao: 0,
    aoBlur: false,
    glow: false,
    samples: 2,
    cascades: 1,
    aoFar: 0,
    ground: 0,
    closeShadowHz: 30,
    units: {
      near: 80,
      far: 500,
      animate: false,
      shadows: false,
      drill: 1,
      patrol: 1,
      fly: 1,
      shields: 0,
      dust: 0,
      atomPuffs: 80,
      atomTrail: 16,
      atomTint: 0,
    },
  },
  low: {
    pixelRatio: 0.75,
    maxPixels: Infinity,
    trees: 1,
    water: 1,
    effects: 1,
    lodGap: 1,
    lodDistance: 1,
    shadowMap: 1024,
    crowd: 0.4,
    ao: 0,
    aoBlur: false,
    glow: false,
    samples: 4,
    cascades: 1,
    aoFar: 0,
    ground: 0,
    closeShadowHz: 60,
    units: {
      near: 110,
      far: 700,
      animate: false,
      shadows: false,
      drill: 2,
      patrol: 1,
      fly: 1,
      shields: 0,
      dust: 0,
      atomPuffs: 120,
      atomTrail: 24,
      atomTint: 0,
    },
  },
  medium: {
    pixelRatio: 1,
    maxPixels: Infinity,
    trees: 1,
    water: 1,
    effects: 1,
    lodGap: 1,
    lodDistance: 1,
    shadowMap: 1536,
    crowd: 0.7,
    ao: 4,
    aoBlur: false,
    glow: true,
    samples: 2,
    cascades: 1,
    aoFar: 600,
    ground: 1,
    closeShadowHz: 60,
    units: {
      near: 180,
      far: 1000,
      animate: true,
      shadows: true,
      drill: 4,
      patrol: 2,
      fly: 2,
      shields: 1,
      dust: 0.5,
      atomPuffs: 300,
      atomTrail: 40,
      atomTint: 1,
    },
  },
  high: {
    pixelRatio: 2,
    maxPixels: Infinity,
    trees: 1,
    water: 1,
    effects: 1,
    lodGap: 1,
    lodDistance: 1,
    shadowMap: 2048,
    crowd: 1,
    ao: 12,
    aoBlur: true,
    glow: true,
    samples: 4,
    cascades: 2,
    aoFar: 900,
    ground: 1,
    closeShadowHz: 0,
    units: {
      near: 260,
      far: 1400,
      animate: true,
      shadows: true,
      drill: 8,
      patrol: 3,
      fly: 4,
      shields: 2,
      dust: 1,
      atomPuffs: 500,
      atomTrail: 60,
      atomTint: 1,
    },
  },
};

/** Fog distance scale and tree detail distance (metres) for each draw distance. */
export const DRAW_DISTANCE_PARAMS: Record<DrawDistance, { fog: number; treeDetail: number }> = {
  near: { fog: 0.65, treeDetail: 450 },
  medium: { fog: 1, treeDetail: 750 },
  far: { fog: 1.5, treeDetail: 1200 },
};

const KEY = 'citybloom.settings';

function num(v: unknown, d: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
}

function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

function oneOf<T extends string | number>(v: unknown, options: readonly T[], d: T): T {
  return options.includes(v as T) ? (v as T) : d;
}

/** Validate a stored record field by field, so older or damaged records still load. */
export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    masterVolume: num(r.masterVolume, d.masterVolume, 0, 1),
    effectsVolume: num(r.effectsVolume, d.effectsVolume, 0, 1),
    ambientVolume: num(r.ambientVolume, d.ambientVolume, 0, 1),
    muted: bool(r.muted, d.muted),
    tiltShift: bool(r.tiltShift, d.tiltShift),
    quality: oneOf(r.quality, QUALITIES, d.quality),
    shadows: bool(r.shadows, d.shadows),
    drawDistance: oneOf(r.drawDistance, DRAW_DISTANCES, d.drawDistance),
    uiScale: num(r.uiScale, d.uiScale, UI_SCALE.min, UI_SCALE.max),
    edgeScroll: bool(r.edgeScroll, d.edgeScroll),
    pointer: oneOf(r.pointer, POINTER_DEVICES, d.pointer),
    disasters: bool(r.disasters, d.disasters),
    elections: bool(r.elections, d.elections),
    seasons: bool(r.seasons, d.seasons),
    weather: Math.round(num(r.weather, d.weather, 0, 3)) as WeatherIntensity,
    autosaveMinutes: oneOf(r.autosaveMinutes, AUTOSAVE_CHOICES, d.autosaveMinutes),
    tips: bool(r.tips, d.tips),
    seenTips: Array.isArray(r.seenTips)
      ? r.seenTips.filter((t): t is string => typeof t === 'string').slice(0, 100)
      : [],
    tutorialStep: num(r.tutorialStep, d.tutorialStep, -1, 99),
    tutorialAway: bool(r.tutorialAway, d.tutorialAway),
    roomIntro: bool(r.roomIntro, d.roomIntro),
    lessonsDone: Array.isArray(r.lessonsDone)
      ? r.lessonsDone.filter((t): t is string => typeof t === 'string').slice(0, 20)
      : [],
    tutorialSeen: Array.isArray(r.tutorialSeen)
      ? r.tutorialSeen.filter((t): t is string => typeof t === 'string').slice(0, 20)
      : [],
    reduceFlashes: bool(r.reduceFlashes, d.reduceFlashes),
    graphicsChecked: bool(r.graphicsChecked, d.graphicsChecked),
    autoGraphics: QUALITIES.includes(r.autoGraphics as Quality) ? (r.autoGraphics as Quality) : null,
    crashReports: bool(r.crashReports, d.crashReports),
    reportsNotice: bool(r.reportsNotice, d.reportsNotice),
    fpsCap: oneOf(r.fpsCap, FPS_CAPS, d.fpsCap),
    batterySaver: bool(r.batterySaver, d.batterySaver),
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return parseSettings({});
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or storage full: settings just won't persist.
  }
}
