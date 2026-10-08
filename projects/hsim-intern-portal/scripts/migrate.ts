import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, type Db } from "../src/lib/db-core";
import { loadEnv } from "./env";

/** Applies pending SQL migrations. Safe to run repeatedly. */
export async function migrate(db: Db) {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const dir = join(process.cwd(), "db", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    console.log(`Applying ${file}`);
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  loadEnv();
  createDb()
    .then(async (db) => { await migrate(db); console.log("Migrations up to date."); await db.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
