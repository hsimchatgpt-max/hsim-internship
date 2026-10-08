"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createTask, deleteTask, setTaskStatus, updateTask } from "@/actions/tasks";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { formatDate, todayISO } from "@/lib/dates";
import type { TaskRow } from "@/lib/queries/tasks";
import { FormActions, SelectField, TextAreaField, TextField } from "./fields";
import { Modal } from "./Modal";
import { useUi } from "./Providers";
import { Badge, Button, EmptyState, OverdueBadge } from "./ui";
import { formToObject, useRun } from "./useRun";

interface Opt { id: number; hsim_id: string; full_name: string }

export function TasksManager({ tasks, interns, autoOpen, presetIntern }: { tasks: TaskRow[]; interns: Opt[]; autoOpen: boolean; presetIntern?: number }) {
  const [form, setForm] = useState<{ task?: TaskRow } | null>(autoOpen ? {} : null);
  const router = useRouter();
  const sp = useSearchParams();
  const ui = useUi();
  const { run, pending } = useRun();

  function closeForm() {
    setForm(null);
    if (sp.get("new")) router.replace("/tasks");
  }

  async function remove(t: TaskRow) {
    if (await ui.confirm({ title: "Delete task?", message: `Delete “${t.title}” assigned to ${t.full_name}? This can't be undone.`, confirmLabel: "Delete task", danger: true })) await run(() => deleteTask(t.id));
  }

  return (
    <>
      <div className="mb-3 flex justify-end"><Button onClick={() => setForm({})}>Add task</Button></div>
      {tasks.length === 0 ? <EmptyState title="No tasks found." hint="Add a task to assign work to an intern." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Task</th><th>Intern</th><th>Assigned</th><th>Due</th><th>Priority</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td className="max-w-xs whitespace-normal"><span className="font-medium text-slate-900">{t.title}</span>{t.description && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{t.description}</span>}</td>
                  <td className="whitespace-nowrap">{t.full_name}<div className="text-xs text-slate-500">{t.hsim_id} · {t.department}</div></td>
                  <td className="whitespace-nowrap">{formatDate(t.assigned_date)}</td>
                  <td className="whitespace-nowrap">{formatDate(t.due_date)}</td>
                  <td><Badge>{t.priority}</Badge></td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <select aria-label={`Status for ${t.title}`} className="input w-auto py-1" value={t.status} disabled={pending}
                        onChange={(e) => run(() => setTaskStatus(t.id, e.target.value))}>{TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                      {t.overdue && <OverdueBadge />}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Button variant="ghost" onClick={() => setForm({ task: t })}>Edit</Button>
                    <Button variant="ghost" className="text-red-600" onClick={() => remove(t)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TaskForm open={!!form} task={form?.task} interns={interns} presetIntern={presetIntern} onClose={closeForm} />
    </>
  );
}

function TaskForm({ open, task, interns, presetIntern, onClose }: { open: boolean; task?: TaskRow; interns: Opt[]; presetIntern?: number; onClose: () => void }) {
  const { run, pending } = useRun();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const opts = interns.map((i) => ({ value: i.id, label: `${i.hsim_id} — ${i.full_name}` }));
  // keep the currently assigned intern selectable when editing even if they are no longer Active
  if (task && !interns.some((i) => i.id === task.intern_id)) opts.push({ value: task.intern_id, label: `${task.hsim_id} — ${task.full_name}` });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    const r = await run(() => (task ? updateTask(task.id, d) : createTask(d)), onClose);
    setErrors(r.ok ? {} : r.errors ?? {});
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? "Edit task" : "Add task"} wide>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <TextField name="title" label="Task title" errors={errors} required defaultValue={task?.title} className="sm:col-span-2" />
        <TextAreaField name="description" label="Description" errors={errors} defaultValue={task?.description ?? ""} className="sm:col-span-2" />
        <SelectField name="intern_id" label="Assigned intern" placeholder="Select intern" options={opts} errors={errors} required defaultValue={task?.intern_id ?? presetIntern ?? ""} />
        <SelectField name="priority" label="Priority" options={TASK_PRIORITIES} defaultValue={task?.priority ?? "Medium"} errors={errors} />
        <TextField name="assigned_date" label="Assigned date" type="date" errors={errors} required defaultValue={task?.assigned_date ?? todayISO()} />
        <TextField name="due_date" label="Due date" type="date" errors={errors} required defaultValue={task?.due_date} />
        <SelectField name="status" label="Status" options={TASK_STATUSES} defaultValue={task?.status ?? "Not Started"} errors={errors} />
        <TextAreaField name="trainer_notes" label="Trainer notes" errors={errors} defaultValue={task?.trainer_notes ?? ""} className="sm:col-span-2" />
        <div className="sm:col-span-2"><FormActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save task"}</Button></FormActions></div>
      </form>
    </Modal>
  );
}
