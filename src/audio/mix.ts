/** What the camera sees, summarised for the ambient bed. */
export interface AmbientScene {
  /** Camera distance to its target (m). */
  distance: number;
  /** Visible cars and trucks near the view centre. */
  cars: number;
  /** Buildings near the view centre, and how many of them are going up. */
  buildings: number;
  construction: number;
  /** Buildings on fire, and emergency vehicles on call, near the view centre. */
  fires: number;
  sirens: number;
  /** Mean tree density (0–1) near the view centre. */
  trees: number;
  /** 0 by day, 1 at night. */
  night: number;
  /** Nearest tornado (m, Infinity if none) and flood water in view (0–1). */
  tornado: number;
  flood: number;
  /** Simulation paused (traffic and building work stop). */
  paused: boolean;
  /** Weather (M22): rain falling (0–1, storms too), a storm's wind (0–1) and snow falling (0–1). */
  rain?: number;
  gale?: number;
  snow?: number;
}

/** Levels (0–1) for each ambient layer. */
export interface AmbientMix {
  traffic: number;
  wind: number;
  birds: number;
  crickets: number;
  construction: number;
  sirens: number;
  fire: number;
  storm: number;
  water: number;
  rain: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Radius (m) around the view centre that the ambient bed listens to. */
export function listenRadius(distance: number): number {
  return clamp(distance * 0.55, 90, 700);
}

/**
 * The ambient bed follows the view: close to a busy street you hear traffic and building work,
 * over woods you hear birds (crickets at night), and high above everything it's mostly wind.
 */
export function ambientMix(s: AmbientScene): AmbientMix {
  // 1 at street level, falling towards the overview.
  const close = clamp(1 - (s.distance - 80) / 1100, 0.08, 1);
  const urban = clamp(s.buildings / 40);
  const nature = clamp(s.trees * 1.6) * (1 - 0.7 * urban) * (0.4 + 0.6 * close);
  const running = s.paused ? 0 : 1;
  const night = clamp(s.night);
  const rain = clamp(s.rain ?? 0);
  const gale = clamp(s.gale ?? 0);
  const snow = clamp(s.snow ?? 0);
  return {
    // Snow muffles the streets; birds keep quiet in the rain; storms and snow bring wind.
    traffic: running * close * clamp(s.cars / 30) * (1 - 0.35 * night) * (1 - 0.35 * snow),
    wind: clamp(0.12 + 0.55 * (1 - close) + 0.2 * clamp(s.trees) + 0.55 * gale + 0.2 * snow),
    birds: nature * (1 - night) * (1 - 0.9 * rain) * (1 - 0.7 * snow),
    crickets: nature * night,
    construction: running * close * clamp(s.construction / 4) * (1 - 0.8 * night),
    sirens: running * clamp(s.sirens / 2) * (0.35 + 0.65 * close),
    fire: clamp(s.fires / 2) * close,
    // A tornado roars from well over a kilometre away; flood water rushes where it's in view.
    storm: clamp(1 - s.tornado / 1400),
    water: clamp(s.flood) * (0.4 + 0.6 * close),
    rain: rain * (0.45 + 0.55 * close),
  };
}
