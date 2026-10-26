/**
 * Rooms' and regions' stores in a Durable Object's SQLite (M30, F8), kept free of Cloudflare's runtime
 * so tests run them over Node's own SQLite.
 *
 * Within the free plan's rows written a day (F8):
 * - Tables are made on the first write, and a read of a store with none returns nothing: a code
 *   nobody hosts leaves no storage behind, however often it's tried.
 * - Events are kept a batch to a row.
 * - Snapshot parts and city saves are upserted then trimmed, rather than all deleted and written.
 * - The key-value table has no rowid, so a write costs one row and no index row.
 *
 * `rowsWritten` adds up what the platform reports for every statement (the number billed).
 */
import type { Stamped } from '../src/sim/lockstep';
import type { RoomMeta, RoomStore, StoredSnapshot } from './room';
import type { RegionMeta, RegionStore } from './region';

/** The part of a Durable Object's SQL API the stores use. */
export interface Sql {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): T[]; readonly rowsWritten: number };
}

/** Tables made on the first write; reads before then find nothing. */
class LazyTables {
  private ready: boolean | null = null;
  rowsWritten = 0;

  constructor(
    protected readonly sql: Sql,
    private readonly tables: Record<string, string>,
  ) {}

  /** Do the tables exist? Asked once, by reading: probing a code nobody hosts writes nothing. */
  private has(): boolean {
    if (this.ready === null) {
      const first = Object.keys(this.tables)[0]!;
      this.ready =
        this.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", first).toArray()
          .length > 0;
    }
    return this.ready;
  }

  protected write(query: string, ...bindings: unknown[]): void {
    if (!this.has()) {
      for (const [name, columns] of Object.entries(this.tables))
        this.sql.exec(`CREATE TABLE IF NOT EXISTS ${name} ${columns}`);
      this.ready = true;
    }
    this.rowsWritten += this.sql.exec(query, ...bindings).rowsWritten;
  }

  protected read<T>(query: string, ...bindings: unknown[]): T[] {
    return this.has() ? this.sql.exec<T>(query, ...bindings).toArray() : [];
  }

  protected get(k: string): string | null {
    return this.read<{ v: string }>('SELECT v FROM kv WHERE k = ?', k)[0]?.v ?? null;
  }

  protected put(k: string, v: string): void {
    this.write('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, v);
  }

  /** Forget everything (an expired room or region). */
  deleteAll(): void {
    for (const name of Object.keys(this.tables)) this.sql.exec(`DROP TABLE IF EXISTS ${name}`);
    this.ready = false;
  }
}

const KV = '(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID';

/** A room's store: its record, the latest snapshot and the events since, a batch to a row. */
export class SqlStore extends LazyTables implements RoomStore {
  constructor(sql: Sql) {
    super(sql, {
      kv: KV,
      events: '(first INTEGER PRIMARY KEY, last INTEGER NOT NULL, list TEXT NOT NULL)',
      snap: '(part INTEGER PRIMARY KEY, data TEXT NOT NULL)',
    });
  }
  loadMeta(): RoomMeta | null {
    const v = this.get('meta');
    return v ? (JSON.parse(v) as RoomMeta) : null;
  }
  saveMeta(meta: RoomMeta): void {
    this.put('meta', JSON.stringify(meta));
  }
  loadEvents(): Stamped[] {
    return this.read<{ list: string }>('SELECT list FROM events ORDER BY first').flatMap(
      (r) => JSON.parse(r.list) as Stamped[],
    );
  }
  appendEvents(list: Stamped[]): void {
    if (!list.length) return;
    this.write(
      'INSERT INTO events (first, last, list) VALUES (?, ?, ?) ' +
        'ON CONFLICT (first) DO UPDATE SET last = excluded.last, list = excluded.list',
      list[0]!.seq,
      list.at(-1)!.seq,
      JSON.stringify(list),
    );
  }
  saveSnapshot(s: StoredSnapshot): void {
    s.parts.forEach((data, part) =>
      this.write(
        'INSERT INTO snap (part, data) VALUES (?, ?) ON CONFLICT (part) DO UPDATE SET data = excluded.data',
        part,
        data,
      ),
    );
    this.write('DELETE FROM snap WHERE part >= ?', s.parts.length);
    this.put('snapmeta', JSON.stringify(s.meta));
    this.write('DELETE FROM events WHERE last <= ?', s.meta.seq);
  }
  loadSnapshot(): StoredSnapshot | null {
    const meta = this.get('snapmeta');
    if (!meta) return null;
    const parts = this.read<{ data: string }>('SELECT data FROM snap ORDER BY part').map((r) => r.data);
    return { meta: JSON.parse(meta) as StoredSnapshot['meta'], parts };
  }
}

/** Parts of a city's save are rows `slot * SLOT + part`. */
const SLOT = 1000;

/** A shared region's store (M32): its record and each city's latest save for visitors. */
export class RegionSqlStore extends LazyTables implements RegionStore {
  constructor(sql: Sql) {
    super(sql, { kv: KV, saves: '(id INTEGER PRIMARY KEY, data TEXT NOT NULL)' });
  }
  loadMeta(): RegionMeta | null {
    const v = this.get('meta');
    return v ? (JSON.parse(v) as RegionMeta) : null;
  }
  saveMeta(m: RegionMeta): void {
    this.put('meta', JSON.stringify(m));
  }
  saveCity(slot: number, parts: string[]): void {
    parts.forEach((data, part) =>
      this.write(
        'INSERT INTO saves (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data',
        slot * SLOT + part,
        data,
      ),
    );
    this.write('DELETE FROM saves WHERE id >= ? AND id < ?', slot * SLOT + parts.length, (slot + 1) * SLOT);
  }
  loadCity(slot: number): string[] | null {
    const rows = this.read<{ data: string }>(
      'SELECT data FROM saves WHERE id >= ? AND id < ? ORDER BY id',
      slot * SLOT,
      (slot + 1) * SLOT,
    );
    return rows.length ? rows.map((r) => r.data) : null;
  }
}
