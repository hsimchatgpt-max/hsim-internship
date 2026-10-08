/**
 * One-command local launcher (used by start.bat / start.command / start.sh).
 * First run: asks for an admin email + password, writes .env.local, creates the embedded database (+ optional demo data),
 * builds the app. Every run: starts the server on http://localhost:3000 and opens the browser.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createDb } from "../src/lib/db-core";
import { ensureAdmin } from "./create-admin";
import { loadEnv } from "./env";
import { migrate } from "./migrate";
import { seedDemo } from "./seed";

const PORT = process.env.PORT || "3000";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

async function firstRunSetup() {
  console.log("\n=== HSIM Intern Portal — first-time setup ===\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const name = (await rl.question("Your name [Admin]: ")).trim() || "Admin";
  let email = "";
  while (!/^\S+@\S+\.\S+$/.test(email)) email = (await rl.question("Admin email (you will log in with this): ")).trim();
  let password = "";
  while (password.length < 10) password = await rl.question("Admin password (at least 10 characters): ");
  const demo = /^y/i.test((await rl.question("Add 20 demo interns so you can try it out? (y/n) [y]: ")).trim() || "y");
  rl.close();

  writeFileSync(
    ".env.local",
    [
      "# Created by the local launcher. No DATABASE_URL = built-in local database stored in the ./data folder.",
      `SESSION_SECRET=${randomBytes(48).toString("base64")}`,
      `ADMIN_NAME="${name.replace(/"/g, "")}"`,
      `ADMIN_EMAIL=${email}`,
      `ADMIN_PASSWORD=${password}`,
      "APP_TIMEZONE=Asia/Kolkata",
      "",
    ].join("\n"),
  );
  loadEnv();
  return demo;
}

async function prepareDatabase(seed: boolean) {
  const db = await createDb();
  try {
    await migrate(db);
    const admins = Number((await db.query("SELECT count(*) AS n FROM admins")).rows[0].n);
    if (admins === 0) await ensureAdmin(db);
    if (seed) await seedDemo(db);
  } finally {
    await db.end(); // release the database files before the server opens them
  }
}

function run(args: string[]) {
  const r = spawnSync(npx, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`"${args.join(" ")}" failed`);
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* ignore */ }
}

async function main() {
  const firstRun = !existsSync(".env.local");
  let demo = false;
  if (firstRun) demo = await firstRunSetup();
  else loadEnv();

  if (process.env.DATABASE_URL) console.log("Using PostgreSQL from DATABASE_URL.");
  else console.log("Using the built-in local database (./data). Back up that folder to keep your data safe.");
  await prepareDatabase(demo);

  if (!existsSync(".next/BUILD_ID")) {
    console.log("\nBuilding the app (first time only, takes a minute)…");
    run(["next", "build"]);
  }

  console.log(`\nStarting HSIM Intern Portal on http://localhost:${PORT}  (close this window to stop it)\n`);
  const server = spawn(npx, ["next", "start", "-p", PORT], { stdio: "inherit", shell: process.platform === "win32" });
  server.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.kill());

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      if ((await fetch(`http://localhost:${PORT}/login`)).ok) { openBrowser(`http://localhost:${PORT}`); break; }
    } catch { /* not up yet */ }
  }
}

main().catch((e) => { console.error("\nSetup failed:", e.message ?? e); process.exit(1); });
