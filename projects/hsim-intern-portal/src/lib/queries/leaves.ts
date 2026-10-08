import "server-only";
import { query } from "../db";

export interface LeaveRow {
  id: number;
  intern_id: number;
  hsim_id: string;
  full_name: string;
  department: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
}

export function listLeaves(f: { status?: string; q?: string; internId?: number }) {
  const p: unknown[] = [];
  const c: string[] = [];
  if (f.status) { p.push(f.status); c.push(`l.status = $${p.length}`); }
  if (f.internId) { p.push(f.internId); c.push(`l.intern_id = $${p.length}`); }
  if (f.q?.trim()) {
    p.push(`%${f.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    c.push(`(i.full_name ILIKE $${p.length} OR i.hsim_id ILIKE $${p.length})`);
  }
  return query<LeaveRow>(
    `SELECT l.id, l.intern_id, i.hsim_id, i.full_name, i.department, l.start_date, l.end_date, l.reason, l.status
       FROM leaves l JOIN interns i ON i.id = l.intern_id
      ${c.length ? "WHERE " + c.join(" AND ") : ""}
      ORDER BY (l.status = 'Pending') DESC, l.start_date DESC LIMIT 500`,
    p,
  );
}
