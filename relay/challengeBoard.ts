/**
 * The weekly challenge's board (M44): scores for this week and last, kept in a Durable Object's SQLite
 * on the free plan (`ChallengeObject` in `relay/worker.ts`) or Node's SQLite in the local relay. Free of
 * Cloudflare's runtime, like `reportDesk.ts`, so tests run it as it runs online.
 *
 * What it checks on a score, cheaply (a Worker on the free plan has milliseconds, so it never opens the
 * run): the shape and size, the week (this one, or last week's within an hour of the change), the score
 * within what the week's challenge can give, the run's end within its months, one score per address
 * and per player every few minutes, a name cleaned and run through the owner's word filter. It keeps a
 * player's best each week. Honesty past that rests on replays: pages replay the runs they show and say
 * whether each comes to the hash and score it claims (`verdict`); one that doesn't is dropped (kept for
 * the owner, who can put it back).
 *
 * What it keeps, and for how long (DECISIONS "M44"): this week's and last week's entries (at most 500 a
 * week, the lowest go first), each top-100 entry's run (gzipped, at most 256 kB of base64), the owner's
 * pins and word list. Older weeks are deleted on the next write and by a daily alarm. At most 5,000 rows
 * written a UTC day. Nothing names a player beyond the display name they chose; addresses are hashed with
 * a salt that lives in memory only, and forgotten with it.
 */
import { LazyTables, KV, type Sql } from './sqlStore';
import { DailyRows, TokenBucket, type RowBudget } from './limits';
import { cleanName, normaliseCode, secureIndex } from './protocol';
import { safeEqual } from './reportDesk';
import { challengeWeek, weekStart } from './week';
import {
  challengeFor,
  challengeMaxScore,
  cleanChallengeDef,
  type ChallengeDef,
} from '../src/data/challenges';
import { RUN_MAX_ENTRIES, runMaxTick } from '../src/sim/runReplay';
import { fnv1a } from '../src/sim/hash';

export const BOARD_LIMITS = {
  /** Entries kept a week, and how many of the best keep their runs (to watch). */
  perWeek: 500,
  runsKept: 100,
  /** A run's packed size (characters of base64), and the whole request's. */
  runChars: 256_000,
  body: 300_000,
  /** One score per address, and per player, this often (ms). */
  scoreEvery: 3 * 60_000,
  /** Verdicts an address may give an hour (a burst, then one every few minutes). */
  verdicts: { rate: 1 / 120, burst: 20 },
  /** Board reads an address may make (a burst, then one a second). */
  reads: { rate: 1, burst: 30 },
  /** After the week changes, last week's runs may still be posted this long (ms). */
  grace: 60 * 60_000,
  /** Groups a score may name. */
  groups: 5,
  rowsPerDay: 5000,
  /** An entry checked by this many pages stays when one says otherwise: the owner looks. */
  trusted: 2,
  /** The owner key and wrong tries, as the report desk's. */
  ownerKeyMin: 20,
  ownerTries: { rate: 1 / 60, burst: 5 },
  ownerTriesAll: { rate: 1 / 6, burst: 30 },
  /** Words in the owner's filter, and each word's length. */
  words: 500,
  wordChars: 40,
};

export type EntryStatus = 'shown' | 'checked' | 'disputed' | 'dropped' | 'removed';

/** An entry as the board shows it. */
export interface BoardRow {
  id: number;
  rank: number;
  name: string;
  score: number;
  checked: boolean;
  /** It has a run kept to watch. */
  run: boolean;
}

/** An entry as the owner sees it. */
export interface OwnerRow extends BoardRow {
  week: number;
  status: EntryStatus;
  groups: string[];
  at: number;
  hash: string;
  checks: number;
}

export type PostResult =
  { ok: true; id: number; rank: number; best: boolean } | { ok: false; status: number; why: string };

interface Row {
  id: number;
  week: number;
  player: string;
  name: string;
  groups: string;
  score: number;
  hash: string;
  at: number;
  status: EntryStatus;
  checks: number;
  /** The packed run itself: read only to hand one out (`run`), never to list the board. */
  run?: string | null;
  /** Whether a run is kept (1 or 0), as listings read it. */
  kept?: number;
}

/**
 * An entry's columns without its run (a run is up to 256 kB of text: a listing that read them would
 * spend the Worker's few milliseconds of CPU on text it never shows).
 */
const META = 'id, week, player, name, groups, score, hash, at, status, checks, (run IS NOT NULL) AS kept';

const SHOWN: EntryStatus[] = ['shown', 'checked', 'disputed'];
const GROUP = /^[A-Z0-9]{6}$/;

export class ChallengeBoard extends LazyTables {
  private budget: DailyRows;
  private addresses = new Map<string, number>();
  private players = new Map<string, number>();
  private verdictBuckets = new Map<string, TokenBucket>();
  private voted = new Set<string>();
  private readBuckets = new Map<string, TokenBucket>();
  private ownerTries = new Map<string, TokenBucket>();
  private ownerTriesAll: TokenBucket;
  private readonly salt = `${secureIndex(0x7fff_ffff)}-${secureIndex(0x7fff_ffff)}`;

  constructor(
    sql: Sql,
    now: number,
    readonly limits = BOARD_LIMITS,
  ) {
    super(sql, {
      kv: KV,
      entries:
        '(id INTEGER PRIMARY KEY, week INTEGER NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL, ' +
        'groups TEXT NOT NULL, score INTEGER NOT NULL, hash TEXT NOT NULL, at INTEGER NOT NULL, ' +
        'status TEXT NOT NULL, checks INTEGER NOT NULL, run TEXT)',
      pins: '(week INTEGER PRIMARY KEY, def TEXT NOT NULL) WITHOUT ROWID',
    });
    const saved = this.get('budget');
    this.budget = new DailyRows(
      limits.rowsPerDay,
      () => this.rowsWritten,
      saved ? (JSON.parse(saved) as RowBudget) : undefined,
      now,
    );
    this.ownerTriesAll = new TokenBucket(limits.ownerTriesAll.rate, limits.ownerTriesAll.burst, now);
  }

  private key(s: string): string {
    return fnv1a(`${this.salt}|${s}`);
  }

  private bucket(map: Map<string, TokenBucket>, address: string, rate: number, burst: number, now: number) {
    const k = this.key(address);
    let b = map.get(k);
    if (!b) {
      if (map.size > 5000) map.clear();
      map.set(k, (b = new TokenBucket(rate, burst, now)));
    }
    return b;
  }

  /** May this address read the board now (a burst, then one a second)? */
  mayRead(address: string, now: number): boolean {
    return this.bucket(this.readBuckets, address, this.limits.reads.rate, this.limits.reads.burst, now).take(
      now,
    );
  }

  /** The week's challenge: the owner's pin, or the generator's. */
  challenge(week: number): ChallengeDef {
    const pin = this.read<{ def: string }>('SELECT def FROM pins WHERE week = ?', week)[0];
    if (pin) {
      const def = cleanChallengeDef(JSON.parse(pin.def), week);
      if (def) return def;
    }
    return challengeFor(week);
  }

  /** The owner's pinned challenge for a week, if any (as stored). */
  pin(week: number): ChallengeDef | null {
    const pin = this.read<{ def: string }>('SELECT def FROM pins WHERE week = ?', week)[0];
    return pin ? cleanChallengeDef(JSON.parse(pin.def), week) : null;
  }

  words(): string[] {
    const w = this.get('words');
    return w ? (JSON.parse(w) as string[]) : [];
  }

  /** A display name for the board: cleaned as names are, and not one the owner's filter catches. */
  boardName(raw: unknown): string | null {
    const n = cleanName(raw);
    if (!n) return null;
    const flat = n.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const w of this.words()) if (w && flat.includes(w)) return null;
    return n;
  }

  /** Delete weeks before last week (kept: this week's and last week's results). */
  sweep(now: number): boolean {
    const week = challengeWeek(now);
    const old =
      this.read<{ n: number }>('SELECT count(*) AS n FROM entries WHERE week < ?', week - 1)[0]?.n ?? 0;
    if (old) this.write('DELETE FROM entries WHERE week < ?', week - 1);
    const pins =
      this.read<{ n: number }>('SELECT count(*) AS n FROM pins WHERE week < ?', week - 1)[0]?.n ?? 0;
    if (pins) this.write('DELETE FROM pins WHERE week < ?', week - 1);
    return (this.read<{ n: number }>('SELECT count(*) AS n FROM entries')[0]?.n ?? 0) > 0;
  }

  /** When the next sweep is due: the next week's start (as old weeks fall out). */
  nextSweep(now: number): number {
    return weekStart(challengeWeek(now) + 1) + 60_000;
  }

  /**
   * Take a score as it arrived (any JSON). The run travels packed and is never opened here: the board
   * checks what it can cheaply and keeps the player's best.
   */
  post(raw: unknown, address: string, now: number): PostResult {
    const bad = (why: string, status = 400): PostResult => ({ ok: false, status, why });
    if (!raw || typeof raw !== 'object') return bad('Not a score');
    const r = raw as Record<string, unknown>;
    const nowWeek = challengeWeek(now);
    const week = r.week;
    const lateOk = week === nowWeek - 1 && now - weekStart(nowWeek) < this.limits.grace;
    if (week !== nowWeek && !lateOk) return bad('That week’s challenge is over');
    const def = this.challenge(week as number);
    if (typeof r.player !== 'string' || !/^[a-z0-9]{8,32}$/.test(r.player)) return bad('Not a score');
    const name = this.boardName(r.name);
    if (!name) return bad('That name can’t go on the board: choose another');
    const score = r.score;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > challengeMaxScore(def))
      return bad('That score isn’t one this challenge can give');
    if (typeof r.hash !== 'string' || !/^[0-9a-f]{8}$/.test(r.hash)) return bad('Not a score');
    if (typeof r.end !== 'number' || !Number.isInteger(r.end) || r.end < 0 || r.end > runMaxTick(def))
      return bad('That run is longer than the challenge');
    if (
      typeof r.entries !== 'number' ||
      !Number.isInteger(r.entries) ||
      r.entries < 0 ||
      r.entries > RUN_MAX_ENTRIES
    )
      return bad('That run is too big');
    if (typeof r.run !== 'string' || r.run.length > this.limits.runChars || !/^[A-Za-z0-9+/=]+$/.test(r.run))
      return bad('That run is too big', 413);
    const groups: string[] = [];
    if (r.groups !== undefined) {
      if (!Array.isArray(r.groups) || r.groups.length > this.limits.groups) return bad('Too many groups');
      for (const g of r.groups) {
        const code = typeof g === 'string' ? normaliseCode(g) : null;
        if (!code || !GROUP.test(code)) return bad('That isn’t a group code');
        if (!groups.includes(code)) groups.push(code);
      }
    }
    // One score every few minutes, from each address and each player (in memory only).
    const a = this.key(address);
    const p = this.key(r.player);
    if (now - (this.addresses.get(a) ?? -Infinity) < this.limits.scoreEvery)
      return bad('One score every few minutes: try again soon', 429);
    if (now - (this.players.get(p) ?? -Infinity) < this.limits.scoreEvery)
      return bad('One score every few minutes: try again soon', 429);
    if (this.budget.over(now)) return bad('The board is full for today: try again tomorrow', 503);
    if (this.addresses.size > 5000) this.addresses.clear();
    if (this.players.size > 5000) this.players.clear();
    this.addresses.set(a, now);
    this.players.set(p, now);
    this.sweep(now);
    // The player's best counts: a lower score than their own leaves the board as it was.
    const mine = this.read<Row>(
      `SELECT ${META} FROM entries WHERE week = ? AND player = ?`,
      week,
      r.player,
    )[0];
    if (mine && mine.score >= score && mine.status !== 'dropped' && mine.status !== 'removed')
      return { ok: true, id: mine.id, rank: this.rankOf(mine), best: false };
    const count =
      this.read<{ n: number }>('SELECT count(*) AS n FROM entries WHERE week = ?', week)[0]?.n ?? 0;
    if (!mine && count >= this.limits.perWeek) {
      const lowest = this.read<{ id: number; score: number }>(
        'SELECT id, score FROM entries WHERE week = ? ORDER BY score ASC, at DESC LIMIT 1',
        week,
      )[0];
      if (lowest && lowest.score >= score) return bad('Not in this week’s top 500', 200);
      if (lowest) this.write('DELETE FROM entries WHERE id = ?', lowest.id);
    }
    if (mine)
      this.write(
        'UPDATE entries SET name = ?, groups = ?, score = ?, hash = ?, at = ?, status = ?, checks = 0, run = ? WHERE id = ?',
        name,
        JSON.stringify(groups),
        score,
        r.hash,
        now,
        'shown',
        r.run,
        mine.id,
      );
    else
      this.write(
        'INSERT INTO entries (week, player, name, groups, score, hash, at, status, checks, run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
        week,
        r.player,
        name,
        JSON.stringify(groups),
        score,
        r.hash,
        now,
        'shown',
        r.run,
      );
    const row = this.read<Row>(
      `SELECT ${META} FROM entries WHERE week = ? AND player = ?`,
      week,
      r.player,
    )[0]!;
    this.indexed();
    this.trimRuns(week as number);
    this.put('budget', JSON.stringify(this.budget.record(now)));
    return { ok: true, id: row.id, rank: this.rankOf(row), best: true };
  }

  private hasIndex = false;
  /** A week's entries by score, indexed (a board view reads its week's rows, not every row kept). */
  private indexed(): void {
    if (this.hasIndex) return;
    this.sql.exec('CREATE INDEX IF NOT EXISTS entries_week ON entries (week, score)');
    this.hasIndex = true;
  }

  /** Only the best entries keep their runs (to watch); the rest let theirs go. */
  private trimRuns(week: number): void {
    const cut = this.read<{ id: number }>(
      `SELECT id FROM entries WHERE week = ? AND run IS NOT NULL AND status IN ('shown','checked','disputed') ORDER BY score DESC, at ASC LIMIT -1 OFFSET ?`,
      week,
      this.limits.runsKept,
    );
    for (const c of cut) this.write('UPDATE entries SET run = NULL WHERE id = ?', c.id);
  }

  private rankOf(row: Pick<Row, 'week' | 'score' | 'at'>): number {
    return (
      (this.read<{ n: number }>(
        `SELECT count(*) AS n FROM entries WHERE week = ? AND status IN ('shown','checked','disputed') AND (score > ? OR (score = ? AND at < ?))`,
        row.week,
        row.score,
        row.score,
        row.at,
      )[0]?.n ?? 0) + 1
    );
  }

  /** The board for a week (its best first), all of it or a group's. */
  board(week: number, group: string | null, limit = 50): { rows: BoardRow[]; total: number } {
    const rows = this.read<Row>(
      `SELECT ${META} FROM entries WHERE week = ? AND status IN ('shown','checked','disputed') ORDER BY score DESC, at ASC`,
      week,
    );
    const filtered = group ? rows.filter((r) => (JSON.parse(r.groups) as string[]).includes(group)) : rows;
    return {
      total: filtered.length,
      rows: filtered.slice(0, Math.max(1, Math.min(100, limit))).map((r, k) => ({
        id: r.id,
        rank: k + 1,
        name: r.name,
        score: r.score,
        checked: r.status === 'checked',
        run: !!r.kept,
      })),
    };
  }

  /** The week's top score (for the main menu). */
  top(week: number): { name: string; score: number } | null {
    const r = this.read<Row>(
      `SELECT name, score FROM entries WHERE week = ? AND status IN ('shown','checked','disputed') ORDER BY score DESC, at ASC LIMIT 1`,
      week,
    )[0];
    return r ? { name: r.name, score: r.score } : null;
  }

  /**
   * A shown entry's run to watch, with what it claims and the week's challenge as the board knows it
   * (a replay plays that, never a challenge the run might bring along).
   */
  run(id: number): {
    id: number;
    week: number;
    name: string;
    score: number;
    hash: string;
    run: string;
    def: ChallengeDef;
  } | null {
    const r = this.read<Row>('SELECT * FROM entries WHERE id = ?', id)[0];
    if (!r || !r.run || !SHOWN.includes(r.status)) return null;
    return {
      id: r.id,
      week: r.week,
      name: r.name,
      score: r.score,
      hash: r.hash,
      run: r.run,
      def: this.challenge(r.week),
    };
  }

  /**
   * A page replayed an entry's run: `ok` if it came to the hash and score claimed. A run that doesn't is
   * dropped, unless enough pages have already found it right (then it's disputed, for the owner).
   */
  verdict(raw: unknown, address: string, now: number): { ok: boolean; status?: EntryStatus; why?: string } {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r.id !== 'number' || !Number.isInteger(r.id) || typeof r.ok !== 'boolean')
      return { ok: false, why: 'Not a verdict' };
    const b = this.bucket(
      this.verdictBuckets,
      address,
      this.limits.verdicts.rate,
      this.limits.verdicts.burst,
      now,
    );
    if (!b.take(now)) return { ok: false, why: 'Too many verdicts: wait a while' };
    const row = this.read<Row>(`SELECT ${META} FROM entries WHERE id = ?`, r.id)[0];
    if (!row || !SHOWN.includes(row.status)) return { ok: false, why: 'No such entry' };
    // One verdict from an address on an entry counts (in memory: one address can't make a run "checked"
    // twice over, which would shield a forged run from the next page's "no").
    const vote = `${this.key(address)}:${row.id}`;
    if (this.voted.has(vote)) return { ok: true, status: row.status };
    if (this.voted.size > 20_000) this.voted.clear();
    this.voted.add(vote);
    if (this.budget.over(now)) return { ok: false, why: 'The board is full for today' };
    let status: EntryStatus = row.status;
    if (r.ok) {
      this.write(
        'UPDATE entries SET checks = checks + 1, status = ? WHERE id = ?',
        row.status === 'disputed' ? 'disputed' : 'checked',
        row.id,
      );
      status = row.status === 'disputed' ? 'disputed' : 'checked';
    } else {
      status = row.checks >= this.limits.trusted ? 'disputed' : 'dropped';
      this.write('UPDATE entries SET status = ? WHERE id = ?', status, row.id);
    }
    this.put('budget', JSON.stringify(this.budget.record(now)));
    return { ok: true, status };
  }

  // ---- The owner -----------------------------------------------------------------------------

  owner(
    given: string | null,
    ownerKey: string | undefined,
    address: string,
    now: number,
  ): 'ok' | 'unset' | 'wrong' | 'busy' {
    const key = ownerKey?.trim() ?? '';
    if (key.length < this.limits.ownerKeyMin) return 'unset';
    const b = this.bucket(
      this.ownerTries,
      address,
      this.limits.ownerTries.rate,
      this.limits.ownerTries.burst,
      now,
    );
    // The right key always opens it (M48 review: wrong keys from anywhere mustn't lock the owner out);
    // only wrong ones are slowed, per address and for everyone.
    if (given !== null && safeEqual(given, key)) return 'ok';
    if (!b.has(now) || !this.ownerTriesAll.has(now)) return 'busy';
    b.take(now);
    this.ownerTriesAll.take(now);
    return 'wrong';
  }

  /** Every entry of a week, whatever its status, for the owner. */
  ownerRows(week: number): OwnerRow[] {
    const rows = this.read<Row>(
      `SELECT ${META} FROM entries WHERE week = ? ORDER BY score DESC, at ASC`,
      week,
    );
    return rows.map((r, k) => ({
      id: r.id,
      rank: k + 1,
      name: r.name,
      score: r.score,
      checked: r.status === 'checked',
      run: !!r.kept,
      week: r.week,
      status: r.status,
      groups: JSON.parse(r.groups) as string[],
      at: r.at,
      hash: r.hash,
      checks: r.checks,
    }));
  }

  /** The owner removes an entry, or puts one back. */
  setStatus(id: number, action: 'remove' | 'restore'): boolean {
    const row = this.read<Row>('SELECT id FROM entries WHERE id = ?', id)[0];
    if (!row) return false;
    this.write('UPDATE entries SET status = ? WHERE id = ?', action === 'remove' ? 'removed' : 'shown', id);
    return true;
  }

  /** The owner pins a hand-made challenge for a week (or takes the pin away: null). */
  setPin(week: number, raw: unknown): { ok: boolean; why?: string } {
    if (!Number.isInteger(week) || week < 0 || week > 100_000) return { ok: false, why: 'Not a week' };
    if (raw === null) {
      this.write('DELETE FROM pins WHERE week = ?', week);
      return { ok: true };
    }
    const def = cleanChallengeDef(raw, week);
    if (!def) return { ok: false, why: 'That isn’t a challenge the game can play' };
    this.write(
      'INSERT INTO pins (week, def) VALUES (?, ?) ON CONFLICT (week) DO UPDATE SET def = excluded.def',
      week,
      JSON.stringify(def),
    );
    return { ok: true };
  }

  /** The owner's word filter for board names (lower case, letters and digits). */
  setWords(raw: unknown): { ok: boolean; words: string[] } {
    if (!Array.isArray(raw)) return { ok: false, words: this.words() };
    const words = [
      ...new Set(
        raw
          .filter((w): w is string => typeof w === 'string')
          .map((w) =>
            w
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')
              .slice(0, this.limits.wordChars),
          )
          .filter(Boolean),
      ),
    ].slice(0, this.limits.words);
    this.put('words', JSON.stringify(words));
    return { ok: true, words };
  }

  /** What the board holds (the owner's status line). */
  usage(now: number): {
    entries: number;
    runs: number;
    runChars: number;
    rowsToday: number;
    rowsPerDay: number;
  } {
    const e = this.read<{ n: number; r: number; c: number | null }>(
      'SELECT count(*) AS n, count(run) AS r, sum(length(run)) AS c FROM entries',
    )[0];
    return {
      entries: e?.n ?? 0,
      runs: e?.r ?? 0,
      runChars: e?.c ?? 0,
      rowsToday: this.budget.used(now),
      rowsPerDay: this.limits.rowsPerDay,
    };
  }
}
