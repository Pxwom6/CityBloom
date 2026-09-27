/**
 * Player settings, kept in localStorage (they're per device, not per city): sound, graphics, interface
 * and game options. DESIGN.md §5.
 */
export type Quality = 'low' | 'medium' | 'high';
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
  /** Minutes of real time between autosaves; 0 turns autosave off. */
  autosaveMinutes: number;
  /** Contextual tips for new players, and the ones already shown. */
  tips: boolean;
  seenTips: string[];
  /** Step of the running tutorial, or -1 when none is running. */
  tutorialStep: number;
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
  autosaveMinutes: 5,
  tips: true,
  seenTips: [],
  tutorialStep: -1,
};

export const QUALITIES: Quality[] = ['low', 'medium', 'high'];
export const DRAW_DISTANCES: DrawDistance[] = ['near', 'medium', 'far'];
export const AUTOSAVE_CHOICES = [0, 2, 5, 10];
export const UI_SCALE = { min: 0.8, max: 1.4 };

/** Renderer knobs for each quality level. */
export const QUALITY_PARAMS: Record<Quality, { pixelRatio: number; shadowMap: number; crowd: number }> = {
  low: { pixelRatio: 0.75, shadowMap: 1024, crowd: 0.4 },
  medium: { pixelRatio: 1, shadowMap: 1536, crowd: 0.7 },
  high: { pixelRatio: 2, shadowMap: 2048, crowd: 1 },
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
    autosaveMinutes: oneOf(r.autosaveMinutes, AUTOSAVE_CHOICES, d.autosaveMinutes),
    tips: bool(r.tips, d.tips),
    seenTips: Array.isArray(r.seenTips)
      ? r.seenTips.filter((t): t is string => typeof t === 'string').slice(0, 100)
      : [],
    tutorialStep: num(r.tutorialStep, d.tutorialStep, -1, 99),
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
