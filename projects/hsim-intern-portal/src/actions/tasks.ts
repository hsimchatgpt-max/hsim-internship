"use server";
import { z } from "zod";
import { fail, guard, guardAdmin, refresh, unexpected, type ActionResult } from "@/lib/action";
import { TASK_STATUSES } from "@/lib/constants";
import { query, queryOne } from "@/lib/db";
import { taskSchema } from "@/lib/validation";

async function departmentOf(internId: number) {
  return (await queryOne<{ department: string }>("SELECT department FROM interns WHERE id = $1", [internId]))?.department;
}

export async function createTask(input: unknown): Promise<ActionResult> {
  const g = await guard(taskSchema, input);
  if ("result" in g) return g.result;
  const d = g.data;
  try {
    const dept = await departmentOf(d.intern_id);
    if (!dept) return fail("Choose a valid intern.", { intern_id: "Choose a valid intern" });
    await query(
      `INSERT INTO tasks (intern_id, title, description, department, assigned_date, due_date, priority, status, trainer_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [d.intern_id, d.title, d.description, dept, d.assigned_date, d.due_date, d.priority, d.status, d.trainer_notes],
    );
    refresh();
    return { ok: true, message: "Task added." };
  } catch (e) {
    return unexpected(e);
  }
}

export async function updateTask(id: number, input: unknown): Promise<ActionResult> {
  const g = await guard(taskSchema, input);
  if ("result" in g) return g.result;
  const d = g.data;
  try {
    const dept = await departmentOf(d.intern_id);
    if (!dept) return fail("Choose a valid intern.", { intern_id: "Choose a valid intern" });
    const rows = await query(
      `UPDATE tasks SET intern_id=$1, title=$2, description=$3, department=$4, assigned_date=$5, due_date=$6,
              priority=$7, status=$8, trainer_notes=$9, updated_at=now() WHERE id=$10 RETURNING id`,
      [d.intern_id, d.title, d.description, dept, d.assigned_date, d.due_date, d.priority, d.status, d.trainer_notes, id],
    );
    if (!rows.length) return fail("Task not found.");
    refresh();
    return { ok: true, message: "Task updated." };
  } catch (e) {
    return unexpected(e);
  }
}

export async function setTaskStatus(id: number, status: string): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  const parsed = z.enum(TASK_STATUSES).safeParse(status);
  if (!parsed.success) return fail("Invalid status.");
  try {
    const rows = await query("UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2 RETURNING id", [parsed.data, id]);
    if (!rows.length) return fail("Task not found.");
    refresh();
    return { ok: true, message: `Task marked ${parsed.data}.` };
  } catch (e) {
    return unexpected(e);
  }
}

export async function deleteTask(id: number): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  try {
    await query("DELETE FROM tasks WHERE id = $1", [id]);
    refresh();
    return { ok: true, message: "Task deleted." };
  } catch (e) {
    return unexpected(e);
  }
}
