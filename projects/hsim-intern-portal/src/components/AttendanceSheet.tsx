"use client";
import clsx from "clsx";
import { CalendarOff, Check, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { saveAttendance } from "@/actions/attendance";
import { addDays, formatDateLong } from "@/lib/dates";
import type { SheetRow } from "@/lib/queries/attendance";
import { useUi } from "./Providers";
import { Badge, Button, EmptyState } from "./ui";
import { useRun } from "./useRun";

const OPTIONS = [
  { value: "Present", icon: Check, on: "bg-emerald-600 text-white border-emerald-600" },
  { value: "Absent", icon: X, on: "bg-red-600 text-white border-red-600" },
  { value: "Leave", icon: CalendarOff, on: "bg-sky-600 text-white border-sky-600" },
  { value: "Half Day", icon: Clock, on: "bg-amber-500 text-white border-amber-500" },
] as const;

interface Entry { status: string; notes: string }

export function AttendanceSheet({ date, today, rows }: { date: string; today: string; rows: SheetRow[] }) {
  const router = useRouter();
  const ui = useUi();
  const { run, pending } = useRun();
  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.intern_id, { status: r.status ?? "", notes: r.notes ?? "" }])) as Record<number, Entry>, [rows]);
  const [state, setState] = useState<Record<number, Entry>>(initial);
  const [filter, setFilter] = useState("");

  const isFuture = date > today;
  const dirty = rows.some((r) => state[r.intern_id].status !== initial[r.intern_id].status || state[r.intern_id].notes !== initial[r.intern_id].notes);
  const counts = { Present: 0, Absent: 0, Leave: 0, "Half Day": 0, unmarked: 0 } as Record<string, number>;
  rows.forEach((r) => { counts[state[r.intern_id].status || "unmarked"]++; });
  const visible = rows.filter((r) => !filter.trim() || `${r.full_name} ${r.hsim_id}`.toLowerCase().includes(filter.trim().toLowerCase()));

  const set = (id: number, patch: Partial<Entry>) => setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  async function goTo(d: string) {
    if (dirty && !(await ui.confirm({ title: "Discard unsaved changes?", message: "You have attendance changes that haven't been saved.", confirmLabel: "Discard and continue", danger: true }))) return;
    router.push(`/attendance?date=${d}`);
  }

  function markAllPresent() {
    setState((s) => {
      const next = { ...s };
      for (const r of rows) if (!r.from_leave) next[r.intern_id] = { ...next[r.intern_id], status: "Present" };
      return next;
    });
    const skipped = rows.filter((r) => r.from_leave).length;
    ui.success(`All marked Present${skipped ? ` (${skipped} on approved leave left unchanged)` : ""}. Adjust exceptions, then Save.`);
  }

  async function save() {
    const records = rows.filter((r) => state[r.intern_id].status).map((r) => ({ intern_id: r.intern_id, status: state[r.intern_id].status, notes: state[r.intern_id].notes }));
    if (!records.length) return ui.error("Mark at least one intern before saving.");
    const changedExisting = rows.filter((r) => r.attendance_id && (state[r.intern_id].status !== initial[r.intern_id].status || state[r.intern_id].notes !== initial[r.intern_id].notes)).length;
    if (changedExisting && !(await ui.confirm({
      title: "Change saved attendance?",
      message: `Attendance for ${changedExisting} intern${changedExisting === 1 ? "" : "s"} on ${formatDateLong(date)} was already saved. Saving will overwrite it.`,
      confirmLabel: "Save changes",
    }))) return;
    await run(() => saveAttendance({ date, records }));
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => goTo(addDays(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></Button>
        <input type="date" aria-label="Attendance date" value={date} max={today} onChange={(e) => e.target.value && goTo(e.target.value)} className="input w-auto" />
        <Button variant="secondary" onClick={() => goTo(addDays(date, 1))} disabled={date >= today} aria-label="Next day"><ChevronRight size={16} /></Button>
        {date !== today && <Button variant="ghost" onClick={() => goTo(today)}>Today</Button>}
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find intern…" aria-label="Find intern" className="input ml-auto w-full sm:w-52" />
      </div>

      {isFuture && <p role="alert" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Attendance can&apos;t be marked for a future date.</p>}

      {rows.length === 0 ? (
        <EmptyState title="No active interns for this date." hint="Add interns or change the date." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <Button onClick={markAllPresent} disabled={isFuture || pending}><Check size={16} aria-hidden />Mark All Present</Button>
            <span><strong>{counts.Present}</strong> Present</span>
            <span><strong>{counts.Absent}</strong> Absent</span>
            <span><strong>{counts.Leave}</strong> Leave</span>
            <span><strong>{counts["Half Day"]}</strong> Half Day</span>
            <span className={counts.unmarked ? "font-medium text-amber-700" : "text-slate-500"}><strong>{counts.unmarked}</strong> Not marked</span>
            <Button className="ml-auto" onClick={save} disabled={isFuture || pending || (!dirty && counts.unmarked === rows.length)}>
              {pending ? "Saving…" : "Save Attendance"}
            </Button>
          </div>
          {!dirty && rows.some((r) => r.attendance_id) && <p className="mb-3 text-xs text-slate-500">Showing saved attendance for this date. Change a status to edit it.</p>}

          <div className="md:rounded-lg md:border md:border-slate-200 md:bg-white">
            <table className="w-full text-left text-sm">
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">HSIM ID</th><th className="px-3 py-2.5">Intern</th><th className="px-3 py-2.5">Department</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {visible.map((r) => {
                  const e = state[r.intern_id];
                  return (
                    <tr key={r.intern_id} className="mb-2 block rounded-lg border border-slate-200 bg-white p-3 md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:p-0">
                      <td className="block font-mono text-xs text-slate-500 md:table-cell md:px-3 md:py-2">{r.hsim_id}</td>
                      <td className="block md:table-cell md:px-3 md:py-2">
                        <Link href={`/interns/${r.intern_id}`} className="font-medium text-slate-900 hover:underline">{r.full_name}</Link>
                        {r.intern_status !== "Active" && <span className="ml-2"><Badge>{r.intern_status}</Badge></span>}
                      </td>
                      <td className="hidden md:table-cell md:px-3 md:py-2"><Badge>{r.department}</Badge></td>
                      <td className="block py-2 md:table-cell md:px-3 md:py-2">
                        <div role="group" aria-label={`Status for ${r.full_name}`} className="grid grid-cols-4 gap-1 md:inline-flex">
                          {OPTIONS.map(({ value, icon: Icon, on }) => (
                            <button key={value} type="button" aria-pressed={e.status === value} disabled={isFuture}
                              onClick={() => set(r.intern_id, { status: value })}
                              className={clsx("inline-flex min-h-10 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium md:min-h-9 md:text-sm",
                                e.status === value ? on : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")}>
                              <Icon size={13} aria-hidden /><span>{value}</span>
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="block md:table-cell md:px-3 md:py-2">
                        <input type="text" value={e.notes} maxLength={300} onChange={(ev) => set(r.intern_id, { notes: ev.target.value })}
                          placeholder="Note (optional)" aria-label={`Note for ${r.full_name}`} className="input py-1.5" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length === 0 && <p className="p-4 text-sm text-slate-500">No interns match “{filter}”.</p>}
          </div>
        </>
      )}
    </>
  );
}
