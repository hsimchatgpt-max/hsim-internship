/**
 * Database driver used by both the app and the CLI scripts.
 *  - DATABASE_URL set  -> PostgreSQL via `pg` (production / Supabase / Neon)
 *  - DATABASE_URL unset -> embedded PostgreSQL (PGlite) stored in ./data/pgdata, for zero-setup local use
 * Both expose the same minimal interface: query() and connect() (for transactions).
 */
import type { QueryResultRow } from "pg";
import { Pool, types } from "pg";

export interface DbResult<T> { rows: T[]; rowCount: number }
export interface DbClient {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<DbResult<T>>;
  release(): void;
}
export interface Db {
  mode: "postgres" | "embedded";
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<DbResult<T>>;
  connect(): Promise<DbClient>;
  end(): Promise<void>;
}

// DATE as 'YYYY-MM-DD' strings, numerics/bigints as numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

function postgresDb(url: string): Db {
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, max: 10, ssl: local ? undefined : { rejectUnauthorized: false } });
  return {
    mode: "postgres",
    query: async (text, params) => {
      const r = await pool.query(text, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    connect: async () => {
      const c = await pool.connect();
      return {
        query: async (text, params) => {
          const r = await c.query(text, params as unknown[]);
          return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
        },
        release: () => c.release(),
      };
    },
    end: () => pool.end(),
  };
}

async function embeddedDb(dir: string): Promise<Db> {
  const { PGlite, types: pgt } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir, {
    parsers: { [pgt.DATE]: (v: string) => v, [pgt.NUMERIC]: (v: string) => parseFloat(v), [pgt.INT8]: (v: string) => parseInt(v, 10) },
  });
  await lite.waitReady;

  // PGlite is a single connection: serialise access so a transaction's statements are never interleaved with other requests.
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
  const exec = async <T extends QueryResultRow>(text: string, params?: unknown[]): Promise<DbResult<T>> => {
    if (!params || params.length === 0) {
      const res = await lite.exec(text); // supports multi-statement scripts (migrations)
      const last = res[res.length - 1];
      const rows = (last?.rows ?? []) as T[];
      return { rows, rowCount: Math.max(rows.length, last?.affectedRows ?? 0) };
    }
    const r = await lite.query<T>(text, params);
    return { rows: r.rows, rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) };
  };

  return {
    mode: "embedded",
    query: (text, params) => exclusive(() => exec(text, params)),
    connect: async () => {
      let release!: () => void;
      const held = new Promise<void>((res) => (release = res));
      let acquired!: () => void;
      const ready = new Promise<void>((res) => (acquired = res));
      void exclusive(async () => { acquired(); await held; });
      await ready;
      return { query: (text, params) => exec(text, params), release };
    },
    end: () => lite.close(),
  };
}

export async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return postgresDb(url);
  return embeddedDb(process.env.LOCAL_DB_DIR || "data/pgdata");
}
