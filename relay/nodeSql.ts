/**
 * Node's own SQLite standing in for a Durable Object's (`Sql` in `relay/sqlStore.ts`): the local relay
 * keeps its report desk in it (M41), and tests count rows written as the platform bills them.
 */
import type { Sql } from './sqlStore';

export interface NodeSql {
  sql: Sql;
  /** Every row written so far. */
  written(): number;
  /** The tables there are. */
  tables(): string[];
  close(): void;
}

/** An in-memory database, or one kept in `file`. */
export async function nodeSql(file = ':memory:'): Promise<NodeSql> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  const total = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  let written = 0;
  const sql: Sql = {
    exec<T>(query: string, ...bindings: unknown[]) {
      const before = total();
      const stmt = db.prepare(query);
      const args = bindings as (string | number | null)[];
      const rows = (/^\s*select/i.test(query) ? stmt.all(...args) : (stmt.run(...args), [])) as T[];
      const rowsWritten = total() - before;
      written += rowsWritten;
      return { toArray: () => rows, rowsWritten };
    },
  };
  return {
    sql,
    written: () => written,
    tables: () =>
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (r) => r.name,
      ),
    close: () => db.close(),
  };
}
