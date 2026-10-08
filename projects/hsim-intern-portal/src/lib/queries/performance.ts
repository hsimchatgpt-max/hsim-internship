import "server-only";
import { query } from "../db";

export interface ReviewRow {
  id: number;
  intern_id: number;
  hsim_id: string;
  full_name: string;
  department: string;
  review_date: string;
  work_quality: number;
  learning_progress: number;
  task_completion: number;
  punctuality: number;
  communication: number;
  overall_rating: number;
  feedback: string | null;
}

export interface ReviewFilters {
  internId?: number;
  department?: string;
  batch?: string;
  from?: string;
  to?: string;
  q?: string;
}

export function listReviews(f: ReviewFilters, limit = 500) {
  const p: unknown[] = [];
  const c: string[] = [];
  if (f.internId) { p.push(f.internId); c.push(`i.id = $${p.length}`); }
  if (f.department) { p.push(f.department); c.push(`i.department = $${p.length}`); }
  if (f.batch) { p.push(f.batch); c.push(`i.batch = $${p.length}`); }
  if (f.from) { p.push(f.from); c.push(`r.review_date >= $${p.length}`); }
  if (f.to) { p.push(f.to); c.push(`r.review_date <= $${p.length}`); }
  if (f.q?.trim()) {
    p.push(`%${f.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    c.push(`(i.full_name ILIKE $${p.length} OR i.hsim_id ILIKE $${p.length})`);
  }
  return query<ReviewRow>(
    `SELECT r.id, r.intern_id, i.hsim_id, i.full_name, i.department, r.review_date, r.work_quality, r.learning_progress,
            r.task_completion, r.punctuality, r.communication, r.overall_rating, r.feedback
       FROM performance_reviews r JOIN interns i ON i.id = r.intern_id
      ${c.length ? "WHERE " + c.join(" AND ") : ""}
      ORDER BY r.review_date DESC, r.id DESC LIMIT ${limit}`,
    p,
  );
}
