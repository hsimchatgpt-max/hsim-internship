# HSIM Intern Portal — *Manage. Track. Grow.*

Admin-only web app for running an internship program (SEO + Social Media): interns, daily attendance, leaves,
tasks, performance reviews, certificates, reports and CSV export. Interns do not log in.

**Stack:** Next.js 15 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL (`pg`, parameterized SQL; embedded PGlite for zero-setup local use) ·
bcrypt + signed httpOnly session cookie (`jose`) · zod validation.

## Quick start on your own computer (no database setup)

1. Install **Node.js (LTS)** from https://nodejs.org (once).
2. Open the `projects/hsim-intern-portal` folder and **double-click `start.bat`** (Windows) or `start.command` (macOS; Linux: `./start.sh`).
3. First time only it asks for your name, admin email, a password (10+ characters) and whether to add 20 demo interns. Then it installs,
   builds (about a minute) and opens **http://localhost:3000** in your browser. Log in with the email/password you just typed.
4. Next time, double-click the same file; it starts in a few seconds. Closing that window stops the portal.

Your data lives in the `data/` folder next to the app (a built-in PostgreSQL, PGlite) — **copy that folder to back it up**. Forgot the password? Stop the
portal, set `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env.local` and run `npm run admin:create`. Don't run two copies at once on the same `data/` folder.
This mode is meant for one computer / one admin; for hosting or several users use a real PostgreSQL (below).

## Run with a real PostgreSQL (server / hosting)

Requires Node 20+ and a PostgreSQL database (local, Supabase, Neon…). If `DATABASE_URL` is set the app uses it; if not, it uses the built-in database above.

```bash
cd projects/hsim-intern-portal
npm install
cp .env.example .env.local        # then fill in the values below
npm run db:migrate                # creates tables (tracked in schema_migrations)
npm run db:seed                   # creates the admin + 20 fictional demo interns (skipped if interns already exist)
npm run dev                       # http://localhost:3000
```

Production: `npm run build && npm start`.
Create/reset an admin only (no demo data): set `ADMIN_EMAIL` / `ADMIN_PASSWORD` and run `npm run admin:create`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | no (needed for hosting) | PostgreSQL connection string. Non-localhost hosts use SSL automatically. Leave unset to use the built-in local database. |
| `SESSION_SECRET` | yes | ≥ 32 random chars used to sign session cookies (`openssl rand -base64 48`). Changing it logs everyone out. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥ 10 chars), `ADMIN_NAME` | for seed / `admin:create` | Admin login to create. Not read by the running app. |
| `APP_TIMEZONE` | no | Timezone for "today" (default `Asia/Kolkata`). |

Nothing is hard-coded: no default passwords, and `.env*` is git-ignored.

## Tests

```bash
npm run typecheck
npm test            # unit tests: attendance %, dates, CSV, validation, rating
npm run test:e2e    # browser flow test against a running server + seeded PostgreSQL (Playwright/Chromium)
node tests/e2e/embedded.mjs   # same idea for the built-in database mode (UI only)
```
The e2e test needs `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` in the environment and a running `npm start`/`npm run dev`;
it creates a throwaway intern (`HSIM900`) and removes it afterwards.

## Behaviour & decisions worth knowing

- **Attendance %** = (Present + ½ × Half Day) ÷ (Present + Absent + Half Day) × 100. Approved-leave days are *excused* and excluded
  from the denominator. The rule is shown in the UI. Shared by the profile, history, reports, dashboard alerts (`src/lib/attendance-stats.ts`).
- **One record per intern per date** is enforced by a DB unique constraint; saving uses `INSERT … ON CONFLICT DO UPDATE` in a transaction,
  so re-saving edits in place. Editing already-saved attendance asks for confirmation.
- The daily sheet lists **Active** interns who had joined by that date (plus anyone with a record that day). Future dates are blocked.
  **Mark All Present** skips interns on approved leave.
- **Leaves:** approving writes `Leave` into attendance for each non-Sunday date in the range, in one transaction. If Present/Absent/Half Day
  rows already exist the admin must confirm the overwrite. Rejecting, un-approving or deleting an approved leave removes exactly the
  attendance rows it created (`attendance.leave_id`). Overlapping pending/approved leaves for one intern are rejected. Approved leaves can't be edited (move back to Pending first).
- **Low-attendance alert** needs ≥ 5 marked days to avoid flagging someone after one absence. Ending-soon window and threshold are in Settings.
- **Performance:** overall rating = average of the five 1–5 ratings (1 decimal), computed server-side.
- **Certificates** are never auto-issued: mark eligible → Issue (number, date, optional link). Number must be unique.
- **History is preserved:** foreign keys are `ON DELETE RESTRICT`. An intern with any history can't be deleted — mark them *Left*/*Completed*.
- **Alerts/reminders are computed live** from the database, so there is no stored notifications table to go stale.
- **Export:** CSV and Excel (`.xlsx`, via `write-excel-file`) for interns, attendance (daily records or per-intern summary), tasks and
  performance. Exports honour the active filters (add `&format=xlsx` to any `/api/export/*` URL). CSV is UTF-8 with BOM and neutralises cells
  starting with `= + - @`; in `.xlsx` text is stored as text so formulas are never evaluated.
- **Security:** every page is gated by middleware *and* each server action / route handler re-checks the session; inputs validated with zod;
  all SQL is parameterized; login is throttled (8 failures / 15 min per IP+email, in-memory — use a shared store if you run multiple instances);
  security headers set in `next.config.ts`.
- **Scaling:** list pages paginate (interns 25/page, history 50/page), indexes exist for status, department, batch, dates and attendance lookups.

## Layout

```
db/migrations/      SQL schema (applied in order by scripts/migrate.ts)
scripts/            migrate, seed, create-admin
src/actions/        server actions (all mutations; auth + validation on every call)
src/lib/            db, auth/session, validation (zod), dates, attendance stats, csv, queries/*
src/app/            pages: dashboard, interns, attendance (+history), leaves, tasks, performance, certificates, reports, settings, api/export
src/components/     shared UI (modal, toasts/confirm, filters, form fields) and per-module client components
tests/              unit tests + e2e smoke test
```
