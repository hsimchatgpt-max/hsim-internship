import "server-only";
import { attendancePercent, type AttendanceCounts } from "../attendance-stats";
import { query } from "../db";

export interface SheetRow {
  intern_id: number;
  hsim_id: string;
  full_name: string;
  department: string;
  intern_status: string;
  attendance_id: number | null;
  status: string | null;
  notes: string | null;
  from_leave: boolean;
}

/**
 * Rows for the daily attendance sheet: Active interns who had joined by that date,
 * plus anyone (e.g. Completed/Left) who already has a record on that date.
 */
export function attendanceSheet(date: string, opts: { department?: string; q?: string } = {}) {
  const p: unknown[] = [date];
  let extra = "";
  if (opts.department) { p.push(opts.department); extra += ` AND i.department = $${p.length}`; }
  if (opts.q?.trim()) {
    p.push(`%${opts.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    extra += ` AND (i.full_name ILIKE $${p.length} OR i.hsim_id ILIKE $${p.length})`;
  }
  return query<SheetRow>(
    `SELECT i.id AS intern_id, i.hsim_id, i.full_name, i.department, i.status AS intern_status,
            a.id AS attendance_id, a.status, a.notes, (a.leave_id IS NOT NULL) AS from_leave
       FROM interns i
       LEFT JOIN attendance a ON a.intern_id = i.id AND a.attendance_date = $1
      WHERE ((i.status = 'Active' AND i.joining_date <= $1) OR a.id IS NOT NULL) ${extra}
      ORDER BY i.hsim_id`,
    p,
  );
}

export interface HistoryFilters {
  from: string;
  to: string;
  department?: string;
  batch?: string;
  internId?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

function historyWhere(f: HistoryFilters) {
  const p: unknown[] = [f.from, f.to];
  let w = "a.attendance_date BETWEEN $1 AND $2";
  if (f.department) { p.push(f.department); w += ` AND i.department = $${p.length}`; }
  if (f.batch) { p.push(f.batch); w += ` AND i.batch = $${p.length}`; }
  if (f.internId) { p.push(f.internId); w += ` AND i.id = $${p.length}`; }
  if (f.q?.trim()) {
    p.push(`%${f.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    w += ` AND (i.full_name ILIKE $${p.length} OR i.hsim_id ILIKE $${p.length})`;
  }
  return { w, p };
}

export interface HistoryRow {
  id: number;
  attendance_date: string;
  intern_id: number;
  hsim_id: string;
  full_name: string;
  department: string;
  status: string;
  notes: string | null;
}

export async function attendanceHistory(f: HistoryFilters): Promise<{ rows: HistoryRow[]; total: number }> {
  const { w, p } = historyWhere(f);
  const pageSize = f.pageSize ?? 50;
  const offset = ((f.page ?? 1) - 1) * pageSize;
  const base = `FROM attendance a JOIN interns i ON i.id = a.intern_id WHERE ${w}`;
  const [rows, c] = await Promise.all([
    query<HistoryRow>(
      `SELECT a.id, a.attendance_date, i.id AS intern_id, i.hsim_id, i.full_name, i.department, a.status, a.notes
       ${base} ORDER BY a.attendance_date DESC, i.hsim_id LIMIT ${pageSize} OFFSET ${offset}`,
      p,
    ),
    query<{ n: number }>(`SELECT count(*) AS n ${base}`, p),
  ]);
  return { rows, total: c[0]?.n ?? 0 };
}

export async function attendanceHistoryAll(f: HistoryFilters): Promise<HistoryRow[]> {
  const { w, p } = historyWhere(f);
  return query<HistoryRow>(
    `SELECT a.id, a.attendance_date, i.id AS intern_id, i.hsim_id, i.full_name, i.department, a.status, a.notes
       FROM attendance a JOIN interns i ON i.id = a.intern_id WHERE ${w}
      ORDER BY a.attendance_date, i.hsim_id`,
    p,
  );
}

export interface SummaryRow extends AttendanceCounts {
  intern_id: number;
  hsim_id: string;
  full_name: string;
  department: string;
  batch: string;
  intern_status: string;
  percent: number | null;
}

/** Per-intern attendance counts over a date range. Interns with no records in range are included with zeros. */
export async function attendanceSummary(f: Omit<HistoryFilters, "q" | "page" | "pageSize"> & { activeOnly?: boolean }): Promise<SummaryRow[]> {
  const p: unknown[] = [f.from, f.to];
  let w = "TRUE";
  if (f.department) { p.push(f.department); w += ` AND i.department = $${p.length}`; }
  if (f.batch) { p.push(f.batch); w += ` AND i.batch = $${p.length}`; }
  if (f.internId) { p.push(f.internId); w += ` AND i.id = $${p.length}`; }
  if (f.activeOnly) w += ` AND i.status = 'Active'`;
  const rows = await query<Omit<SummaryRow, "percent">>(
    `SELECT i.id AS intern_id, i.hsim_id, i.full_name, i.department, i.batch, i.status AS intern_status,
            count(a.*) FILTER (WHERE a.status = 'Present')  AS present,
            count(a.*) FILTER (WHERE a.status = 'Absent')   AS absent,
            count(a.*) FILTER (WHERE a.status = 'Leave')    AS leave,
            count(a.*) FILTER (WHERE a.status = 'Half Day') AS half
       FROM interns i
       LEFT JOIN attendance a ON a.intern_id = i.id AND a.attendance_date BETWEEN $1 AND $2
      WHERE ${w}
      GROUP BY i.id ORDER BY i.hsim_id`,
    p,
  );
  return rows.map((r) => ({ ...r, percent: attendancePercent(r) }));
}
