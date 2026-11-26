/**
 * Did the last page close without saying so (M49)? Phones close a tab that uses too much memory, and
 * the page gets no chance to report it. So while a city is on screen the page keeps a small marker
 * in localStorage, and takes it away whenever it is hidden or closed properly; a marker found when the
 * game next opens means the page was closed while a city was showing, which M41's reports then send
 * (the city's size and the graphics, nothing else).
 */
const KEY = 'citybloom.alive';
/** A marker older than this is too old to say anything (a laptop asleep for days, say). */
export const ALIVE_MAX_AGE_MS = 2 * 24 * 3600_000;

export interface Alive {
  /** When it was last written (ms since 1970). */
  at: number;
  build: string;
  population: number;
  quality: string;
}

/** Write the marker (a city is on screen). */
export function markAlive(a: Alive): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* no storage */
  }
}

/** Take the marker away (the page was hidden, closed properly, or left the city). */
export function clearAlive(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no storage */
  }
}

/** The last page's marker, if it closed while a city was on screen (taken away as it's read). */
export function takeAlive(now = Date.now()): Alive | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Partial<Alive>;
    if (typeof a.at !== 'number' || now - a.at > ALIVE_MAX_AGE_MS || now < a.at) return null;
    return {
      at: a.at,
      build: typeof a.build === 'string' ? a.build.slice(0, 40) : '',
      population: typeof a.population === 'number' ? Math.max(0, Math.round(a.population)) : 0,
      quality: typeof a.quality === 'string' ? a.quality.slice(0, 10) : '',
    };
  } catch {
    return null;
  }
}
