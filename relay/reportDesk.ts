/**
 * The report desk (phase 6, M41): where problem reports are kept for the owner, in a Durable Object's
 * SQLite on the free plan (`ReportsObject` in `relay/worker.ts`) or Node's SQLite in the local relay.
 * Free of Cloudflare's runtime, like `relay/objects.ts`, so tests run it as it runs online.
 *
 * What it keeps, and for how long (DECISIONS "M41"):
 * - `groups`: one row per kind of problem (`reportKey`): its message and stack, first and last seen,
 *   a count, the builds and browsers it came from (30 of each at most), and whether it's fixed. At most
 *   1,000 rows of a few KB each.
 * - `items`: a written report's message and picture, and a desync's replay; at most 300, 30 MB in all,
 *   20 per kind of desync.
 * - Everything is deleted 60 days after it was last seen (an alarm a day online, a timer locally).
 * - At most 6,000 rows written a UTC day (about 2,000 reports), well inside the account's 100,000.
 *
 * Nothing names a player: reports are cleaned on the way in (`cleanReport`), and the addresses rate
 * limits are counted by are hashed with a salt that lives in memory only, and forgotten with it.
 */
import { LazyTables, KV, type Sql } from './sqlStore';
import { DailyRows, DAY_MS, TokenBucket, type RowBudget } from './limits';
import { cleanReport, reportKey, REPORT_CAPS, type Report, type ReportEnv, type ReportKind } from './reports';
import { secureIndex } from './protocol';
import { fnv1a } from '../src/sim/hash';

export const REPORT_LIMITS = {
  maxGroups: 1000,
  maxItems: 300,
  itemBytes: 30_000_000,
  itemsPerDesync: 20,
  rowsPerDay: 6000,
  keepDays: 60,
  /** Each address: 6 reports a minute (a page sends 3 at most), and 60 a UTC day. */
  perAddress: { rate: 6 / 60, burst: 6 },
  perAddressDay: 60,
  /** Everyone together: 2 a second, 120 at once. */
  everyone: { rate: 2, burst: 120 },
  /** Wrong owner keys from one address: 10 a minute; from everyone together, 100 an hour. */
  ownerTries: { rate: 10 / 60, burst: 10 },
  ownerTriesAll: { rate: 100 / 3600, burst: 100 },
  /** An owner key shorter than this isn't taken (the owner area says it isn't set up). */
  ownerKeyMin: 20,
  builds: 30,
  browsers: 30,
};

export type GroupStatus = 'open' | 'fixed';

/** A group as the owner area shows it. */
export interface GroupView {
  key: string;
  kind: ReportKind;
  message: string;
  stack: string;
  first: number;
  last: number;
  count: number;
  status: GroupStatus;
  fixedAt: number | null;
  /** Set when it came back on a build the fix didn't cover. */
  reopened: boolean;
  builds: { build: string; count: number }[];
  browsers: { browser: string; count: number }[];
  /** The latest report's game and machine. */
  env: ReportEnv;
  /** Written reports and desync replays kept for it, newest first. */
  items: ItemView[];
  /** Items not kept because the store was full. */
  dropped: number;
}

export interface ItemView {
  id: number;
  at: number;
  note: string | null;
  /** A desync's line: which side, where, and whether it replays from nothing more. */
  summary: string | null;
  shot: boolean;
  replay: boolean;
  bytes: number;
}

/** A kept item in full: the report as it came. */
export interface ItemFull extends ItemView {
  key: string;
  report: Report;
}

interface GroupRow {
  key: string;
  kind: string;
  message: string;
  stack: string;
  first: number;
  last: number;
  count: number;
  status: string;
  fixed_at: number | null;
  fixed_builds: string;
  fixed_built: number | null;
  reopened: number;
  builds: string;
  browsers: string;
  env: string;
  dropped: number;
}

interface ItemRow {
  id: number;
  key: string;
  at: number;
  note: string | null;
  summary: string | null;
  shot: number;
  replay: number;
  bytes: number;
  data?: string;
}

export type AddResult =
  | { ok: true; key: string; reopened: boolean; kept: boolean }
  | { ok: false; status: 400 | 413 | 429 | 503; why: string };

/** A tally as kept: `[key, count, last seen, built?]`, the most recently seen first. */
type Tally = [string, number, number, number?][];

/** Add to a tally, keeping the `max` most recently seen entries (a new build is never cut). */
function tally(json: string, key: string, n: number, max: number, now: number, built?: number): string {
  const t = JSON.parse(json || '[]') as Tally;
  const old = t.find((e) => e[0] === key);
  const rest = t.filter((e) => e[0] !== key);
  const entry: Tally[number] = [key, (old?.[1] ?? 0) + n, now];
  const b = built ?? old?.[3];
  if (b !== undefined) entry.push(b);
  return JSON.stringify([entry, ...rest].slice(0, max));
}

/** A tally's entries, most counted first. */
const list = (json: string): [string, number][] =>
  (JSON.parse(json || '[]') as Tally)
    .map((e) => [e[0], e[1]] as [string, number])
    .sort((a, b) => b[1] - a[1]);

export class ReportDesk extends LazyTables {
  private budget: DailyRows;
  private groupCount: number | null = null;
  private itemCount: number | null = null;
  private itemBytes: number | null = null;
  private addresses = new Map<string, TokenBucket>();
  private daily = new Map<string, { day: number; n: number }>();
  private ownerTries = new Map<string, TokenBucket>();
  private ownerTriesAll: TokenBucket;
  private everyone: TokenBucket;
  /** Addresses are hashed with this before they're used as keys; it never leaves memory. */
  private readonly salt = `${secureIndex(0x7fff_ffff)}-${secureIndex(0x7fff_ffff)}`;

  constructor(
    sql: Sql,
    now: number,
    readonly limits = REPORT_LIMITS,
  ) {
    super(sql, {
      kv: KV,
      groups:
        '(key TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, stack TEXT NOT NULL, ' +
        'first INTEGER NOT NULL, last INTEGER NOT NULL, count INTEGER NOT NULL, status TEXT NOT NULL, ' +
        'fixed_at INTEGER, fixed_builds TEXT NOT NULL, fixed_built INTEGER, reopened INTEGER NOT NULL, builds TEXT NOT NULL, ' +
        'browsers TEXT NOT NULL, env TEXT NOT NULL, dropped INTEGER NOT NULL) WITHOUT ROWID',
      items:
        '(id INTEGER PRIMARY KEY, key TEXT NOT NULL, at INTEGER NOT NULL, note TEXT, summary TEXT, shot INTEGER NOT NULL, ' +
        'replay INTEGER NOT NULL, bytes INTEGER NOT NULL, data TEXT NOT NULL)',
    });
    const saved = this.get('budget');
    this.budget = new DailyRows(
      limits.rowsPerDay,
      () => this.rowsWritten,
      saved ? (JSON.parse(saved) as RowBudget) : undefined,
      now,
    );
    this.everyone = new TokenBucket(limits.everyone.rate, limits.everyone.burst, now);
    this.ownerTriesAll = new TokenBucket(limits.ownerTriesAll.rate, limits.ownerTriesAll.burst, now);
  }

  /** An address's reports today, within its day's allowance (counted in memory only). */
  private dayAllows(address: string, now: number): boolean {
    const k = fnv1a(`${this.salt}|${address}`);
    const day = Math.floor(now / DAY_MS);
    let d = this.daily.get(k);
    if (!d || d.day !== day) {
      if (this.daily.size > 5000) this.daily.clear();
      this.daily.set(k, (d = { day, n: 0 }));
    }
    if (d.n >= this.limits.perAddressDay) return false;
    d.n++;
    return true;
  }

  private bucket(map: Map<string, TokenBucket>, address: string, rate: number, burst: number, now: number) {
    const k = fnv1a(`${this.salt}|${address}`);
    let b = map.get(k);
    if (!b) {
      // Forgotten in the moment: a full map starts again rather than growing.
      if (map.size > 5000) map.clear();
      map.set(k, (b = new TokenBucket(rate, burst, now)));
    }
    return b;
  }

  private counts(): { groups: number; items: number; bytes: number } {
    if (this.groupCount === null)
      this.groupCount = this.read<{ n: number }>('SELECT count(*) AS n FROM groups')[0]?.n ?? 0;
    if (this.itemCount === null || this.itemBytes === null) {
      const r = this.read<{ n: number; b: number | null }>(
        'SELECT count(*) AS n, sum(bytes) AS b FROM items',
      )[0];
      this.itemCount = r?.n ?? 0;
      this.itemBytes = r?.b ?? 0;
    }
    return { groups: this.groupCount, items: this.itemCount, bytes: this.itemBytes };
  }

  /** Rows written today (for tests and the owner's status). */
  rowsToday(now: number): number {
    return this.budget.used(now);
  }

  /**
   * Take a report as it arrived (any JSON): cleaned, rate limited per address and in all, folded into
   * its group, its written message, picture or replay kept when there's room.
   */
  add(raw: unknown, address: string, now: number): AddResult {
    if (
      !this.bucket(
        this.addresses,
        address,
        this.limits.perAddress.rate,
        this.limits.perAddress.burst,
        now,
      ).take(now)
    )
      return { ok: false, status: 429, why: 'Too many reports from here: try again in a minute' };
    if (!this.dayAllows(address, now))
      return { ok: false, status: 429, why: 'Too many reports from here today: try again tomorrow' };
    if (!this.everyone.take(now)) return { ok: false, status: 429, why: 'Too many reports at once' };
    if (this.budget.over(now)) return { ok: false, status: 503, why: 'The report desk is full for today' };
    const c = cleanReport(raw);
    if (!c.ok) return { ok: false, status: 400, why: c.why };
    const r = c.report;
    const size = JSON.stringify(r).length;
    if (size > REPORT_CAPS.body) return { ok: false, status: 413, why: 'That report is too big' };
    const key = reportKey(r);
    const n = r.count ?? 1;
    const old = this.read<GroupRow>('SELECT * FROM groups WHERE key = ?', key)[0];
    // Full: the entry seen longest ago makes room (a desk that filled up would turn every new
    // problem away for 60 days).
    if (!old && this.counts().groups >= this.limits.maxGroups) {
      const oldest = this.read<{ key: string }>('SELECT key FROM groups ORDER BY last ASC LIMIT 1')[0];
      if (oldest) this.deleteGroup(oldest.key);
    }
    const counts = this.counts();
    const browser = `${r.env.browser} · ${r.env.os}`;
    // An entry marked fixed reopens when it comes back from a build the fix didn't cover.
    let reopened = false;
    let status: GroupStatus = (old?.status as GroupStatus) ?? 'open';
    if (old && status === 'fixed') {
      // Newer: built after every build it had come from when it was fixed (from the build's commit
      // time); a page too old to say when it was built counts as newer only if it's a build not seen.
      const newer =
        r.env.built !== undefined && old.fixed_built !== null
          ? r.env.built > old.fixed_built
          : !(JSON.parse(old.fixed_builds) as string[]).includes(r.env.build);
      if (newer) {
        status = 'open';
        reopened = true;
      }
    }
    const wantsItem = r.kind === 'user' || r.kind === 'desync';
    let kept = false;
    if (wantsItem) {
      const data = JSON.stringify(r);
      // Full: the oldest kept items make room, so the newest reports are always there to read.
      let room = this.counts();
      while (
        room.items > 0 &&
        (room.items >= this.limits.maxItems || room.bytes + data.length > this.limits.itemBytes)
      ) {
        const o = this.read<{ id: number; bytes: number }>(
          'SELECT id, bytes FROM items ORDER BY id ASC LIMIT 1',
        )[0];
        if (!o) break;
        this.dropItem(o.id, o.bytes);
        room = this.counts();
      }
      if (room.items < this.limits.maxItems && room.bytes + data.length <= this.limits.itemBytes) {
        this.write(
          'INSERT INTO items (key, at, note, summary, shot, replay, bytes, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          key,
          now,
          r.note ?? null,
          desyncSummary(r),
          r.shot ? 1 : 0,
          r.desync?.events || r.desync?.start ? 1 : 0,
          data.length,
          data,
        );
        this.itemCount = room.items + 1;
        this.itemBytes = room.bytes + data.length;
        kept = true;
        if (r.kind === 'desync') this.trimItems(key, this.limits.itemsPerDesync);
      }
    }
    if (old) {
      this.write(
        'UPDATE groups SET last = ?, count = count + ?, status = ?, reopened = ?, builds = ?, browsers = ?, ' +
          'env = ?, dropped = dropped + ?, message = ?, stack = ? WHERE key = ?',
        now,
        n,
        status,
        reopened ? 1 : old.reopened,
        tally(old.builds, r.env.build, n, this.limits.builds, now, r.env.built),
        tally(old.browsers, browser, n, this.limits.browsers, now),
        JSON.stringify(r.env),
        wantsItem && !kept ? 1 : 0,
        r.message || old.message,
        r.stack || old.stack,
        key,
      );
    } else {
      this.write(
        'INSERT INTO groups (key, kind, message, stack, first, last, count, status, fixed_at, fixed_builds, ' +
          "fixed_built, reopened, builds, browsers, env, dropped) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, '[]', NULL, 0, ?, ?, ?, ?)",
        key,
        r.kind,
        r.message,
        r.stack,
        now,
        now,
        n,
        tally('[]', r.env.build, n, this.limits.builds, now, r.env.built),
        tally('[]', browser, n, this.limits.browsers, now),
        JSON.stringify(r.env),
        wantsItem && !kept ? 1 : 0,
      );
      this.groupCount = counts.groups + 1;
    }
    this.put('budget', JSON.stringify(this.budget.record(now)));
    return { ok: true, key, reopened, kept };
  }

  /** Keep a group's newest `keep` items. */
  private trimItems(key: string, keep: number): void {
    const old = this.read<{ id: number; bytes: number }>(
      'SELECT id, bytes FROM items WHERE key = ? ORDER BY id DESC LIMIT -1 OFFSET ?',
      key,
      keep,
    );
    for (const o of old) this.dropItem(o.id, o.bytes);
  }

  private dropItem(id: number, bytes: number): void {
    this.write('DELETE FROM items WHERE id = ?', id);
    if (this.itemCount !== null) this.itemCount--;
    if (this.itemBytes !== null) this.itemBytes -= bytes;
  }

  /** Forget what nobody has seen for `keepDays` (the daily alarm). True if anything is left to watch. */
  sweep(now: number): boolean {
    const before = now - this.limits.keepDays * DAY_MS;
    const groups = this.read<{ key: string }>('SELECT key FROM groups WHERE last < ?', before);
    for (const g of groups) this.write('DELETE FROM groups WHERE key = ?', g.key);
    const items = this.read<{ id: number; bytes: number }>(
      'SELECT id, bytes FROM items WHERE at < ? OR key NOT IN (SELECT key FROM groups)',
      before,
    );
    for (const i of items) this.dropItem(i.id, i.bytes);
    if (groups.length) this.groupCount = null;
    return (this.read<{ n: number }>('SELECT count(*) AS n FROM groups')[0]?.n ?? 0) > 0;
  }

  /** When the next sweep is due: a day from now if anything is kept, else never. */
  nextSweep(now: number): number | null {
    return this.counts().groups > 0 ? now + DAY_MS : null;
  }

  // ------------------------------------------------------------------ the owner's side

  /**
   * Is this the owner's key? Wrong tries are limited per address and for everyone together (rotating
   * addresses don't buy more guesses); a key shorter than `ownerKeyMin` is taken as no key at all.
   */
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

  private items(key: string): ItemView[] {
    return this.read<ItemRow>(
      'SELECT id, key, at, note, summary, shot, replay, bytes FROM items WHERE key = ? ORDER BY id DESC',
      key,
    ).map((i) => ({
      id: i.id,
      at: i.at,
      note: i.note,
      summary: i.summary,
      shot: !!i.shot,
      replay: !!i.replay,
      bytes: i.bytes,
    }));
  }

  private view(g: GroupRow): GroupView {
    return {
      key: g.key,
      kind: g.kind as ReportKind,
      message: g.message,
      stack: g.stack,
      first: g.first,
      last: g.last,
      count: g.count,
      status: g.status as GroupStatus,
      fixedAt: g.fixed_at,
      reopened: !!g.reopened,
      builds: list(g.builds).map(([build, count]) => ({ build, count })),
      browsers: list(g.browsers).map(([browser, count]) => ({ browser, count })),
      env: JSON.parse(g.env) as ReportEnv,
      items: this.items(g.key),
      dropped: g.dropped,
    };
  }

  /** Groups, newest first: open ones, fixed ones, or all. */
  groups(status: GroupStatus | 'all' = 'all'): GroupView[] {
    const rows =
      status === 'all'
        ? this.read<GroupRow>('SELECT * FROM groups ORDER BY last DESC')
        : this.read<GroupRow>('SELECT * FROM groups WHERE status = ? ORDER BY last DESC', status);
    return rows.map((g) => this.view(g));
  }

  group(key: string): GroupView | null {
    const g = this.read<GroupRow>('SELECT * FROM groups WHERE key = ?', key)[0];
    return g ? this.view(g) : null;
  }

  item(id: number): ItemFull | null {
    const i = this.read<ItemRow>('SELECT * FROM items WHERE id = ?', id)[0];
    if (!i?.data) return null;
    return {
      id: i.id,
      key: i.key,
      at: i.at,
      note: i.note,
      summary: i.summary,
      shot: !!i.shot,
      replay: !!i.replay,
      bytes: i.bytes,
      report: JSON.parse(i.data) as Report,
    };
  }

  /** Mark a group fixed (for every build it has come from so far) or open again. */
  setStatus(key: string, status: GroupStatus, now: number): boolean {
    const g = this.read<GroupRow>('SELECT * FROM groups WHERE key = ?', key)[0];
    if (!g) return false;
    if (status === 'fixed')
      this.write(
        "UPDATE groups SET status = 'fixed', fixed_at = ?, fixed_builds = ?, fixed_built = ?, reopened = 0 WHERE key = ?",
        now,
        JSON.stringify(list(g.builds).map(([b]) => b)),
        Math.max(0, ...(JSON.parse(g.builds || '[]') as Tally).map((e) => e[3] ?? 0)) || null,
        key,
      );
    else this.write("UPDATE groups SET status = 'open', reopened = 0 WHERE key = ?", key);
    return true;
  }

  deleteGroup(key: string): boolean {
    const had = this.read<{ key: string }>('SELECT key FROM groups WHERE key = ?', key).length > 0;
    for (const i of this.read<{ id: number; bytes: number }>(
      'SELECT id, bytes FROM items WHERE key = ?',
      key,
    ))
      this.dropItem(i.id, i.bytes);
    if (had) {
      this.write('DELETE FROM groups WHERE key = ?', key);
      this.groupCount = null;
    }
    return had;
  }

  deleteItem(id: number): boolean {
    const i = this.read<{ id: number; bytes: number }>('SELECT id, bytes FROM items WHERE id = ?', id)[0];
    if (!i) return false;
    this.dropItem(i.id, i.bytes);
    return true;
  }

  /** What the store holds, against its caps (the owner area's footer). */
  usage(now: number): {
    groups: number;
    items: number;
    bytes: number;
    rowsToday: number;
    limits: typeof REPORT_LIMITS;
  } {
    return { ...this.counts(), rowsToday: this.budget.used(now), limits: this.limits };
  }
}

/** A desync's line in the owner area: the side, the tick, and what a replay needs. */
export function desyncSummary(r: Report): string | null {
  const d = r.desync;
  if (!d) return null;
  const replay =
    d.where === 'battle'
      ? 'hashes only'
      : d.cut || !d.events
        ? 'too many events to replay'
        : d.start?.founded
          ? 'replays from nothing more'
          : d.start
            ? `replays from the city saved at tick ${d.start.tick}`
            : 'no start to replay from';
  return `${r.message} · tick ${d.tick} · ${replay}`;
}

/** Compare two strings in time that doesn't depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
