"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createLeave, deleteLeave, setLeaveStatus, updateLeave } from "@/actions/leaves";
import { formatDate, todayISO } from "@/lib/dates";
import type { LeaveRow } from "@/lib/queries/leaves";
import { FormActions, SelectField, TextAreaField, TextField } from "./fields";
import { Modal } from "./Modal";
import { useUi } from "./Providers";
import { Badge, Button, EmptyState } from "./ui";
import { formToObject, useRun } from "./useRun";

interface Opt { id: number; hsim_id: string; full_name: string }

export function LeavesManager({ leaves, interns, autoOpen, presetIntern }: { leaves: LeaveRow[]; interns: Opt[]; autoOpen: boolean; presetIntern?: number }) {
  const [form, setForm] = useState<{ leave?: LeaveRow } | null>(autoOpen ? {} : null);
  const router = useRouter();
  const sp = useSearchParams();
  const ui = useUi();
  const { run, pending } = useRun();

  function closeForm() {
    setForm(null);
    if (sp.get("new")) router.replace("/leaves");
  }

  async function changeStatus(l: LeaveRow, status: "Approved" | "Rejected" | "Pending") {
    if (status === "Rejected" && !(await ui.confirm({ title: "Reject this leave?", message: `${l.full_name}'s leave request (${formatDate(l.start_date)} – ${formatDate(l.end_date)}) will be rejected.${l.status === "Approved" ? " Leave attendance created by this approval will be removed." : ""}`, confirmLabel: "Reject leave", danger: true }))) return;
    if (status === "Pending" && l.status === "Approved" && !(await ui.confirm({ title: "Move back to Pending?", message: "Leave attendance created by this approval will be removed.", confirmLabel: "Move to Pending" }))) return;
    const r = await run(() => setLeaveStatus(l.id, status));
    if (!r.ok && r.conflicts) {
      const ok = await ui.confirm({
        title: "Attendance conflict",
        message: <><p className="mb-2">These days already have attendance that will be replaced by Leave:</p><ul className="list-disc pl-5">{r.conflicts.map((c) => <li key={c}>{c}</li>)}</ul></>,
        confirmLabel: "Overwrite with Leave", danger: true,
      });
      if (ok) await run(() => setLeaveStatus(l.id, status, true));
    }
  }

  async function remove(l: LeaveRow) {
    if (await ui.confirm({ title: "Delete leave?", message: `Delete ${l.full_name}'s leave request?${l.status === "Approved" ? " Attendance marked Leave by it will be removed." : ""}`, confirmLabel: "Delete", danger: true }))
      await run(() => deleteLeave(l.id));
  }

  return (
    <>
      <div className="mb-3 flex justify-end"><Button onClick={() => setForm({})}>Add leave</Button></div>
      {leaves.length === 0 ? <EmptyState title="No leave requests found." hint="Add a leave to track absences and keep attendance in sync." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>HSIM ID</th><th>Intern</th><th>Department</th><th>From</th><th>To</th><th>Reason</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono text-xs">{l.hsim_id}</td><td className="font-medium">{l.full_name}</td><td><Badge>{l.department}</Badge></td>
                  <td className="whitespace-nowrap">{formatDate(l.start_date)}</td><td className="whitespace-nowrap">{formatDate(l.end_date)}</td>
                  <td className="max-w-xs whitespace-normal text-slate-600">{l.reason}</td><td><Badge>{l.status}</Badge></td>
                  <td className="whitespace-nowrap text-right">
                    {l.status !== "Approved" && <Button variant="ghost" disabled={pending} onClick={() => changeStatus(l, "Approved")}>Approve</Button>}
                    {l.status !== "Rejected" && <Button variant="ghost" disabled={pending} onClick={() => changeStatus(l, "Rejected")}>Reject</Button>}
                    {l.status === "Approved" && <Button variant="ghost" disabled={pending} onClick={() => changeStatus(l, "Pending")}>Undo</Button>}
                    {l.status !== "Approved" && <Button variant="ghost" onClick={() => setForm({ leave: l })}>Edit</Button>}
                    <Button variant="ghost" className="text-red-600" disabled={pending} onClick={() => remove(l)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveForm open={!!form} leave={form?.leave} interns={interns} presetIntern={presetIntern} onClose={closeForm} />
    </>
  );
}

function LeaveForm({ open, leave, interns, presetIntern, onClose }: { open: boolean; leave?: LeaveRow; interns: Opt[]; presetIntern?: number; onClose: () => void }) {
  const { run, pending } = useRun();
  const ui = useUi();
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    let r = await run(() => (leave ? updateLeave(leave.id, d) : createLeave(d)), onClose);
    if (!r.ok && r.conflicts) {
      const ok = await ui.confirm({
        title: "Attendance conflict",
        message: <><p className="mb-2">These days already have attendance that will be replaced by Leave:</p><ul className="list-disc pl-5">{r.conflicts.map((c) => <li key={c}>{c}</li>)}</ul></>,
        confirmLabel: "Overwrite with Leave", danger: true,
      });
      if (ok) r = await run(() => createLeave(d, true), onClose);
    }
    setErrors(r.ok ? {} : r.errors ?? {});
  }

  return (
    <Modal open={open} onClose={onClose} title={leave ? "Edit leave" : "Add leave"}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <SelectField name="intern_id" label="Intern" placeholder="Select intern" errors={errors} required defaultValue={leave?.intern_id ?? presetIntern ?? ""}
          options={interns.map((i) => ({ value: i.id, label: `${i.hsim_id} — ${i.full_name}` }))} />
        <div className="grid grid-cols-2 gap-3">
          <TextField name="start_date" label="Start date" type="date" errors={errors} required defaultValue={leave?.start_date ?? todayISO()} />
          <TextField name="end_date" label="End date" type="date" errors={errors} required defaultValue={leave?.end_date ?? todayISO()} />
        </div>
        <TextAreaField name="reason" label="Reason" errors={errors} required defaultValue={leave?.reason} />
        {!leave && <SelectField name="status" label="Status" options={["Pending", "Approved"]} defaultValue="Pending" errors={errors} />}
        <p className="text-xs text-slate-500">Approving a leave marks the matching dates (excluding Sundays) as Leave in attendance.</p>
        <FormActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></FormActions>
      </form>
    </Modal>
  );
}
