import type { QueryResultRow } from "pg";
import { createDb, type Db, type DbClient } from "./db-core";

const g = globalThis as unknown as { __hsimDb?: Promise<Db> };

/** One shared database handle per server process (survives hot reloads). */
export const database = (): Promise<Db> => (g.__hsimDb ??= createDb());

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await (await database()).query<T>(text, params)).rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}

export async function transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await (await database()).connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** True when a Postgres error is a unique violation, optionally on a specific constraint/index. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && (!constraint || err.constraint === constraint);
}

export function isForeignKeyViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23503";
}
