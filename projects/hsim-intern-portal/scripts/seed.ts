/**
 * Demo data: 20 clearly fictional interns (10 SEO, 10 Social Media) with attendance, tasks, reviews, leaves and certificates.
 * Refuses to run if interns already exist (so it can never overwrite real data) unless SEED_FORCE=1.
 */
import { createDb } from "../src/lib/db-core";
import { addDays, addMonths, isSunday, todayISO } from "../src/lib/dates";
import { overallRating } from "../src/lib/rating";
import { ensureAdmin } from "./create-admin";
import type { Db } from "../src/lib/db-core";
import { loadEnv } from "./env";

const NAMES = [
  "Aarav Demo", "Diya Sample", "Kabir Test", "Meera Example", "Rohan Placeholder", "Ishita Fictional", "Vihaan Mock", "Anaya Trial",
  "Arjun Dummy", "Saanvi Specimen", "Reyansh Sandbox", "Kiara Pilot", "Advait Draft", "Navya Prototype", "Aditya Sketch",
  "Myra Mockup", "Krish Sample", "Tara Example", "Dev Placeholder", "Zoya Demo",
];
const TRAINERS = { SEO: ["Trainer Alpha", "Trainer Beta"], "Social Media": ["Trainer Gamma", "Trainer Delta"] } as const;
const TASKS = {
  SEO: ["Keyword research for client blog", "On-page audit of sample site", "Write 3 meta descriptions", "Backlink gap analysis", "Technical SEO checklist"],
  "Social Media": ["Draft a week of Instagram captions", "Design 2 carousel posts", "Competitor social audit", "Reel script for product launch", "Content calendar for next month"],
} as const;

// small deterministic PRNG so seeds are reproducible
let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

/** Adds 20 fictional interns with history. Refuses to run on a database that already has interns unless `force`. */
export async function seedDemo(db: Db, opts: { force?: boolean } = {}): Promise<boolean> {
  const existing = Number((await db.query("SELECT count(*) AS n FROM interns")).rows[0].n);
  if (existing > 0 && !opts.force) {
    console.log(`Interns already exist (${existing}); skipping demo data. Set SEED_FORCE=1 to add anyway.`);
    return false;
  }
  const cx = await db.connect();
  try {
    await cx.query("BEGIN");
    const today = todayISO();

    const ids: { id: number; dept: "SEO" | "Social Media"; join: string; end: string; status: string; hsim: string }[] = [];
    for (let i = 0; i < NAMES.length; i++) {
      const dept = i % 2 === 0 ? "SEO" : "Social Media";
      const hsim = `HSIM${String(i + 1).padStart(3, "0")}`;
      const duration = i < 14 ? 3 : 2;
      // Most started 4–8 weeks ago; a few are older so they are Completed / ending soon.
      const join = i >= 16 ? addDays(today, -(duration * 30 - 5 - (i - 16) * 2)) : i >= 14 ? addDays(today, -80) : addDays(today, -(28 + Math.floor(rnd() * 28)));
      const end = addMonths(join, duration);
      const status = i === 14 || i === 15 ? "Completed" : i === 19 ? "Left" : "Active";
      const r = await cx.query(
        `INSERT INTO interns (hsim_id, full_name, phone, email, department, batch, joining_date, internship_duration_months, end_date, trainer, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [hsim, NAMES[i], `+91 90000 ${String(10000 + i * 137).slice(0, 5)}`, `${NAMES[i].split(" ")[0].toLowerCase()}@example.test`, dept,
          i < 14 ? "Batch A" : "Batch B", join, duration, end, pick(TRAINERS[dept]), status, i === 3 ? "Demo record — safe to edit or delete." : null],
      );
      ids.push({ id: r.rows[0].id, dept, join, end, status, hsim });
    }

    // attendance for each intern from joining until yesterday (until today for active ones, today left unmarked on purpose)
    for (const it of ids) {
      const stop = it.status === "Active" ? addDays(today, -1) : it.status === "Left" ? addDays(it.join, 20) : it.end;
      const days: string[] = [];
      for (let d = it.join; d <= stop && d < today; d = addDays(d, 1)) if (!isSunday(d)) days.push(d);
      const values = days.map((d) => {
        const x = rnd();
        const st = it.hsim === "HSIM007" ? (x < 0.45 ? "Present" : x < 0.85 ? "Absent" : "Half Day")  // deliberately low attendance demo
          : x < 0.84 ? "Present" : x < 0.92 ? "Absent" : x < 0.97 ? "Leave" : "Half Day";
        return [it.id, d, st];
      });
      for (let i = 0; i < values.length; i += 200) {
        const chunk = values.slice(i, i + 200);
        await cx.query(
          `INSERT INTO attendance (intern_id, attendance_date, status) SELECT * FROM unnest($1::bigint[], $2::date[], $3::text[])`,
          [chunk.map((v) => v[0]), chunk.map((v) => v[1]), chunk.map((v) => v[2])],
        );
      }
    }

    // tasks
    for (const it of ids.filter((x) => x.status !== "Left")) {
      const titles = [...TASKS[it.dept]].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 2));
      for (const [k, title] of titles.entries()) {
        const assigned = addDays(today, -14 + k * 5);
        const due = addDays(assigned, 7 + k * 3);
        const status = due < today ? (rnd() < 0.7 ? "Completed" : "In Progress") : rnd() < 0.5 ? "Not Started" : "In Progress";
        await cx.query(
          `INSERT INTO tasks (intern_id, title, description, department, assigned_date, due_date, priority, status, trainer_notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [it.id, title, `Demo task: ${title.toLowerCase()}.`, it.dept, assigned, due, pick(["Low", "Medium", "High"]), status, null],
        );
      }
    }

    // performance reviews
    for (const it of ids.filter((x) => x.status !== "Left").slice(0, 14)) {
      const n = it.status === "Completed" ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const r = { work_quality: 2 + Math.floor(rnd() * 4), learning_progress: 3 + Math.floor(rnd() * 3), task_completion: 2 + Math.floor(rnd() * 4), punctuality: 2 + Math.floor(rnd() * 4), communication: 3 + Math.floor(rnd() * 3) };
        await cx.query(
          `INSERT INTO performance_reviews (intern_id, review_date, work_quality, learning_progress, task_completion, punctuality, communication, overall_rating, feedback) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [it.id, addDays(today, -7 - k * 21), r.work_quality, r.learning_progress, r.task_completion, r.punctuality, r.communication, overallRating(r), "Demo feedback: shows steady progress."],
        );
      }
    }

    // leaves: one approved (with matching attendance), one pending, one rejected
    const a = ids[1], b = ids[2], c = ids[4];
    const lv = await cx.query(`INSERT INTO leaves (intern_id, start_date, end_date, reason, status) VALUES ($1,$2,$3,'Family function (demo)','Approved') RETURNING id`, [a.id, addDays(today, -9), addDays(today, -8)]);
    await cx.query(
      `INSERT INTO attendance (intern_id, attendance_date, status, notes, leave_id)
       SELECT $1, d::date, 'Leave', 'Approved leave', $3 FROM generate_series($2::date, $2::date + 1, '1 day') d WHERE extract(dow FROM d) <> 0
       ON CONFLICT (intern_id, attendance_date) DO UPDATE SET status='Leave', notes='Approved leave', leave_id=EXCLUDED.leave_id`,
      [a.id, addDays(today, -9), lv.rows[0].id],
    );
    await cx.query(`INSERT INTO leaves (intern_id, start_date, end_date, reason, status) VALUES ($1,$2,$3,'Medical appointment (demo)','Pending')`, [b.id, addDays(today, 3), addDays(today, 3)]);
    await cx.query(`INSERT INTO leaves (intern_id, start_date, end_date, reason, status) VALUES ($1,$2,$3,'Personal work (demo)','Rejected')`, [c.id, addDays(today, -20), addDays(today, -19)]);

    // certificates: first completed intern eligible but pending; second issued
    const done = ids.filter((x) => x.status === "Completed");
    await cx.query(`INSERT INTO certificates (intern_id, eligibility, status) VALUES ($1, true, 'Pending')`, [done[0].id]);
    await cx.query(`INSERT INTO certificates (intern_id, eligibility, status, issue_date, certificate_number) VALUES ($1, true, 'Issued', $2, $3)`, [done[1].id, addDays(today, -2), `HSIM-CERT-DEMO-${done[1].hsim}`]);

    await cx.query("COMMIT");
    console.log(`Seeded ${ids.length} demo interns with attendance, tasks, reviews, leaves and certificates.`);
    return true;
  } catch (e) {
    await cx.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    cx.release();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  loadEnv();
  createDb()
    .then(async (db) => { try { await ensureAdmin(db); await seedDemo(db, { force: process.env.SEED_FORCE === "1" }); } finally { await db.end(); } })
    .catch((e) => { console.error(e); process.exit(1); });
}
