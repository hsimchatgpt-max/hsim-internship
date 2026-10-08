import "server-only";
import { query, queryOne } from "../db";

export interface CertificateRow {
  intern_id: number;
  hsim_id: string;
  full_name: string;
  department: string;
  intern_status: "Active" | "Completed" | "Left";
  end_date: string;
  eligibility: boolean;
  status: "Pending" | "Issued";
  issue_date: string | null;
  certificate_number: string | null;
  certificate_url: string | null;
  has_record: boolean;
}

const SELECT = `
  SELECT i.id AS intern_id, i.hsim_id, i.full_name, i.department, i.status AS intern_status, i.end_date,
         COALESCE(c.eligibility, false) AS eligibility, COALESCE(c.status, 'Pending') AS status,
         c.issue_date, c.certificate_number, c.certificate_url, (c.id IS NOT NULL) AS has_record
    FROM interns i LEFT JOIN certificates c ON c.intern_id = i.id`;

export function listCertificates(f: { status?: string; internStatus?: string; q?: string }) {
  const p: unknown[] = [];
  const c: string[] = ["i.status <> 'Left'"];
  if (f.internStatus) { p.push(f.internStatus); c.push(`i.status = $${p.length}`); }
  if (f.status) { p.push(f.status); c.push(`COALESCE(c.status, 'Pending') = $${p.length}`); }
  if (f.q?.trim()) {
    p.push(`%${f.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    c.push(`(i.full_name ILIKE $${p.length} OR i.hsim_id ILIKE $${p.length})`);
  }
  return query<CertificateRow>(`${SELECT} WHERE ${c.join(" AND ")} ORDER BY (i.status = 'Completed') DESC, i.hsim_id`, p);
}

export const getCertificateFor = (internId: number) => queryOne<CertificateRow>(`${SELECT} WHERE i.id = $1`, [internId]);
