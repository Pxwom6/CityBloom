/**
 * The room protocol (phase 4, M30): what players and a room say to each other, the same over every
 * transport (a WebSocket to the local relay or to a Cloudflare Durable Object, or a WebRTC data
 * channel to a host's browser). JSON text, one message per frame.
 *
 * A room orders the players' commands: it stamps each with the tick it applies at and a sequence
 * number, and says how far every sim may run (`allow`). Time moves when the pacer (the host, or
 * whoever stands in for them) sends `clock`; the room never runs a timer of its own, so an online
 * room sleeps between messages. Snapshots of the city travel as opaque compressed parts.
 */
import type { Stamped } from '../src/sim/lockstep';

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 8;
/** Room codes: no look-alike characters (no I, L, O, 0 or 1). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** The biggest message a room accepts (snapshot parts are cut smaller than this). */
export const MAX_MESSAGE = 300_000;
/** Snapshot parts, in characters of base64. */
export const SNAPSHOT_PART = 200_000;
export const MAX_NAME = 20;
export const MAX_CHAT = 280;
/** Player colours (an index into this list travels). */
export const PLAYER_COLORS = [
  '#e4572e',
  '#2e86de',
  '#2bb673',
  '#f2a541',
  '#9b5de5',
  '#00b8a9',
  '#e75a9b',
  '#6c757d',
] as const;

export type Speed = 0 | 1 | 2 | 3;

export interface PlayerInfo {
  id: number;
  name: string;
  color: number;
  online: boolean;
  host: boolean;
  /** The last tick the player reported, and whether their game is in front (not a background tab). */
  tick: number;
  visible: boolean;
  /** Loading a snapshot and catching up (not waited for until they're in step). */
  joining: boolean;
}

export interface RoomInfo {
  code: string;
  /** Where the city lives: an online room, or a host's browser (peer-to-peer). */
  kind: 'online' | 'p2p' | 'local';
  locked: boolean;
  chat: boolean;
  speed: Speed;
  /** The player whose game sets the pace (0: nobody online). */
  pacer: number;
  cityName: string;
}

/** A snapshot's description; its data travels in parts (`snap`). */
export interface SnapshotMeta {
  /** Identifies one snapshot's parts. */
  id: string;
  tick: number;
  /** The last event applied before it (the receiver gets the events after it). */
  seq: number;
  eventHash: number;
  parts: number;
  cityName: string;
  population: number;
}

/** What a player asks for when making a room (the city comes after, as a snapshot). */
export interface CreateRoom {
  cityName: string;
}

// ---------------------------------------------------------------- player → room

export type ClientMsg =
  | {
      t: 'hello';
      v: number;
      name: string;
      color: number;
      /** Making the room (the first player, who then uploads the city). */
      create?: CreateRoom;
      /**
       * Coming back after a dropped connection: who, the proof, and the last event received (-2: this
       * page has no city yet, send a snapshot).
       */
      rejoin?: { id: number; secret: string; seq: number };
    }
  /** A command for the room to order; `ref` comes back with its result. */
  | { t: 'cmd'; ref: number; cmd: { type: string } & Record<string, unknown> }
  /** The pacer moves time on: sims may run to `allow`. */
  | { t: 'clock'; allow: number }
  /** How far this player's game has got, new hourly checksums, and whether it's in front. */
  | { t: 'status'; tick: number; visible: boolean; sums?: [number, string][] }
  /** A snapshot part (the city at a settle event, or the first upload). */
  | { t: 'snap'; meta: SnapshotMeta; part: number; data: string }
  | { t: 'speed'; speed: Speed }
  | { t: 'chat'; text: string }
  | { t: 'admin'; action: 'lock' | 'unlock' | 'chatOff' | 'chatOn' | 'kick'; player?: number }
  | { t: 'bye' };

// ---------------------------------------------------------------- room → player

export type RoomMsg =
  | {
      t: 'welcome';
      you: number;
      secret: string;
      room: RoomInfo;
      players: PlayerInfo[];
      /**
       * `upload`: you made the room, send the city; `snapshot`: a snapshot follows; `events`:
       * welcome back, the events you missed follow.
       */
      join: 'upload' | 'snapshot' | 'events';
    }
  | { t: 'ev'; list: Stamped[]; allow: number }
  | { t: 'players'; list: PlayerInfo[] }
  /** How far each player's game has got (sent as they report it, for the pacer and "Waiting for…"). */
  | { t: 'ticks'; ticks: [number, number][] }
  | { t: 'room'; room: RoomInfo }
  | { t: 'snap'; meta: SnapshotMeta; part: number; data: string; reason: 'join' | 'resync' }
  /** A player fell out of step and is being caught up (shown to everyone). */
  | { t: 'resync'; player: number; text: string }
  /** The room turned a command down before ordering it (roles, rate). */
  | { t: 'refused'; ref: number; reason: string }
  | { t: 'chat'; from: number; text: string }
  | { t: 'notice'; text: string }
  | { t: 'error'; code: ErrorCode; text: string };

export type ErrorCode =
  'version' | 'no-room' | 'full' | 'locked' | 'kicked' | 'bad-message' | 'rate' | 'exists' | 'gone';

// ---------------------------------------------------------------- checks

const DIGITS = CODE_ALPHABET.replace(/[A-Z]/g, '');
const LETTERS = CODE_ALPHABET.replace(/[0-9]/g, '');

/**
 * A fresh room code from a source of random numbers in [0, 1). Online rooms' codes start with a
 * digit and peer-to-peer rooms' with a letter, so a code says where to find its room.
 */
export function makeCode(random: () => number, kind: 'online' | 'p2p' = 'online'): string {
  const first = kind === 'online' ? DIGITS : LETTERS;
  let s = first[Math.floor(random() * first.length)]!;
  for (let i = 1; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return s;
}

/** Where a code's room lives. */
export function codeKind(code: string): 'online' | 'p2p' {
  return /^[0-9]/.test(code) ? 'online' : 'p2p';
}

/** A code as typed by a player: upper case, look-alikes mapped (O→0 isn't in it, so O→Q…), or null. */
export function normaliseCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  // 0 and 1 aren't in the alphabet: someone typed a look-alike; we can't guess which.
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** A display name with control characters, markup and extra spaces removed. */
export function cleanName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  return s.length ? s : null;
}

export function cleanChat(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_CHAT);
  return s.length ? s : null;
}

/**
 * Is this a plain, bounded JSON value (finite numbers, short strings, short arrays, shallow)? Commands
 * are checked this deep by the room; the sim checks what they mean.
 */
export function boundedJson(v: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= 200;
  if (Array.isArray(v)) return v.length <= 600 && v.every((x) => boundedJson(x, depth + 1));
  if (typeof v === 'object') {
    const keys = Object.keys(v as object);
    return (
      keys.length <= 24 &&
      keys.every((k) => k.length <= 40 && boundedJson((v as Record<string, unknown>)[k], depth + 1))
    );
  }
  return false;
}

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isSpeed = (v: unknown): v is Speed => v === 0 || v === 1 || v === 2 || v === 3;

/** Parse and check a player's message; null if it isn't one (the room then drops the player). */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_MESSAGE) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  switch (m.t) {
    case 'hello': {
      const name = cleanName(m.name);
      if (!isInt(m.v, 0, 1e6) || !name || !isInt(m.color, 0, PLAYER_COLORS.length - 1)) return null;
      const out: ClientMsg = { t: 'hello', v: m.v, name, color: m.color };
      if (m.create !== undefined) {
        const c = m.create as Record<string, unknown>;
        if (!c || typeof c !== 'object' || typeof c.cityName !== 'string') return null;
        out.create = { cityName: c.cityName.slice(0, 40) };
      }
      if (m.rejoin !== undefined) {
        const r = m.rejoin as Record<string, unknown>;
        if (
          !r ||
          !isInt(r.id, 1, 1e6) ||
          typeof r.secret !== 'string' ||
          r.secret.length > 64 ||
          !isInt(r.seq, -2, 1e12)
        )
          return null;
        out.rejoin = { id: r.id, secret: r.secret, seq: r.seq };
      }
      return out;
    }
    case 'cmd': {
      const cmd = m.cmd as Record<string, unknown>;
      if (!isInt(m.ref, 0, 1e12) || !cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string')
        return null;
      if (JSON.stringify(cmd).length > 32_000 || !boundedJson(cmd)) return null;
      return { t: 'cmd', ref: m.ref, cmd: cmd as { type: string } };
    }
    case 'clock':
      return isInt(m.allow, 0, 1e12) ? { t: 'clock', allow: m.allow } : null;
    case 'status': {
      if (!isInt(m.tick, 0, 1e12) || typeof m.visible !== 'boolean') return null;
      const out: ClientMsg = { t: 'status', tick: m.tick, visible: m.visible };
      if (m.sums !== undefined) {
        if (!Array.isArray(m.sums) || m.sums.length > 64) return null;
        for (const s of m.sums)
          if (!Array.isArray(s) || !isInt(s[0], 0, 1e12) || typeof s[1] !== 'string' || s[1].length > 40)
            return null;
        out.sums = m.sums as [number, string][];
      }
      return out;
    }
    case 'snap': {
      const meta = m.meta as Record<string, unknown>;
      if (!meta || typeof meta !== 'object') return null;
      if (typeof meta.id !== 'string' || meta.id.length > 40) return null;
      if (!isInt(meta.tick, 0, 1e12) || !isInt(meta.seq, -1, 1e12) || !isInt(meta.parts, 1, 400)) return null;
      if (typeof meta.eventHash !== 'number' || !Number.isFinite(meta.eventHash)) return null;
      if (typeof meta.cityName !== 'string' || !isInt(meta.population, 0, 1e9)) return null;
      if (!isInt(m.part, 0, meta.parts - 1) || typeof m.data !== 'string' || m.data.length > SNAPSHOT_PART)
        return null;
      return {
        t: 'snap',
        meta: {
          id: meta.id,
          tick: meta.tick,
          seq: meta.seq,
          eventHash: meta.eventHash,
          parts: meta.parts,
          cityName: meta.cityName.slice(0, 40),
          population: meta.population,
        },
        part: m.part,
        data: m.data,
      };
    }
    case 'speed':
      return isSpeed(m.speed) ? { t: 'speed', speed: m.speed } : null;
    case 'chat': {
      const text = cleanChat(m.text);
      return text ? { t: 'chat', text } : null;
    }
    case 'admin': {
      const actions = ['lock', 'unlock', 'chatOff', 'chatOn', 'kick'];
      if (typeof m.action !== 'string' || !actions.includes(m.action)) return null;
      if (m.player !== undefined && !isInt(m.player, 1, 1e6)) return null;
      return {
        t: 'admin',
        action: m.action as 'lock',
        ...(m.player !== undefined ? { player: m.player as number } : {}),
      };
    }
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}
