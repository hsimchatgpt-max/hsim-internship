// Browser smoke test for the zero-setup (embedded database) mode. No direct DB access: everything goes through the UI.
// Usage: BASE_URL=http://localhost:3001 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e/embedded.mjs
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.error("PAGE ERROR", e.message); process.exitCode = 1; });
let n = 0; const ok = (m) => console.log(`✓ ${++n}. ${m}`);
const toast = (t) => page.locator("[role=status],[role=alert]").filter({ hasText: t }).first().waitFor({ timeout: 10000 });

await page.goto(BASE + "/login");
await page.getByLabel("Email").fill(process.env.ADMIN_EMAIL);
await page.getByLabel("Password").fill(process.env.ADMIN_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Dashboard" }).waitFor(); ok("login");
assert.ok((await page.locator("a", { hasText: "Active interns" }).first().innerText()).includes("17")); ok("demo data present (17 active interns)");

// duplicate HSIM ID (unique-violation detection through the embedded driver)
await page.goto(BASE + "/interns/new");
const fill = (l, v) => page.getByLabel(l).first().fill(v);
await fill("HSIM ID", "HSIM001"); await fill("Full name", "Dup"); await fill("Phone number", "+91 98765 43210"); await fill("Email", "d@x.test");
await page.getByLabel("Department").selectOption("SEO"); await fill("Batch", "Z"); await fill("Joining date", "2026-10-01"); await fill("Assigned trainer", "T");
await page.getByRole("button", { name: "Add intern" }).click();
await page.getByText("This HSIM ID is already used by another intern.").waitFor(); ok("duplicate HSIM ID blocked");
await fill("HSIM ID", "HSIM900"); await fill("Full name", "Embedded Test");
await page.getByRole("button", { name: "Add intern" }).click();
await page.getByRole("heading", { name: "Embedded Test" }).waitFor(); ok("intern created");

// attendance: mark all, change one, save, then re-save (upsert with arrays)
await page.goto(BASE + "/attendance");
await page.getByRole("button", { name: "Mark All Present" }).click();
await page.getByRole("group", { name: "Status for Embedded Test" }).getByRole("button", { name: "Absent" }).click();
await page.getByRole("button", { name: "Save Attendance" }).click();
await toast("Attendance saved successfully."); ok("attendance saved");
await page.reload();
await page.getByRole("group", { name: "Status for Embedded Test" }).getByRole("button", { name: "Absent" }).and(page.locator('[aria-pressed="true"]')).waitFor(); ok("attendance persisted");
await page.getByRole("group", { name: "Status for Embedded Test" }).getByRole("button", { name: "Half Day" }).click();
await page.getByRole("button", { name: "Save Attendance" }).click();
await page.getByRole("button", { name: "Save changes" }).click();
await toast("Attendance saved successfully."); ok("re-save updates in place");

// leave approved over existing attendance -> conflict -> overwrite (transaction path)
const today = new Date().toISOString().slice(0, 10);
await page.goto(BASE + "/leaves?new=1");
await page.locator("#f-intern_id").selectOption({ label: "HSIM900 — Embedded Test" });
await page.locator("#f-start_date").fill(today); await page.locator("#f-end_date").fill(today);
await page.getByLabel("Reason").fill("test"); await page.locator("#f-status").selectOption("Approved");
await page.getByRole("button", { name: "Save", exact: true }).click();
if (new Date().getUTCDay() !== 0) {
  await page.getByText("Attendance conflict").waitFor(); await page.getByRole("button", { name: "Overwrite with Leave" }).click();
}
await toast("Leave approved and attendance updated."); ok("leave transaction + conflict flow");

// review + export
await page.goto(BASE + "/performance?new=1");
await page.locator("#f-intern_id").selectOption({ label: "HSIM900 — Embedded Test" });
for (const l of ["Work quality", "Learning progress", "Task completion", "Punctuality", "Communication"]) await page.getByLabel(l).selectOption("4");
await page.getByRole("button", { name: "Save review" }).click(); await toast("Overall rating 4/5."); ok("performance review");
for (const [u, t] of [["interns?format=xlsx", /spreadsheetml/], ["attendance?view=summary", /csv/], ["tasks", /csv/]]) {
  const r = await ctx.request.get(`${BASE}/api/export/${u}`); assert.equal(r.status(), 200); assert.match(r.headers()["content-type"], t);
}
ok("exports (xlsx + csv)");

// cleanup the throwaway intern is not possible (history) -> mark Left so it is out of daily attendance
await page.goto(BASE + "/interns?q=HSIM900");
await page.getByRole("link", { name: "Embedded Test" }).click();
await page.locator("#status-select").selectOption("Left");
await page.getByRole("button", { name: "Mark Left" }).click(); await toast("Status changed to Left."); ok("status change");
await browser.close();
console.log("\nEmbedded-mode e2e passed.");
