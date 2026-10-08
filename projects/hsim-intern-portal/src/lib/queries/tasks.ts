import "server-only";
import { todayISO } from "../dates";
import { query, queryOne } from "../db";

export interface TaskRow {
  id: number;
  intern_id: number;
  hsim_id: string;
  full_name: string;
  title: string;
  description: string | null;
  department: string;
  assigned_date: string;
  due_date: string;
  priority: "Low" | "Medium" | "High";
  status: "Not Started" | "In Progress" | "Completed";
  trainer_notes: string | null;
  overdue: boolean;
}

export interface TaskFilters {
  q?: string;
  status?: string; // a task status, or "Overdue"
  department?: string;
  priority?: string;
  internId?: number;
  from?: string;
  to?: string; // due date range
}

function where(f: TaskFilters) {
  const p: unknown[] = [todayISO()];
  const c: string[] = [];
  if (f.status === "Overdue") c.push(`(t.status <> 'Completed' AND t.due_date < $1)`);
  else if (f.status) { p.push(f.status); c.push(`t.status = $${p.length}`); }
  if (f.department) { p.push(f.department); c.push(`t.department = $${p.length}`); }
  if (f.priority) { p.push(f.priority); c.push(`t.priority = $${p.length}`); }
  if (f.internId) { p.push(f.internId); c.push(`t.intern_id = $${p.length}`); }
  if (f.from) { p.push(f.from); c.push(`t.due_date >= $${p.length}`); }
  if (f.to) { p.push(f.to); c.push(`t.due_date <= $${p.length}`); }
  if (f.q?.trim()) {
    p.push(`%${f.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    c.push(`(t.title ILIKE $${p.length} OR i.full_name ILIKE $${p.length} OR i.hsim_id ILIKE $${p.length})`);
  }
  return { sql: c.length ? "WHERE " + c.join(" AND ") : "", p };
}

export function listTasks(f: TaskFilters, limit = 500) {
  const { sql, p } = where(f);
  return query<TaskRow>(
    `SELECT t.id, t.intern_id, i.hsim_id, i.full_name, t.title, t.description, t.department, t.assigned_date, t.due_date,
            t.priority, t.status, t.trainer_notes, (t.status <> 'Completed' AND t.due_date < $1) AS overdue
       FROM tasks t JOIN interns i ON i.id = t.intern_id ${sql}
      ORDER BY (t.status = 'Completed'), t.due_date, t.id LIMIT ${limit}`,
    p,
  );
}

export async function taskCounts(f: TaskFilters = {}) {
  const { sql, p } = where(f);
  const r = await queryOne<Record<string, number>>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE t.status = 'Not Started') AS not_started,
            count(*) FILTER (WHERE t.status = 'In Progress') AS in_progress,
            count(*) FILTER (WHERE t.status = 'Completed') AS completed,
            count(*) FILTER (WHERE t.status <> 'Completed' AND t.due_date < $1) AS overdue
       FROM tasks t JOIN interns i ON i.id = t.intern_id ${sql}`,
    p,
  );
  const x = r ?? {};
  return {
    total: x.total ?? 0,
    notStarted: x.not_started ?? 0,
    inProgress: x.in_progress ?? 0,
    completed: x.completed ?? 0,
    overdue: x.overdue ?? 0,
    pending: (x.not_started ?? 0) + (x.in_progress ?? 0),
  };
}
