"use client";
import { useState } from "react";
import { updateAttendanceRecord } from "@/actions/attendance";
import { ATTENDANCE_STATUSES } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import type { HistoryRow } from "@/lib/queries/attendance";
import { FormActions, SelectField, TextField } from "./fields";
import { Modal } from "./Modal";
import { useUi } from "./Providers";
import { AttendanceBadge, Badge, Button } from "./ui";
import { formToObject, useRun } from "./useRun";

export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const [editing, setEditing] = useState<HistoryRow | null>(null);
  const { run, pending } = useRun();
  const ui = useUi();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const d = formToObject(e.currentTarget);
    const ok = await ui.confirm({
      title: "Modify historical attendance?",
      message: `This changes the saved record for ${editing.full_name} on ${formatDate(editing.attendance_date)}.`,
      confirmLabel: "Save change",
    });
    if (ok) await run(() => updateAttendanceRecord(editing.id, d.status, d.notes ?? ""), () => setEditing(null));
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Date</th><th>HSIM ID</th><th>Intern</th><th>Department</th><th>Status</th><th>Notes</th><th><span className="sr-only">Edit</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{formatDate(r.attendance_date)}</td>
                <td className="font-mono text-xs">{r.hsim_id}</td>
                <td>{r.full_name}</td>
                <td><Badge>{r.department}</Badge></td>
                <td><AttendanceBadge status={r.status} /></td>
                <td className="max-w-xs truncate text-slate-600">{r.notes}</td>
                <td className="text-right"><Button variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit record for ${r.full_name} on ${formatDate(r.attendance_date)}`}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit attendance record">
        {editing && (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-slate-600">{editing.full_name} · {formatDate(editing.attendance_date)}</p>
            <SelectField name="status" label="Status" options={ATTENDANCE_STATUSES} defaultValue={editing.status} />
            <TextField name="notes" label="Notes" defaultValue={editing.notes ?? ""} maxLength={300} />
            <FormActions><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={pending}>Save</Button></FormActions>
          </form>
        )}
      </Modal>
    </>
  );
}
