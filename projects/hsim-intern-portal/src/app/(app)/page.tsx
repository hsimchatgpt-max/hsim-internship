import { AlertTriangle, Bell, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AttendanceBadge, Badge, Card, EmptyState, LinkButton, PageHeader, StatCard } from "@/components/ui";
import { formatDateLong } from "@/lib/dates";
import { dashboardData } from "@/lib/queries/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { today, settings, stats, todayRows, alerts } = await dashboardData();
  const unmarked = todayRows.filter((r) => !r.status).length;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={formatDateLong(today)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Active interns" value={stats.active} href="/interns?status=Active" />
        <StatCard label="SEO interns" value={stats.seo} href="/interns?status=Active&department=SEO" />
        <StatCard label="Social Media interns" value={stats.social} href="/interns?status=Active&department=Social+Media" />
        <StatCard label="Ending soon" value={stats.ending_soon} hint={`Within ${settings.endingSoonDays} days`} tone={stats.ending_soon ? "warn" : undefined} href="/interns?status=Active" />
        <StatCard label="Present today" value={stats.present + stats.half} hint={stats.half ? `incl. ${stats.half} half day` : undefined} tone="good" href="/attendance" />
        <StatCard label="Absent today" value={stats.absent} tone={stats.absent ? "warn" : undefined} href="/attendance" />
        <StatCard label="On leave today" value={stats.leave} href="/attendance" />
        <StatCard label="Not marked yet" value={unmarked} hint="Today's attendance" tone={unmarked ? "warn" : undefined} href="/attendance" />
      </div>

      <Card className="mt-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/attendance">Mark today&apos;s attendance</LinkButton>
          <LinkButton variant="secondary" href="/interns/new">Add intern</LinkButton>
          <LinkButton variant="secondary" href="/tasks?new=1">Add task</LinkButton>
          <LinkButton variant="secondary" href="/leaves?new=1">Add leave</LinkButton>
          <LinkButton variant="secondary" href="/reports">View reports</LinkButton>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <section className="min-w-0 lg:col-span-3" aria-labelledby="today-h">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="today-h" className="text-base font-semibold text-slate-900">Today&apos;s attendance</h2>
            <Link href="/attendance" className="inline-flex items-center text-sm font-medium text-brand-700 hover:underline">View attendance <ChevronRight size={16} /></Link>
          </div>
          {todayRows.length === 0 ? (
            <EmptyState title="No active interns yet." hint="Add your first intern to get started." action={<LinkButton href="/interns/new">Add intern</LinkButton>} />
          ) : (
            <div className="table-wrap max-h-[28rem] overflow-y-auto">
              <table className="table">
                <thead><tr><th>HSIM ID</th><th>Intern</th><th>Department</th><th>Status</th></tr></thead>
                <tbody>
                  {todayRows.map((r) => (
                    <tr key={r.intern_id}>
                      <td className="font-mono text-xs">{r.hsim_id}</td>
                      <td><Link href={`/interns/${r.intern_id}`} className="font-medium text-slate-900 hover:underline">{r.full_name}</Link></td>
                      <td><Badge>{r.department}</Badge></td>
                      <td><AttendanceBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="min-w-0 lg:col-span-2" aria-labelledby="alerts-h">
          <h2 id="alerts-h" className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900"><Bell size={16} aria-hidden />Alerts &amp; reminders</h2>
          {alerts.length === 0 ? (
            <EmptyState title="Nothing needs attention." hint="Alerts for low attendance, ending internships, overdue tasks and pending certificates appear here." />
          ) : (
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
              {alerts.map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className="flex gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm hover:border-brand-500">
                    <AlertTriangle size={16} aria-hidden className={`mt-0.5 shrink-0 ${a.severity === "high" ? "text-red-600" : a.severity === "medium" ? "text-amber-600" : "text-slate-400"}`} />
                    <span><span className="block font-medium text-slate-900">{a.title}</span><span className="text-slate-500">{a.detail}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
