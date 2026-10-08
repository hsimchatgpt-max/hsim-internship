import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { DateFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/Filters";
import { HistoryTable } from "@/components/HistoryTable";
import { EmptyState, LinkButton, PageHeader, Pagination } from "@/components/ui";
import { ATTENDANCE_RULE_TEXT } from "@/lib/attendance-stats";
import { DEPARTMENTS } from "@/lib/constants";
import { monthStart, todayISO } from "@/lib/dates";
import { dateParam, href, oneOf, pageParam, str, type SearchParams } from "@/lib/params";
import { attendanceHistory, attendanceSummary } from "@/lib/queries/attendance";
import { listBatches } from "@/lib/queries/interns";

export const metadata: Metadata = { title: "Attendance history" };
const PAGE_SIZE = 50;

export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const today = todayISO();
  const f = {
    from: dateParam(sp.from, monthStart(today)), to: dateParam(sp.to, today),
    department: oneOf(sp.department, DEPARTMENTS), batch: str(sp.batch), q: str(sp.q), page: pageParam(sp.page), pageSize: PAGE_SIZE,
  };
  const view = str(sp.view) === "summary" ? "summary" : "records";
  const keep = { from: f.from, to: f.to, department: f.department, batch: f.batch, q: f.q };
  const batches = await listBatches();

  return (
    <>
      <PageHeader title="Attendance history" subtitle="Browse, search and correct past attendance."
        actions={<><LinkButton variant="secondary" prefetch={false} href={href("/api/export/attendance", keep)}>Export CSV</LinkButton><LinkButton variant="secondary" href="/attendance">Back to today</LinkButton></>} />
      <FilterBar>
        <SearchFilter placeholder="Search intern or HSIM ID" />
        <DateFilter param="from" label="From" />
        <DateFilter param="to" label="To" />
        <SelectFilter param="department" label="All departments" options={DEPARTMENTS} />
        <SelectFilter param="batch" label="All batches" options={batches} />
      </FilterBar>

      <div className="mb-3 inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
        {(["records", "summary"] as const).map((v) => (
          <Link key={v} href={href("/attendance/history", { ...keep, view: v === "summary" ? v : undefined })}
            className={clsx("rounded px-3 py-1.5 font-medium", view === v ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-100")}>
            {v === "records" ? "Daily records" : "Summary per intern"}
          </Link>
        ))}
      </div>

      {view === "records" ? <Records f={f} keep={keep} /> : <Summary f={f} />}
    </>
  );
}

async function Records({ f, keep }: { f: Parameters<typeof attendanceHistory>[0]; keep: Record<string, string> }) {
  const { rows, total } = await attendanceHistory(f);
  if (!rows.length) return <EmptyState title="No attendance records found for these filters." hint="Try a wider date range." />;
  return (
    <>
      <HistoryTable rows={rows} />
      <Pagination page={f.page ?? 1} total={total} pageSize={PAGE_SIZE} hrefFor={(p) => href("/attendance/history", { ...keep, page: p })} />
    </>
  );
}

async function Summary({ f }: { f: Parameters<typeof attendanceHistory>[0] }) {
  const q = f.q?.trim().toLowerCase();
  const rows = (await attendanceSummary(f)).filter((r) => !q || `${r.full_name} ${r.hsim_id}`.toLowerCase().includes(q));
  if (!rows.length) return <EmptyState title="No interns found." />;
  return (
    <>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>HSIM ID</th><th>Intern</th><th>Department</th><th>Present</th><th>Absent</th><th>Leave</th><th>Half day</th><th>Attendance %</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.intern_id}><td className="font-mono text-xs">{r.hsim_id}</td><td><Link className="font-medium hover:underline" href={`/interns/${r.intern_id}?tab=attendance`}>{r.full_name}</Link></td><td>{r.department}</td>
            <td>{r.present}</td><td>{r.absent}</td><td>{r.leave}</td><td>{r.half}</td><td className="font-medium">{r.percent === null ? "—" : `${r.percent}%`}</td></tr>
        ))}</tbody></table></div>
      <p className="mt-2 text-xs text-slate-500">{ATTENDANCE_RULE_TEXT}</p>
    </>
  );
}
