"use server";
import { fail, guard, guardAdmin, refresh, unexpected, type ActionResult } from "@/lib/action";
import { INTERN_STATUSES } from "@/lib/constants";
import { isForeignKeyViolation, isUniqueViolation, query, queryOne } from "@/lib/db";
import { internSchema } from "@/lib/validation";
import { z } from "zod";

const COLS = ["hsim_id", "full_name", "phone", "email", "department", "batch", "joining_date", "internship_duration_months", "end_date", "trainer", "status", "notes"] as const;

const DUP_MSG = { hsim_id: "This HSIM ID is already used by another intern." };

export async function createIntern(input: unknown): Promise<ActionResult<{ id: number }>> {
  const g = await guard(internSchema, input);
  if ("result" in g) return g.result;
  const d = g.data;
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO interns (${COLS.join(",")}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
      COLS.map((c) => d[c]),
    );
    refresh();
    return { ok: true, message: `${d.full_name} was added.`, data: { id: row!.id } };
  } catch (e) {
    if (isUniqueViolation(e, "interns_hsim_id_key")) return fail("Duplicate HSIM ID.", DUP_MSG);
    return unexpected(e);
  }
}

export async function updateIntern(id: number, input: unknown): Promise<ActionResult<{ id: number }>> {
  const g = await guard(internSchema, input);
  if ("result" in g) return g.result;
  const d = g.data;
  try {
    const row = await queryOne(
      `UPDATE interns SET ${COLS.map((c, i) => `${c} = $${i + 1}`).join(", ")}, updated_at = now() WHERE id = $${COLS.length + 1} RETURNING id`,
      [...COLS.map((c) => d[c]), id],
    );
    if (!row) return fail("Intern not found.");
    refresh();
    return { ok: true, message: "Intern updated.", data: { id } };
  } catch (e) {
    if (isUniqueViolation(e, "interns_hsim_id_key")) return fail("Duplicate HSIM ID.", DUP_MSG);
    return unexpected(e);
  }
}

export async function setInternStatus(id: number, status: string): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  const parsed = z.enum(INTERN_STATUSES).safeParse(status);
  if (!parsed.success) return fail("Invalid status.");
  try {
    const rows = await query("UPDATE interns SET status = $1, updated_at = now() WHERE id = $2 RETURNING id", [parsed.data, id]);
    if (!rows.length) return fail("Intern not found.");
    refresh();
    return { ok: true, message: `Status changed to ${parsed.data}.` };
  } catch (e) {
    return unexpected(e);
  }
}

/** Hard delete — only possible for interns with no history; otherwise advise marking as Left. */
export async function deleteIntern(id: number): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  try {
    // A certificate row with nothing issued carries no history; remove it with the intern.
    await query("DELETE FROM certificates WHERE intern_id = $1 AND status = 'Pending'", [id]);
    const rows = await query("DELETE FROM interns WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) return fail("Intern not found.");
    refresh();
    return { ok: true, message: "Intern deleted." };
  } catch (e) {
    if (isForeignKeyViolation(e))
      return fail("This intern has attendance, leave, task, review or certificate history, so it can't be deleted. Mark them as Left or Completed instead to keep the records.");
    return unexpected(e);
  }
}
