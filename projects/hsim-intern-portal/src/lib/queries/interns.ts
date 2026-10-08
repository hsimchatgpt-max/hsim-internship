import "server-only";
import { query, queryOne } from "../db";

export interface Intern {
  id: number;
  hsim_id: string;
  full_name: string;
  phone: string;
  email: string;
  department: "SEO" | "Social Media";
  batch: string;
  joining_date: string;
  internship_duration_months: number;
  end_date: string;
  trainer: string;
  status: "Active" | "Completed" | "Left";
  notes: string | null;
}

export interface InternFilters {
  q?: string;
  department?: string;
  batch?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

function where(f: InternFilters) {
  const c: string[] = [];
  const p: unknown[] = [];
  if (f.q?.trim()) {
    p.push(`%${f.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    c.push(`(full_name ILIKE $${p.length} OR hsim_id ILIKE $${p.length} OR email ILIKE $${p.length} OR phone ILIKE $${p.length})`);
  }
  if (f.department) { p.push(f.department); c.push(`department = $${p.length}`); }
  if (f.batch) { p.push(f.batch); c.push(`batch = $${p.length}`); }
  if (f.status) { p.push(f.status); c.push(`status = $${p.length}`); }
  return { sql: c.length ? `WHERE ${c.join(" AND ")}` : "", p };
}

export async function listInterns(f: InternFilters): Promise<{ rows: Intern[]; total: number }> {
  const { sql, p } = where(f);
  const pageSize = f.pageSize ?? 25;
  const offset = ((f.page ?? 1) - 1) * pageSize;
  const [rows, count] = await Promise.all([
    query<Intern>(`SELECT * FROM interns ${sql} ORDER BY hsim_id LIMIT ${pageSize} OFFSET ${offset}`, p),
    queryOne<{ n: number }>(`SELECT count(*) AS n FROM interns ${sql}`, p),
  ]);
  return { rows, total: count?.n ?? 0 };
}

/** All interns matching filters, unpaged (for export). */
export async function allInterns(f: InternFilters): Promise<Intern[]> {
  const { sql, p } = where(f);
  return query<Intern>(`SELECT * FROM interns ${sql} ORDER BY hsim_id`, p);
}

export const getIntern = (id: number) => queryOne<Intern>("SELECT * FROM interns WHERE id = $1", [id]);

export async function internOptions(opts: { activeOnly?: boolean } = {}) {
  return query<Pick<Intern, "id" | "hsim_id" | "full_name" | "department" | "status">>(
    `SELECT id, hsim_id, full_name, department, status FROM interns
     ${opts.activeOnly ? "WHERE status = 'Active'" : ""} ORDER BY hsim_id`,
  );
}

export async function listBatches(): Promise<string[]> {
  return (await query<{ batch: string }>("SELECT DISTINCT batch FROM interns ORDER BY batch")).map((r) => r.batch);
}

export async function listTrainers(): Promise<string[]> {
  return (await query<{ trainer: string }>("SELECT DISTINCT trainer FROM interns ORDER BY trainer")).map((r) => r.trainer);
}

export async function nextHsimId(): Promise<string> {
  const rows = await query<{ hsim_id: string }>("SELECT hsim_id FROM interns WHERE hsim_id ~ '^HSIM[0-9]+$'");
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.hsim_id.slice(4), 10)), 0);
  return `HSIM${String(max + 1).padStart(3, "0")}`;
}
