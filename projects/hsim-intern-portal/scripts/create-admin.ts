import bcrypt from "bcryptjs";
import { Client } from "pg";
import { loadEnv } from "./env";

/** Creates (or resets the password of) an admin from ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD. */
export async function ensureAdmin(client: Client) {
  const { ADMIN_NAME = "Admin", ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars) in the environment.");
  if (ADMIN_PASSWORD.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters.");
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await client.query(
    `INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, updated_at = now()`,
    [ADMIN_NAME, ADMIN_EMAIL, hash],
  );
  console.log(`Admin ready: ${ADMIN_EMAIL}`);
}

if (process.argv[1]?.endsWith("create-admin.ts")) {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  client.connect().then(() => ensureAdmin(client)).catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => client.end());
}
