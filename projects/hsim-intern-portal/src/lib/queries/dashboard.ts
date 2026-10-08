import "server-only";
import { addDays, todayISO } from "../dates";
import { MIN_DAYS_FOR_LOW_ATTENDANCE_ALERT } from "../attendance-stats";
import { query, queryOne } from "../db";
import { getSettings } from "../settings";
import { attendanceSummary } from "./attendance";

export interface Alert {
  kind: "low-attendance" | "ending-soon" | "overdue-task" | "due-soon-task" | "certificate-pending" | "attendance-unmarked";
  title: string;
  detail: string;
  href: string;
  severity: "high" | "medium" | "low";
}

export async function dashboardData() {
  const today = todayISO();
  const settings = await getSettings();
  const soon = addDays(today, settings.endingSoonDays);

  const [stats, todayRows] = await Promise.all([
    queryOne<Record<string, number>>(
      `SELECT
         (SELECT count(*) FROM interns WHERE status = 'Active') AS active,
         (SELECT count(*) FROM interns WHERE status = 'Active' AND department = 'SEO') AS seo,
         (SELECT count(*) FROM interns WHERE status = 'Active' AND department = 'Social Media') AS social,
         (SELECT count(*) FROM attendance a JOIN interns i ON i.id = a.intern_id WHERE a.attendance_date = $1 AND a.status = 'Present' AND i.status = 'Active') AS present,
         (SELECT count(*) FROM attendance a JOIN interns i ON i.id = a.intern_id WHERE a.attendance_date = $1 AND a.status = 'Absent' AND i.status = 'Active') AS absent,
         (SELECT count(*) FROM attendance a JOIN interns i ON i.id = a.intern_id WHERE a.attendance_date = $1 AND a.status = 'Leave' AND i.status = 'Active') AS leave,
         (SELECT count(*) FROM attendance a JOIN interns i ON i.id = a.intern_id WHERE a.attendance_date = $1 AND a.status = 'Half Day' AND i.status = 'Active') AS half,
         (SELECT count(*) FROM interns WHERE status = 'Active' AND end_date BETWEEN $1 AND $2) AS ending_soon`,
      [today, soon],
    ),
    query<{ intern_id: number; hsim_id: string; full_name: string; department: string; status: string | null }>(
      `SELECT i.id AS intern_id, i.hsim_id, i.full_name, i.department, a.status
         FROM interns i LEFT JOIN attendance a ON a.intern_id = i.id AND a.attendance_date = $1
        WHERE i.status = 'Active' AND i.joining_date <= $1 ORDER BY i.hsim_id`,
      [today],
    ),
  ]);

  const alerts = await buildAlerts(today, soon, settings.attendanceThreshold, stats?.active ?? 0, todayRows.filter((r) => !r.status).length);
  return { today, settings, stats: stats!, todayRows, alerts };
}

async function buildAlerts(today: string, soon: string, threshold: number, activeCount: number, unmarked: number): Promise<Alert[]> {
  const alerts: Alert[] = [];

  if (activeCount > 0 && unmarked > 0) {
    alerts.push({
      kind: "attendance-unmarked", severity: "medium",
      title: `Attendance not marked for ${unmarked} intern${unmarked === 1 ? "" : "s"} today`,
      detail: "Open today's sheet and save attendance.", href: "/attendance",
    });
  }

  const summary = await attendanceSummary({ from: "2000-01-01", to: today, activeOnly: true });
  for (const s of summary) {
    const days = s.present + s.absent + s.half;
    if (s.percent !== null && days >= MIN_DAYS_FOR_LOW_ATTENDANCE_ALERT && s.percent < threshold) {
      alerts.push({
        kind: "low-attendance", severity: "high",
        title: `${s.full_name} (${s.hsim_id}) — attendance ${s.percent}%`,
        detail: `Below the ${threshold}% threshold (based on ${days} marked days).`, href: `/interns/${s.intern_id}?tab=attendance`,
      });
    }
  }

  const ending = await query<{ id: number; hsim_id: string; full_name: string; end_date: string }>(
    "SELECT id, hsim_id, full_name, end_date FROM interns WHERE status = 'Active' AND end_date <= $1 ORDER BY end_date",
    [soon],
  );
  for (const e of ending) {
    const over = e.end_date < today;
    alerts.push({
      kind: "ending-soon", severity: over ? "high" : "medium",
      title: `${e.full_name} (${e.hsim_id}) — ${over ? "internship period ended" : "internship ending soon"}`,
      detail: over ? `Ended on ${e.end_date}. Mark as Completed or extend the end date.` : `Ends on ${e.end_date}.`,
      href: `/interns/${e.id}`,
    });
  }

  const tasks = await query<{ id: number; title: string; due_date: string; full_name: string; hsim_id: string }>(
    `SELECT t.id, t.title, t.due_date, i.full_name, i.hsim_id FROM tasks t JOIN interns i ON i.id = t.intern_id
      WHERE t.status <> 'Completed' AND i.status = 'Active' AND t.due_date <= $1 ORDER BY t.due_date LIMIT 50`,
    [addDays(today, 3)],
  );
  for (const t of tasks) {
    const overdue = t.due_date < today;
    alerts.push({
      kind: overdue ? "overdue-task" : "due-soon-task", severity: overdue ? "high" : "low",
      title: `${overdue ? "Overdue" : "Due soon"}: ${t.title}`,
      detail: `${t.full_name} (${t.hsim_id}) — due ${t.due_date}.`, href: "/tasks",
    });
  }

  const certs = await query<{ id: number; hsim_id: string; full_name: string }>(
    `SELECT i.id, i.hsim_id, i.full_name FROM interns i LEFT JOIN certificates c ON c.intern_id = i.id
      WHERE i.status = 'Completed' AND COALESCE(c.status, 'Pending') <> 'Issued' ORDER BY i.hsim_id`,
  );
  for (const c of certs) {
    alerts.push({
      kind: "certificate-pending", severity: "medium",
      title: `Certificate pending: ${c.full_name} (${c.hsim_id})`, detail: "Internship completed; certificate not issued yet.", href: "/certificates",
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
