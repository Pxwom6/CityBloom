/**
 * The player's name and colour for shared cities (M30): kept in this browser only, nothing else
 * personal. A first visit suggests a friendly name the player can change.
 */
import { cleanName, PLAYER_COLORS } from '../../relay/protocol';

const KEY = 'citybloom.player';
const SUGGEST = [
  'Ada',
  'Bo',
  'Cass',
  'Dev',
  'Eli',
  'Fen',
  'Gus',
  'Hana',
  'Ivo',
  'Juno',
  'Kit',
  'Lou',
  'Mo',
  'Nia',
  'Oz',
  'Pip',
];

export interface Profile {
  name: string;
  color: number;
}

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Profile> | null;
    const name = cleanName(p?.name);
    const color =
      typeof p?.color === 'number' && p.color >= 0 && p.color < PLAYER_COLORS.length ? p.color : null;
    if (name && color !== null) return { name, color };
  } catch {
    /* a fresh profile below */
  }
  return {
    name: SUGGEST[Math.floor(Math.random() * SUGGEST.length)]!,
    color: Math.floor(Math.random() * PLAYER_COLORS.length),
  };
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private window: the name lasts this visit */
  }
}

/** Who this browser is in a room, so a reload of the page can rejoin as the same player. */
export function roomCredentials(code: string): { id: number; secret: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(`citybloom.room.${code}`) ?? 'null') as {
      id: number;
      secret: string;
    } | null;
  } catch {
    return null;
  }
}

export function keepRoomCredentials(code: string, id: number, secret: string): void {
  try {
    sessionStorage.setItem(`citybloom.room.${code}`, JSON.stringify({ id, secret }));
  } catch {
    /* no session storage: a reload joins as a new player */
  }
}

/** A city's place in a shared region (M32), kept so the city rejoins it when opened again. */
export function regionCredentials(code: string): { slot: number; secret: string } | null {
  try {
    return JSON.parse(localStorage.getItem(`citybloom.region.${code}`) ?? 'null') as {
      slot: number;
      secret: string;
    } | null;
  } catch {
    return null;
  }
}

export function keepRegionCredentials(
  code: string,
  slot: number,
  secret: string,
  saveSlot: string | null,
  /** The region's whole invite (a peer-to-peer region's carries its key, F2). */
  invite = code,
): void {
  try {
    localStorage.setItem(`citybloom.region.${code}`, JSON.stringify({ slot, secret }));
    if (saveSlot) localStorage.setItem(`citybloom.regionOf.${saveSlot}`, invite);
  } catch {
    /* private window: the city joins as new next time */
  }
}

/** The region a saved city stands in, if any: its invite. */
export function regionOf(saveSlot: string): string | null {
  try {
    return localStorage.getItem(`citybloom.regionOf.${saveSlot}`);
  } catch {
    return null;
  }
}

export function forgetRegionOf(saveSlot: string): void {
  try {
    localStorage.removeItem(`citybloom.regionOf.${saveSlot}`);
  } catch {
    /* nothing kept */
  }
}
