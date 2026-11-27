/**
 * The weekly challenge on the page (M44): this week's challenge (the owner's pin, or the generator's),
 * the board (everyone's, a group's, last week's), posting a run, fetching one to watch, and telling the
 * board whether a run replayed. Also what this browser keeps: the player's id (never shown), their
 * groups, their best score each week, the runs it has checked.
 *
 * Without a relay (a build with none set up, or offline) the challenge still plays, from the generator
 * and the page's own clock; only the board is missing.
 */
import { challengeFor, cleanChallengeDef, type ChallengeDef } from '../data/challenges';
import { CODE_ALPHABET, normaliseCode } from '../../relay/protocol';
import { challengeWeek, weekStart } from '../../relay/week';
import { RUN_VERSION, type ChallengeRun, type ReplayResult, type RunEntry } from '../sim/runReplay';
import type { RunCheckJob, RunCheckReply } from './runCheckWorker';

export const CHALLENGE_PAGE = {
  /** How long a request may take before the page gives up on it. */
  timeoutMs: 8000,
  /** At most this many groups (the board's limit too). */
  groups: 5,
  /** Runs the page replays to check, each time the board is opened (one on a phone). */
  verifyMax: 2,
  verifyPhone: 1,
  /** Rows of the board to show. */
  rows: 50,
} as const;

/** Where this browser keeps the challenge's things. */
const KEYS = {
  player: 'citybloom.challenge.player',
  groups: 'citybloom.challenge.groups',
  best: 'citybloom.challenge.best',
  checked: 'citybloom.challenge.checked',
  play: 'citybloom.challenge',
} as const;

export interface BoardRow {
  id: number;
  rank: number;
  name: string;
  score: number;
  /** Pages have replayed it and found it right. */
  checked: boolean;
  /** Its run is kept (to watch). */
  run: boolean;
}

export interface BoardView {
  week: number;
  total: number;
  rows: BoardRow[];
}

export interface ChallengeNow {
  week: number;
  start: number;
  end: number;
  /** The board's clock less this page's (so time left is the board's). */
  offset: number;
  def: ChallengeDef;
  top: { name: string; score: number } | null;
  last: { name: string; score: number } | null;
  /** The board answered (false: offline or none set up, the generator's challenge). */
  online: boolean;
}

export type PostReply =
  { ok: true; id: number; rank: number; best: boolean } | { ok: false; why: string; status: number };

/** A run fetched from the board to watch (and check): the week's challenge as the board knows it. */
export interface FetchedRun {
  id: number;
  name: string;
  run: ChallengeRun;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a private window: it lasts this visit */
  }
}

/** This browser's player id for the board (never shown to anyone: it keeps one best per player). */
export function playerId(): string {
  const kept = read<string | null>(KEYS.player, null);
  if (typeof kept === 'string' && /^[a-z0-9]{16}$/.test(kept)) return kept;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  write(KEYS.player, id);
  return id;
}

/** The player's groups (friends boards), as codes. */
export function loadGroups(): string[] {
  const g = read<unknown>(KEYS.groups, []);
  return Array.isArray(g)
    ? g
        .map((c) => (typeof c === 'string' ? normaliseCode(c) : null))
        .filter((c): c is string => !!c)
        .slice(0, CHALLENGE_PAGE.groups)
    : [];
}

export function saveGroups(groups: string[]): void {
  write(KEYS.groups, groups.slice(0, CHALLENGE_PAGE.groups));
}

/** A new group's code: six of the room codes' letters and digits. */
export function newGroupCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** A code someone typed, or why it isn't one. */
export function groupCode(typed: string): { code: string } | { why: string } {
  const code = normaliseCode(typed.trim());
  return code ? { code } : { why: 'A group code is six letters and numbers' };
}

/** The player's best score on this device for a week. */
export function bestOnDevice(week: number): number | null {
  const b = read<Record<string, number>>(KEYS.best, {});
  const v = b[String(week)];
  return typeof v === 'number' ? v : null;
}

export function keepBest(week: number, score: number): boolean {
  const b = read<Record<string, number>>(KEYS.best, {});
  const prev = b[String(week)];
  if (typeof prev === 'number' && prev >= score) return false;
  // Only the last few weeks are worth keeping.
  const kept = Object.fromEntries(Object.entries(b).filter(([w]) => Number(w) >= week - 8)) as Record<
    string,
    number
  >;
  kept[String(week)] = score;
  write(KEYS.best, kept);
  return true;
}

/** Runs this browser has already checked (and told the board about). */
function checkedIds(): number[] {
  const c = read<unknown>(KEYS.checked, []);
  return Array.isArray(c) ? c.filter((n): n is number => typeof n === 'number') : [];
}

export function markChecked(id: number): void {
  write(KEYS.checked, [...checkedIds().filter((n) => n !== id), id].slice(-200));
}

export function wasChecked(id: number): boolean {
  return checkedIds().includes(id);
}

/** The challenge to play next, handed from the challenge screen to the city it founds. */
export function handChallenge(def: ChallengeDef): void {
  try {
    sessionStorage.setItem(KEYS.play, JSON.stringify(def));
  } catch {
    /* the boot falls back on the generator */
  }
}

/** The challenge handed over, checked as any challenge is; the generator's for the week if none. */
export function takeChallenge(week: number): ChallengeDef {
  try {
    // Only an owner's pin travels this way: the generator's challenge is made here from the week
    // (exactly as the board makes it, so the run replays there).
    const raw = JSON.parse(sessionStorage.getItem(KEYS.play) ?? 'null') as { pinned?: unknown } | null;
    const def = raw?.pinned === true ? cleanChallengeDef(raw, week) : null;
    if (def) return def;
  } catch {
    /* none */
  }
  return challengeFor(week);
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** A run's entries and end, packed for the board (gzip, then base64). */
export async function packRun(entries: RunEntry[], end: number): Promise<string> {
  const json = JSON.stringify({ v: RUN_VERSION, entries, end });
  return bytesToBase64(await pipe(new TextEncoder().encode(json), new CompressionStream('gzip')));
}

/** A packed run back to its entries and end (null if it isn't one). */
export async function unpackRun(
  packed: string,
): Promise<{ v: number; entries: RunEntry[]; end: number } | null> {
  try {
    const bin = atob(packed);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
    const r = JSON.parse(json) as { v?: unknown; entries?: unknown; end?: unknown };
    if (typeof r.v !== 'number' || !Array.isArray(r.entries) || typeof r.end !== 'number') return null;
    return { v: r.v, entries: r.entries as RunEntry[], end: r.end };
  } catch {
    return null;
  }
}

/** Time left in words: "3 days 4 hours", "5 hours 10 minutes", "12 minutes". */
export function timeLeftWords(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d > 0) return h > 0 ? `${unit(d, 'day')} ${unit(h, 'hour')}` : unit(d, 'day');
  if (h > 0) return min > 0 ? `${unit(h, 'hour')} ${unit(min, 'minute')}` : unit(h, 'hour');
  return m > 0 ? unit(min, 'minute') : 'less than a minute';
}

/** The board over HTTP (or nothing, without a relay). */
export class ChallengeClient {
  constructor(
    readonly base: string | null,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  get online(): boolean {
    return !!this.base;
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.base) throw new Error('The board isn’t set up');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), CHALLENGE_PAGE.timeoutMs);
    try {
      const r = await this.fetchFn(`${this.base}${path}`, { signal: ctl.signal });
      const json = (await r.json()) as T & { error?: string };
      if (!r.ok) throw new Error(json.error ?? `The board said ${r.status}`);
      return json;
    } finally {
      clearTimeout(t);
    }
  }

  private async send<T>(
    path: string,
    body: unknown,
  ): Promise<{ status: number; json: T & { error?: string } }> {
    if (!this.base) throw new Error('The board isn’t set up');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), CHALLENGE_PAGE.timeoutMs);
    try {
      // Text, not JSON: a simple request needs no preflight.
      const r = await this.fetchFn(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      return { status: r.status, json: (await r.json()) as T & { error?: string } };
    } finally {
      clearTimeout(t);
    }
  }

  /** This week's challenge, its time and its top score; the generator's on the page's clock if offline. */
  async current(now = Date.now()): Promise<ChallengeNow> {
    try {
      const c = await this.get<{
        week: number;
        start: number;
        end: number;
        now: number;
        pin: unknown;
        top: { name: string; score: number } | null;
        last: { name: string; score: number } | null;
      }>('/challenge/current');
      const pinned = c.pin ? cleanChallengeDef(c.pin, c.week) : null;
      return {
        week: c.week,
        start: c.start,
        end: c.end,
        offset: c.now - now,
        def: pinned ?? challengeFor(c.week),
        top: c.top,
        last: c.last,
        online: true,
      };
    } catch {
      const week = challengeWeek(now);
      return {
        week,
        start: weekStart(week),
        end: weekStart(week + 1),
        offset: 0,
        def: challengeFor(week),
        top: null,
        last: null,
        online: false,
      };
    }
  }

  /** A week's board (a group's, given its code). */
  board(week: number, group: string | null = null): Promise<BoardView> {
    const q = new URLSearchParams({ week: String(week), limit: String(CHALLENGE_PAGE.rows) });
    if (group) q.set('group', group);
    return this.get<BoardView>(`/challenge/board?${q}`);
  }

  /** Post a finished run with the name to show and the player's groups. */
  async post(
    week: number,
    run: { entries: RunEntry[]; end: number; hash: string; score: number },
    name: string,
    groups: string[],
  ): Promise<PostReply> {
    const packed = await packRun(run.entries, run.end);
    try {
      const { status, json } = await this.send<{ id: number; rank: number; best: boolean }>(
        '/challenge/score',
        {
          week,
          player: playerId(),
          name,
          score: run.score,
          hash: run.hash,
          end: run.end,
          entries: run.entries.length,
          groups,
          run: packed,
        },
      );
      if (status === 200 && json.id !== undefined)
        return { ok: true, id: json.id, rank: json.rank, best: json.best };
      return { ok: false, why: json.error ?? 'The board turned it away', status };
    } catch (e) {
      return { ok: false, why: e instanceof Error ? e.message : String(e), status: 0 };
    }
  }

  /** A kept run to watch: the week's challenge as the board knows it, the run's entries, its claims. */
  async fetchRun(id: number): Promise<FetchedRun> {
    const r = await this.get<{
      id: number;
      week: number;
      name: string;
      score: number;
      hash: string;
      run: string;
      def: unknown;
    }>(`/challenge/run?id=${id}`);
    const def = cleanChallengeDef(r.def, r.week);
    const packed = await unpackRun(r.run);
    if (!def) throw new Error('That run’s challenge can’t be read');
    if (!packed) throw new Error('That run can’t be read');
    return {
      id: r.id,
      name: r.name,
      run: {
        v: packed.v,
        week: r.week,
        def,
        entries: packed.entries,
        end: packed.end,
        hash: r.hash,
        score: r.score,
      },
    };
  }

  /** Tell the board whether a run replayed to what it claimed. */
  async verdict(id: number, ok: boolean): Promise<boolean> {
    try {
      const { status } = await this.send('/challenge/verdict', { id, ok });
      return status === 200;
    } catch {
      return false;
    }
  }
}

/** Replay a run in a worker of its own (closed after): whether it came to what it claims. */
export function checkRun(run: ChallengeRun): Promise<ReplayResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./runCheckWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<RunCheckReply>) => {
      w.terminate();
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data.result);
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message));
    };
    w.postMessage({ id: 1, run } satisfies RunCheckJob);
  });
}

/**
 * Check the top runs on a board this browser hasn't checked yet, one at a time, and tell the board
 * (a run that doesn't replay is dropped; one that does is marked checked). Returns what it found.
 */
export async function checkBoard(
  client: ChallengeClient,
  rows: BoardRow[],
  max: number,
  onChecked?: (id: number, ok: boolean) => void,
): Promise<{ id: number; ok: boolean }[]> {
  const found: { id: number; ok: boolean }[] = [];
  for (const row of rows) {
    if (found.length >= max) break;
    if (!row.run || row.checked || wasChecked(row.id)) continue;
    let fetched: FetchedRun;
    try {
      fetched = await client.fetchRun(row.id);
    } catch {
      continue;
    }
    let ok: boolean;
    try {
      ok = (await checkRun(fetched.run)).ok;
    } catch {
      continue;
    }
    markChecked(row.id);
    await client.verdict(row.id, ok);
    found.push({ id: row.id, ok });
    onChecked?.(row.id, ok);
  }
  return found;
}
