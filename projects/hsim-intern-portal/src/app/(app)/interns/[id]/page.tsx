import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InternActions } from "@/components/InternActions";
import { AttendanceBadge, Badge, Card, EmptyState, LinkButton, OverdueBadge, StatCard } from "@/components/ui";
import { ATTENDANCE_RULE_TEXT, attendancePercent } from "@/lib/attendance-stats";
import { RATING_FIELDS } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { href, str, type SearchParams } from "@/lib/params";
import { attendanceHistory, attendanceSummary } from "@/lib/queries/attendance";
import { getCertificateFor } from "@/lib/queries/certificates";
import { getIntern } from "@/lib/queries/interns";
import { listLeaves } from "@/lib/queries/leaves";
import { listReviews } from "@/lib/queries/performance";
import { listTasks } from "@/lib/queries/tasks";

export const metadata: Metadata = { title: "Intern profile" };

const TABS = [
  ["overview", "Overview"], ["attendance", "Attendance"], ["leaves", "Leaves"],
  ["tasks", "Tasks"], ["performance", "Performance"], ["certificate", "Certificate"],
] as const;

export default async function InternProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const id = Number((await params).id);
  const intern = Number.isInteger(id) ? await getIntern(id) : null;
  if (!intern) notFound();
  const tabParam = str((await searchParams).tab);
  const tab = TABS.find(([k]) => k === tabParam)?.[0] ?? "overview";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/interns" className="text-sm text-brand-700 hover:underline">← All interns</Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{intern.full_name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="font-mono">{intern.hsim_id}</span><Badge>{intern.department}</Badge><Badge>{intern.status}</Badge>
          </p>
        </div>
        <InternActions id={intern.id} name={intern.full_name} status={intern.status} />
      </div>

      <nav aria-label="Profile sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <Link key={k} href={href(`/interns/${id}`, { tab: k === "overview" ? undefined : k })} aria-current={tab === k ? "page" : undefined}
            className={clsx("whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium", tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <Card>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Phone", intern.phone], ["Email", intern.email], ["Batch", intern.batch], ["Trainer / mentor", intern.trainer],
              ["Joining date", formatDate(intern.joining_date)], ["Duration", `${intern.internship_duration_months} month${intern.internship_duration_months === 1 ? "" : "s"}`],
              ["End date", formatDate(intern.end_date)],
            ].map(([k, v]) => (
              <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 break-words text-slate-900">{v}</dd></div>
            ))}
            <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes</dt><dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{intern.notes || "—"}</dd></div>
          </dl>
        </Card>
      )}

      {tab === "attendance" && <AttendanceTab internId={id} />}
      {tab === "leaves" && <LeavesTab internId={id} />}
      {tab === "tasks" && <TasksTab internId={id} />}
      {tab === "performance" && <PerformanceTab internId={id} />}
      {tab === "certificate" && <CertificateTab internId={id} />}
    </>
  );
}

async function AttendanceTab({ internId }: { internId: number }) {
  const [[s], { rows, total }] = await Promise.all([
    attendanceSummary({ from: "2000-01-01", to: "2999-12-31", internId }),
    attendanceHistory({ from: "2000-01-01", to: "2999-12-31", internId, pageSize: 60 }),
  ]);
  const pct = attendancePercent(s);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Marked days" value={s.present + s.absent + s.leave + s.half} />
        <StatCard label="Present" value={s.present} />
        <StatCard label="Absent" value={s.absent} />
        <StatCard label="Leave" value={s.leave} />
        <StatCard label="Half days" value={s.half} />
        <StatCard label="Attendance" value={pct === null ? "—" : `${pct}%`} tone="good" />
      </div>
      <p className="mt-2 text-xs text-slate-500">{ATTENDANCE_RULE_TEXT}</p>
      <div className="mt-4">
        {rows.length === 0 ? <EmptyState title="No attendance has been marked for this intern yet." /> : (
          <>
            <div className="table-wrap max-h-[28rem] overflow-y-auto">
              <table className="table"><thead><tr><th>Date</th><th>Status</th><th>Notes</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}><td><Link className="hover:underline" href={href("/attendance", { date: r.attendance_date })}>{formatDate(r.attendance_date)}</Link></td><td><AttendanceBadge status={r.status} /></td><td className="text-slate-600">{r.notes ?? ""}</td></tr>
                ))}</tbody></table>
            </div>
            {total > rows.length && <p className="mt-2 text-xs text-slate-500">Showing latest {rows.length} of {total} records. Use Attendance → History for the full list.</p>}
          </>
        )}
      </div>
    </>
  );
}

async function LeavesTab({ internId }: { internId: number }) {
  const leaves = await listLeaves({ internId });
  return leaves.length === 0 ? <EmptyState title="No leave requests for this intern." action={<LinkButton href={href("/leaves", { new: 1, intern: internId })}>Add leave</LinkButton>} /> : (
    <div className="table-wrap"><table className="table"><thead><tr><th>From</th><th>To</th><th>Reason</th><th>Status</th></tr></thead>
      <tbody>{leaves.map((l) => <tr key={l.id}><td>{formatDate(l.start_date)}</td><td>{formatDate(l.end_date)}</td><td className="max-w-xs whitespace-normal">{l.reason}</td><td><Badge>{l.status}</Badge></td></tr>)}</tbody></table></div>
  );
}

async function TasksTab({ internId }: { internId: number }) {
  const tasks = await listTasks({ internId });
  return tasks.length === 0 ? <EmptyState title="No tasks found." action={<LinkButton href={href("/tasks", { new: 1, intern: internId })}>Add task</LinkButton>} /> : (
    <div className="table-wrap"><table className="table"><thead><tr><th>Task</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead>
      <tbody>{tasks.map((t) => <tr key={t.id}><td className="max-w-sm whitespace-normal font-medium">{t.title}</td><td>{formatDate(t.due_date)}</td><td><Badge>{t.priority}</Badge></td><td><span className="flex gap-1.5"><Badge>{t.status}</Badge>{t.overdue && <OverdueBadge />}</span></td></tr>)}</tbody></table></div>
  );
}

async function PerformanceTab({ internId }: { internId: number }) {
  const reviews = await listReviews({ internId });
  return reviews.length === 0 ? <EmptyState title="No performance reviews yet." action={<LinkButton href={href("/performance", { new: 1, intern: internId })}>Add review</LinkButton>} /> : (
    <div className="space-y-3">
      {reviews.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-900">{formatDate(r.review_date)}</p>
            <p className="text-sm">Overall <strong className="text-lg text-brand-700">{r.overall_rating.toFixed(1)}</strong>/5</p>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {RATING_FIELDS.map(([k, label]) => <div key={k}><dt className="text-xs text-slate-500">{label}</dt><dd className="font-medium">{r[k]}/5</dd></div>)}
          </dl>
          {r.feedback && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{r.feedback}</p>}
        </Card>
      ))}
    </div>
  );
}

async function CertificateTab({ internId }: { internId: number }) {
  const c = await getCertificateFor(internId);
  if (!c) return null;
  return (
    <Card>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div><dt className="text-xs font-medium uppercase text-slate-500">Internship</dt><dd className="mt-0.5"><Badge>{c.intern_status}</Badge></dd></div>
        <div><dt className="text-xs font-medium uppercase text-slate-500">Eligible</dt><dd className="mt-0.5">{c.eligibility ? "Yes" : "Not marked"}</dd></div>
        <div><dt className="text-xs font-medium uppercase text-slate-500">Certificate</dt><dd className="mt-0.5"><Badge>{c.status}</Badge></dd></div>
        {c.status === "Issued" && <>
          <div><dt className="text-xs font-medium uppercase text-slate-500">Number</dt><dd className="mt-0.5 font-mono">{c.certificate_number}</dd></div>
          <div><dt className="text-xs font-medium uppercase text-slate-500">Issued on</dt><dd className="mt-0.5">{formatDate(c.issue_date)}</dd></div>
          {c.certificate_url && <div><dt className="text-xs font-medium uppercase text-slate-500">File / link</dt><dd className="mt-0.5"><a className="text-brand-700 underline" href={c.certificate_url} target="_blank" rel="noopener noreferrer">Open</a></dd></div>}
        </>}
      </dl>
      <div className="mt-4"><LinkButton variant="secondary" href={href("/certificates", { q: c.hsim_id })}>Manage certificate</LinkButton></div>
    </Card>
  );
}
