// End-to-end smoke test against a running server (BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD).
// Usage: node tests/e2e/smoke.mjs   (needs a seeded database; leaves a few extra demo rows behind)
import { chromium } from "playwright-core";
import pg from "pg";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@hsim.test";
const PASS = process.env.ADMIN_PASSWORD ?? "ChangeMe-Dev-123";
const SHOTS = process.env.SHOT_DIR;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = async (sql, p) => (await db.query(sql, p)).rows;

// idempotent: remove rows left by a previous run
await db.query(`DELETE FROM attendance WHERE intern_id IN (SELECT id FROM interns WHERE hsim_id='HSIM900')`);
for (const t of ["tasks", "leaves", "performance_reviews", "certificates"]) await db.query(`DELETE FROM ${t} WHERE intern_id IN (SELECT id FROM interns WHERE hsim_id='HSIM900')`);
await db.query(`DELETE FROM interns WHERE hsim_id='HSIM900'`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.error("PAGE ERROR", e.message); process.exitCode = 1; });
let step = 0;
const ok = (m) => console.log(`✓ ${++step}. ${m}`);
const toast = (t) => page.locator("[role=status],[role=alert]").filter({ hasText: t }).first().waitFor({ timeout: 8000 });
const today = (await q("select to_char(now() at time zone 'Asia/Kolkata','YYYY-MM-DD') d"))[0].d;

// --- auth
await page.goto(BASE + "/interns");
assert.match(page.url(), /\/login/); ok("unauthenticated access redirects to login");
await page.getByLabel("Email").fill(EMAIL);
await page.getByLabel("Password").fill("wrong-password");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByText("Incorrect email or password.").waitFor(); ok("wrong password rejected");
await page.getByLabel("Password").fill(PASS);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Dashboard" }).waitFor(); ok("login works");

// --- dashboard reflects DB
const active = (await q("select count(*)::int n from interns where status='Active'"))[0].n;
const card = page.locator("a", { hasText: "Active interns" }).first();
assert.equal((await card.innerText()).includes(String(active)), true); ok(`dashboard Active interns = ${active} (from DB)`);

// --- interns: duplicate HSIM ID, add, search, status change
await page.goto(BASE + "/interns/new");
const fill = async (l, v) => page.getByLabel(l, { exact: false }).first().fill(v);
await fill("HSIM ID", "HSIM001"); await fill("Full name", "Dup Check"); await fill("Phone number", "+91 98765 43210"); await fill("Email", "dup@example.test");
await page.getByLabel("Department").selectOption("SEO"); await fill("Batch", "Batch Z"); await fill("Joining date", today); await fill("Assigned trainer", "Trainer Alpha");
await page.getByRole("button", { name: "Add intern" }).click();
await page.getByText("This HSIM ID is already used by another intern.").waitFor(); ok("duplicate HSIM ID blocked");
await fill("HSIM ID", "HSIM900"); await fill("Full name", "E2E Intern"); await fill("Email", "not-an-email");
await page.getByRole("button", { name: "Add intern" }).click();
await page.getByText("Enter a valid email address").waitFor(); ok("email validation");
await fill("Email", "e2e@example.test");
await page.getByRole("button", { name: "Add intern" }).click();
await page.getByRole("heading", { name: "E2E Intern" }).waitFor(); ok("intern added -> profile");
const endDate = (await q("select end_date::text d, internship_duration_months m from interns where hsim_id='HSIM900'"))[0];
assert.equal(endDate.m, 3); ok(`end date auto-calculated (${endDate.d})`);

await page.goto(BASE + "/interns?q=hsim900");
await page.getByRole("link", { name: "E2E Intern" }).waitFor(); ok("search by HSIM ID");
await page.goto(BASE + "/interns?department=Social+Media&status=Active");
assert.equal(await page.locator("tbody").getByText("SEO", { exact: true }).count(), 0); ok("department+status filters");

// --- attendance
const internId = (await q("select id from interns where hsim_id='HSIM900'"))[0].id;
await page.goto(BASE + "/attendance");
await page.getByRole("button", { name: "Mark All Present" }).click();
const row = page.getByRole("group", { name: "Status for E2E Intern" });
await row.getByRole("button", { name: "Absent" }).click();
await page.getByRole("button", { name: "Save Attendance" }).click();
await toast("Attendance saved successfully."); ok("mark all present + change one + save");
const n1 = (await q("select count(*)::int n from attendance where attendance_date=$1", [today]))[0].n;
assert.equal((await q("select status from attendance where intern_id=$1 and attendance_date=$2", [internId, today]))[0].status, "Absent");
await page.reload();
await page.getByRole("group", { name: "Status for E2E Intern" }).getByRole("button", { name: "Absent" }).and(page.locator('[aria-pressed="true"]')).waitFor(); ok("attendance persisted after reload");
await page.getByRole("group", { name: "Status for E2E Intern" }).getByRole("button", { name: "Half Day" }).click();
await page.getByRole("button", { name: "Save Attendance" }).click();
await page.getByRole("button", { name: "Save changes" }).click(); // confirm overwrite dialog
await toast("Attendance saved successfully.");
const n2 = (await q("select count(*)::int n from attendance where attendance_date=$1", [today]))[0].n;
assert.equal(n1, n2); assert.equal((await q("select status from attendance where intern_id=$1 and attendance_date=$2", [internId, today]))[0].status, "Half Day");
ok("re-saving edits in place (no duplicate rows), with confirmation");
await db.query("insert into attendance (intern_id, attendance_date, status) values ($1,$2,'Present')", [internId, today]).then(() => assert.fail("dup allowed"), (e) => assert.equal(e.code, "23505"));
ok("DB unique(intern_id, date) enforced");

// --- leaves with conflict
await page.goto(BASE + "/leaves?new=1");
await page.locator("#f-intern_id").selectOption(String(internId));
await page.locator("#f-start_date").fill(today); await page.locator("#f-end_date").fill(today);
await page.getByLabel("Reason").fill("E2E leave");
await page.locator("#f-status").selectOption("Approved");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.getByText("Attendance conflict").waitFor(); ok("approved leave over existing attendance warns");
await page.getByRole("button", { name: "Overwrite with Leave" }).click();
await toast("Leave approved and attendance updated.");
const isSun = new Date(today + "T00:00:00Z").getUTCDay() === 0;
if (!isSun) assert.equal((await q("select status from attendance where intern_id=$1 and attendance_date=$2", [internId, today]))[0].status, "Leave");
ok("leave written to attendance");
const leaveId = (await q("select id from leaves where intern_id=$1", [internId]))[0].id;
await page.goto(BASE + "/leaves");
await page.getByRole("row", { name: /E2E Intern/ }).getByRole("button", { name: "Reject" }).click();
await page.getByRole("button", { name: "Reject leave" }).click();
await toast("Leave rejected."); 
assert.equal((await q("select count(*)::int n from attendance where leave_id=$1", [leaveId]))[0].n, 0); ok("rejecting leave removes its attendance rows (with confirmation)");
await page.goto(BASE + "/leaves?new=1");
await page.locator("#f-intern_id").selectOption(String(internId));
await page.locator("#f-start_date").fill(today); await page.locator("#f-end_date").fill(today); await page.getByLabel("Reason").fill("overlap");
await page.getByRole("button", { name: "Save", exact: true }).click();
await toast("Leave request added."); ok("pending leave created (rejected leave doesn't block)");

// --- tasks
await page.goto(BASE + "/tasks?new=1");
await page.getByLabel("Task title").fill("E2E overdue task");
await page.locator("#f-intern_id").selectOption(String(internId));
await page.getByLabel("Assigned date").fill("2020-01-01"); await page.getByLabel("Due date").fill("2020-01-05");
await page.getByRole("button", { name: "Save task" }).click();
await toast("Task added.");
await page.getByRole("row", { name: /E2E overdue task/ }).getByText("Overdue", { exact: true }).waitFor(); ok("task created; overdue detected");
await page.getByLabel("Status for E2E overdue task").selectOption("Completed");
await toast("Task marked Completed.");
await page.getByRole("row", { name: /E2E overdue task/ }).getByText("Overdue", { exact: true }).waitFor({ state: "detached" }); ok("completed task no longer overdue");

// --- performance
await page.goto(BASE + "/performance?new=1");
await page.locator("#f-intern_id").selectOption(String(internId));
for (const [l, v] of [["Work quality", "5"], ["Learning progress", "4"], ["Task completion", "4"], ["Punctuality", "3"], ["Communication", "4"]]) await page.getByLabel(l).selectOption(v);
await page.getByLabel("Trainer feedback").fill("Great");
await page.getByRole("button", { name: "Save review" }).click();
await toast("Overall rating 4/5."); ok("review saved, overall = average (4.0)");

// --- certificates
await db.query("update interns set status='Completed' where id=$1", [internId]);
await page.goto(BASE + "/certificates?q=HSIM900");
await page.getByRole("button", { name: "Mark eligible" }).click(); await toast("Marked as eligible.");
await page.getByRole("button", { name: "Issue", exact: true }).click();
await page.getByRole("button", { name: "Mark as issued" }).click(); await toast("Certificate marked as issued.");
assert.equal((await q("select status from certificates where intern_id=$1", [internId]))[0].status, "Issued"); ok("certificate eligibility -> explicit issue");

// --- dashboard alerts + reports + export
await page.goto(BASE + "/");
await page.getByText("Certificate pending").first().waitFor(); ok("dashboard alerts (certificate pending) from DB");
await page.goto(BASE + "/reports");
await page.getByRole("heading", { name: "Reports" }).waitFor();
const dl = page.waitForEvent("download");
await page.getByRole("link", { name: "Summary CSV" }).click();
const csv = await (await dl).createReadStream(); let txt = ""; for await (const c of csv) txt += c;
assert.match(txt, /HSIM ID,Name,Department/); assert.match(txt, /HSIM900/); ok("attendance summary CSV export");
const cookies = await ctx.cookies();
const res = await ctx.request.get(BASE + "/api/export/tasks?department=SEO");
assert.equal(res.status(), 200); assert.ok((await res.text()).startsWith("﻿Task,")); ok("tasks CSV export");
const x = await ctx.request.get(BASE + "/api/export/attendance?view=summary&format=xlsx");
assert.equal(x.status(), 200); assert.match(x.headers()["content-type"], /spreadsheetml/);
const buf = await x.body(); assert.equal(buf.subarray(0, 2).toString(), "PK"); assert.ok(buf.length > 1000); ok("attendance summary Excel (.xlsx) export");
await page.goto(BASE + "/attendance/history");
await page.getByRole("table").first().waitFor(); ok("attendance history loads");

// --- responsive screenshots
if (SHOTS) {
  for (const [name, w, h] of [["mobile", 390, 844], ["tablet", 820, 1100], ["desktop", 1440, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const [p, f] of [["/", "dashboard"], ["/attendance", "attendance"], ["/interns", "interns"]]) {
      await page.goto(BASE + p); await page.waitForLoadState("networkidle");
      if (name === "mobile") assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `horizontal page scroll on ${p} mobile`);
      await page.screenshot({ path: `${SHOTS}/${name}-${f}.png`, fullPage: false });
    }
  }
  ok("responsive layouts rendered, no horizontal page scroll on mobile");
}

// --- logout
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(BASE + "/");
await page.getByRole("button", { name: "Log out" }).click();
await page.waitForURL(/\/login/);
await page.goto(BASE + "/settings"); assert.match(page.url(), /\/login/);
assert.equal((await ctx.request.get(BASE + "/api/export/interns")).status(), 401); ok("logout ends session; protected routes + API blocked");

// leave the database as we found it
await db.query(`DELETE FROM attendance WHERE intern_id = $1`, [internId]);
for (const t of ["tasks", "leaves", "performance_reviews", "certificates"]) await db.query(`DELETE FROM ${t} WHERE intern_id = $1`, [internId]);
await db.query(`DELETE FROM interns WHERE id = $1`, [internId]);
await browser.close(); await db.end();
console.log("\nAll e2e checks passed.");
