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
  /** Each address: 6 reports a minute (a page sends 3 at most). */
  perAddress: { rate: 6 / 60, burst: 6 },
  /** Everyone together: 2 a second, 120 at once. */
  everyone: { rate: 2, burst: 120 },
  /** Wrong owner keys from one address: 10 a minute. */
  ownerTries: { rate: 10 / 60, burst: 10 },
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
  shot: number;
  replay: number;
  bytes: number;
  data?: string;
}

export type AddResult =
  | { ok: true; key: string; reopened: boolean; kept: boolean }
  | { ok: false; status: 400 | 413 | 429 | 503; why: string };

/** Add one to a tally, keeping the `max` biggest entries. */
function tally(json: string, key: string, n: number, max: number): string {
  const t = JSON.parse(json || '{}') as Record<string, number>;
  t[key] = (t[key] ?? 0) + n;
  const entries = Object.entries(t).sort((a, b) => b[1] - a[1]);
  return JSON.stringify(Object.fromEntries(entries.slice(0, max)));
}

const list = (json: string) =>
  Object.entries(JSON.parse(json || '{}') as Record<string, number>).sort((a, b) => b[1] - a[1]);

export class ReportDesk extends LazyTables {
  private budget: DailyRows;
  private groupCount: number | null = null;
  private itemCount: number | null = null;
  private itemBytes: number | null = null;
  private addresses = new Map<string, TokenBucket>();
  private ownerTries = new Map<string, TokenBucket>();
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
        'fixed_at INTEGER, fixed_builds TEXT NOT NULL, reopened INTEGER NOT NULL, builds TEXT NOT NULL, ' +
        'browsers TEXT NOT NULL, env TEXT NOT NULL, dropped INTEGER NOT NULL) WITHOUT ROWID',
      items:
        '(id INTEGER PRIMARY KEY, key TEXT NOT NULL, at INTEGER NOT NULL, note TEXT, shot INTEGER NOT NULL, ' +
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
    if (!this.everyone.take(now)) return { ok: false, status: 429, why: 'Too many reports at once' };
    if (this.budget.over(now)) return { ok: false, status: 503, why: 'The report desk is full for today' };
    const c = cleanReport(raw);
    if (!c.ok) return { ok: false, status: 400, why: c.why };
    const r = c.report;
    const size = JSON.stringify(r).length;
    if (size > REPORT_CAPS.body) return { ok: false, status: 413, why: 'That report is too big' };
    const key = reportKey(r, `${now.toString(36)}${secureIndex(0x7fff_ffff).toString(36)}`);
    const n = r.count ?? 1;
    const counts = this.counts();
    const old = this.read<GroupRow>('SELECT * FROM groups WHERE key = ?', key)[0];
    if (!old && counts.groups >= this.limits.maxGroups)
      return { ok: false, status: 503, why: 'The report desk is full' };
    const browser = `${r.env.browser} · ${r.env.os}`;
    // An entry marked fixed reopens when it comes back from a build the fix didn't cover.
    let reopened = false;
    let status: GroupStatus = (old?.status as GroupStatus) ?? 'open';
    if (old && status === 'fixed' && !(JSON.parse(old.fixed_builds) as string[]).includes(r.env.build)) {
      status = 'open';
      reopened = true;
    }
    const wantsItem = r.kind === 'user' || r.kind === 'desync';
    let kept = false;
    if (wantsItem) {
      const data = JSON.stringify(r);
      if (counts.items < this.limits.maxItems && counts.bytes + data.length <= this.limits.itemBytes) {
        this.write(
          'INSERT INTO items (key, at, note, shot, replay, bytes, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
          key,
          now,
          r.note ?? null,
          r.shot ? 1 : 0,
          r.desync?.events || r.desync?.start ? 1 : 0,
          data.length,
          data,
        );
        this.itemCount = counts.items + 1;
        this.itemBytes = counts.bytes + data.length;
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
        tally(old.builds, r.env.build, n, this.limits.builds),
        tally(old.browsers, browser, n, this.limits.browsers),
        JSON.stringify(r.env),
        wantsItem && !kept ? 1 : 0,
        r.message || old.message,
        r.stack || old.stack,
        key,
      );
    } else {
      this.write(
        'INSERT INTO groups (key, kind, message, stack, first, last, count, status, fixed_at, fixed_builds, ' +
          "reopened, builds, browsers, env, dropped) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, '[]', 0, ?, ?, ?, ?)",
        key,
        r.kind,
        r.message,
        r.stack,
        now,
        now,
        n,
        tally('{}', r.env.build, n, this.limits.builds),
        tally('{}', browser, n, this.limits.browsers),
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

  /** Is this the owner's key? Wrong tries are limited per address. */
  owner(
    given: string | null,
    ownerKey: string | undefined,
    address: string,
    now: number,
  ): 'ok' | 'unset' | 'wrong' | 'busy' {
    if (!ownerKey) return 'unset';
    const b = this.bucket(
      this.ownerTries,
      address,
      this.limits.ownerTries.rate,
      this.limits.ownerTries.burst,
      now,
    );
    if (!b.has(now)) return 'busy';
    if (given !== null && safeEqual(given, ownerKey)) return 'ok';
    b.take(now);
    return 'wrong';
  }

  private items(key: string): ItemView[] {
    return this.read<ItemRow>(
      'SELECT id, key, at, note, shot, replay, bytes FROM items WHERE key = ? ORDER BY id DESC',
      key,
    ).map((i) => ({ id: i.id, at: i.at, note: i.note, shot: !!i.shot, replay: !!i.replay, bytes: i.bytes }));
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
        "UPDATE groups SET status = 'fixed', fixed_at = ?, fixed_builds = ?, reopened = 0 WHERE key = ?",
        now,
        JSON.stringify(list(g.builds).map(([b]) => b)),
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

/** Compare two strings in time that doesn't depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
