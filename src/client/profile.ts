/**
 * The player's name and colour for shared cities (M30): kept in this browser only, nothing else
 * personal. A first visit suggests a friendly name the player can change.
 */
import { cleanName, parseInvite, PLAYER_COLORS } from '../../relay/protocol';
import type { RegionBinding } from '../sim/save';

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

/**
 * A city's secret in a shared region (M32), by the region's code and the city's place in it: proof
 * that it's the same city when it comes back. Which city stands where is kept with the city itself,
 * in its save (`SaveMeta.region`, F6), so another city saved to the same slot never takes its place.
 */
export function regionSecret(code: string, slot: number): string | null {
  try {
    return localStorage.getItem(`citybloom.region.${code}.${slot}`);
  } catch {
    return null;
  }
}

export function keepRegionSecret(code: string, slot: number, secret: string): void {
  try {
    localStorage.setItem(`citybloom.region.${code}.${slot}`, secret);
  } catch {
    /* private window: the city joins as new next time */
  }
}

export function forgetRegionSecret(code: string, slot: number): void {
  try {
    localStorage.removeItem(`citybloom.region.${code}.${slot}`);
  } catch {
    /* nothing kept */
  }
}

/**
 * Whether a city opening should join a region, and as which city (F6). With an invite (a link, or
 * the code typed into the Region panel) it joins that region, as its old self only if its own save
 * says it stands there and this browser holds its secret; without one it rejoins the region its save
 * names, if this browser holds its secret, and otherwise joins nothing.
 */
export function regionRejoin(
  bound: RegionBinding | null | undefined,
  invite: string | null,
  secret: (code: string, slot: number) => string | null = regionSecret,
): { invite: string; rejoin: { slot: number; secret: string } | null } | null {
  const asked = invite ? parseInvite(invite) : null;
  const mine = bound ? parseInvite(bound.invite) : null;
  const same = !!mine && (!asked || asked.code === mine.code);
  const s = same && bound ? secret(mine!.code, bound.slot) : null;
  const rejoin = s && bound ? { slot: bound.slot, secret: s } : null;
  if (invite) return { invite, rejoin };
  return rejoin ? { invite: bound!.invite, rejoin } : null;
}
