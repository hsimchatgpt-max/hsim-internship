import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { DateFilter, FilterBar, SelectFilter } from "@/components/Filters";
import { Badge, EmptyState, LinkButton, OverdueBadge, PageHeader, StatCard } from "@/components/ui";
import { ATTENDANCE_RULE_TEXT, attendancePercent } from "@/lib/attendance-stats";
import { DEPARTMENTS } from "@/lib/constants";
import { addDays, formatDate, monthStart, todayISO } from "@/lib/dates";
import { query } from "@/lib/db";
import { dateParam, href, intParam, oneOf, str, type SearchParams } from "@/lib/params";
import { attendanceSummary } from "@/lib/queries/attendance";
import { internOptions, listBatches } from "@/lib/queries/interns";
import { listReviews } from "@/lib/queries/performance";
import { listTasks, taskCounts } from "@/lib/queries/tasks";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Reports" };

const TABS = [["attendance", "Attendance"], ["tasks", "Tasks"], ["performance", "Performance"], ["internship", "Internships"]] as const;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const today = todayISO();
  const tab = TABS.find(([k]) => k === str(sp.tab))?.[0] ?? "attendance";
  const f = {
    from: dateParam(sp.from, monthStart(today)), to: dateParam(sp.to, today),
    department: oneOf(sp.department, DEPARTMENTS), batch: str(sp.batch), internId: intParam(sp.intern),
  };
  const [batches, interns] = await Promise.all([listBatches(), internOptions()]);

  return (
    <>
      <PageHeader title="Reports" subtitle="Filters apply to the report below and to its CSV export." />
      <nav aria-label="Reports" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <Link key={k} href={href("/reports", { ...f, internId: undefined, intern: f.internId, tab: k === "attendance" ? undefined : k })} aria-current={tab === k ? "page" : undefined}
            className={clsx("whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium", tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800")}>{label}</Link>
        ))}
      </nav>

      <FilterBar>
        {tab !== "internship" && <><DateFilter param="from" label={tab === "tasks" ? "Due from" : "From"} /><DateFilter param="to" label={tab === "tasks" ? "Due to" : "To"} /></>}
        <SelectFilter param="department" label="All departments" options={DEPARTMENTS} />
        {tab === "attendance" && <SelectFilter param="batch" label="All batches" options={batches} />}
        {tab !== "internship" && <SelectFilter param="intern" label="All interns" options={interns.map((i) => ({ value: String(i.id), label: `${i.hsim_id} — ${i.full_name}` }))} />}
      </FilterBar>

      {tab === "attendance" && <AttendanceReport f={f} />}
      {tab === "tasks" && <TaskReport f={f} />}
      {tab === "performance" && <PerformanceReport f={f} />}
      {tab === "internship" && <InternshipReport department={f.department} />}
    </>
  );
}

type F = { from: string; to: string; department: "SEO" | "Social Media" | ""; batch: string; internId?: number };

async function AttendanceReport({ f }: { f: F }) {
  const rows = await attendanceSummary(f);
  const exp = (view: string) => href("/api/export/attendance", { from: f.from, to: f.to, department: f.department, batch: f.batch, intern: f.internId, view });
  const t = rows.reduce((a, r) => ({ present: a.present + r.present, absent: a.absent + r.absent, leave: a.leave + r.leave, half: a.half + r.half }), { present: 0, absent: 0, leave: 0, half: 0 });
  return (
    <>
      <div className="mb-3 flex flex-wrap justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Present" value={t.present} /><StatCard label="Absent" value={t.absent} /><StatCard label="Leave" value={t.leave} /><StatCard label="Half days" value={t.half} />
          <StatCard label="Attendance" value={attendancePercent(t) === null ? "—" : `${attendancePercent(t)}%`} tone="good" hint="All selected interns" />
        </div>
      </div>
      <div className="mb-3 flex gap-2">
        <LinkButton variant="secondary" prefetch={false} href={exp("summary")}>Export summary CSV</LinkButton>
        <LinkButton variant="secondary" prefetch={false} href={exp("records")}>Export daily records CSV</LinkButton>
      </div>
      {rows.length === 0 ? <EmptyState title="No interns match these filters." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>HSIM ID</th><th>Intern</th><th>Department</th><th>Batch</th><th>Present</th><th>Absent</th><th>Leave</th><th>Half day</th><th>Attendance %</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.intern_id}><td className="font-mono text-xs">{r.hsim_id}</td><td className="font-medium">{r.full_name}</td><td>{r.department}</td><td>{r.batch}</td>
              <td>{r.present}</td><td>{r.absent}</td><td>{r.leave}</td><td>{r.half}</td><td className="font-medium">{r.percent === null ? "—" : `${r.percent}%`}</td></tr>))}</tbody></table></div>
      )}
      <p className="mt-2 text-xs text-slate-500">{ATTENDANCE_RULE_TEXT}</p>
    </>
  );
}

async function TaskReport({ f }: { f: F }) {
  const filt = { department: f.department, internId: f.internId, from: f.from, to: f.to };
  const [counts, tasks] = await Promise.all([taskCounts(filt), listTasks(filt)]);
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total" value={counts.total} /><StatCard label="Completed" value={counts.completed} tone="good" /><StatCard label="Pending" value={counts.notStarted} hint="Not started" />
        <StatCard label="In progress" value={counts.inProgress} /><StatCard label="Overdue" value={counts.overdue} tone={counts.overdue ? "warn" : undefined} />
      </div>
      <div className="mb-3"><LinkButton variant="secondary" prefetch={false} href={href("/api/export/tasks", { from: f.from, to: f.to, department: f.department, intern: f.internId })}>Export CSV</LinkButton></div>
      {tasks.length === 0 ? <EmptyState title="No tasks found." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Task</th><th>Intern</th><th>Department</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>{tasks.map((t) => <tr key={t.id}><td className="max-w-xs whitespace-normal font-medium">{t.title}</td><td>{t.full_name} <span className="text-xs text-slate-500">{t.hsim_id}</span></td><td>{t.department}</td><td>{formatDate(t.due_date)}</td><td><Badge>{t.priority}</Badge></td><td><span className="flex gap-1.5"><Badge>{t.status}</Badge>{t.overdue && <OverdueBadge />}</span></td></tr>)}</tbody></table></div>
      )}
    </>
  );
}

async function PerformanceReport({ f }: { f: F }) {
  const filt = { department: f.department, internId: f.internId, from: f.from, to: f.to };
  const reviews = await listReviews(filt);
  return (
    <>
      <div className="mb-3"><LinkButton variant="secondary" prefetch={false} href={href("/api/export/performance", { from: f.from, to: f.to, department: f.department, intern: f.internId })}>Export CSV</LinkButton></div>
      {reviews.length === 0 ? <EmptyState title="No performance reviews found for these filters." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Intern</th><th>Department</th><th>Review date</th><th>Overall</th><th>Feedback</th></tr></thead>
          <tbody>{reviews.map((r) => <tr key={r.id}><td>{r.full_name} <span className="text-xs text-slate-500">{r.hsim_id}</span></td><td>{r.department}</td><td>{formatDate(r.review_date)}</td><td className="font-semibold text-brand-700">{r.overall_rating.toFixed(1)}/5</td><td className="max-w-md whitespace-normal text-slate-600">{r.feedback}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}

async function InternshipReport({ department }: { department: string }) {
  const settings = await getSettings();
  const today = todayISO();
  const soon = addDays(today, settings.endingSoonDays);
  const p: unknown[] = [today, soon];
  const dept = department ? (p.push(department), `AND department = $${p.length}`) : "";
  const [counts] = await query<{ active: number; completed: number; left: number; ending: number }>(
    `SELECT count(*) FILTER (WHERE status='Active') AS active, count(*) FILTER (WHERE status='Completed') AS completed,
            count(*) FILTER (WHERE status='Left') AS left, count(*) FILTER (WHERE status='Active' AND end_date BETWEEN $1 AND $2) AS ending
       FROM interns WHERE TRUE ${dept}`, p);
  const ending = await query<{ id: number; hsim_id: string; full_name: string; department: string; end_date: string }>(
    `SELECT id, hsim_id, full_name, department, end_date FROM interns WHERE status='Active' AND end_date <= $2 ${dept} ORDER BY end_date`, p);
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Active" value={counts.active} /><StatCard label="Completed" value={counts.completed} /><StatCard label="Left" value={counts.left} />
        <StatCard label="Ending soon" value={counts.ending} hint={`Within ${settings.endingSoonDays} days`} tone={counts.ending ? "warn" : undefined} />
      </div>
      <div className="mb-3"><LinkButton variant="secondary" prefetch={false} href={href("/api/export/interns", { department })}>Export intern list CSV</LinkButton></div>
      <h2 className="mb-2 text-base font-semibold">Ending soon or past end date</h2>
      {ending.length === 0 ? <EmptyState title="No active internships are ending soon." /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>HSIM ID</th><th>Intern</th><th>Department</th><th>End date</th><th></th></tr></thead>
          <tbody>{ending.map((e) => <tr key={e.id}><td className="font-mono text-xs">{e.hsim_id}</td><td><Link className="font-medium hover:underline" href={`/interns/${e.id}`}>{e.full_name}</Link></td><td>{e.department}</td><td>{formatDate(e.end_date)}</td><td>{e.end_date < today ? <Badge tone="Overdue">Period ended</Badge> : <Badge tone="Pending">Ending soon</Badge>}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
