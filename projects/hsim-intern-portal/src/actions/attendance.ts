"use server";
import { z } from "zod";
import { fail, guard, refresh, unexpected, type ActionResult } from "@/lib/action";
import { ATTENDANCE_STATUSES } from "@/lib/constants";
import { query, transaction } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { attendanceSaveSchema } from "@/lib/validation";

/** Saves a whole day's attendance. Idempotent: re-saving updates rows instead of duplicating them. */
export async function saveAttendance(input: unknown): Promise<ActionResult<{ saved: number }>> {
  const g = await guard(attendanceSaveSchema, input);
  if ("result" in g) return g.result;
  const { date, records } = g.data;
  if (date > todayISO()) return fail("Attendance can't be marked for a future date.");

  // De-duplicate by intern (last one wins) so a bad payload can't violate the unique constraint mid-statement.
  const byIntern = new Map(records.map((r) => [r.intern_id, r]));
  const list = [...byIntern.values()];
  try {
    await transaction(async (c) => {
      const found = await c.query<{ id: number }>("SELECT id FROM interns WHERE id = ANY($1::bigint[])", [list.map((r) => r.intern_id)]);
      if (found.rowCount !== list.length) throw new Error("UNKNOWN_INTERN");
      await c.query(
        `INSERT INTO attendance (intern_id, attendance_date, status, notes)
         SELECT x.intern_id, $1::date, x.status, NULLIF(x.notes, '')
           FROM unnest($2::bigint[], $3::text[], $4::text[]) AS x(intern_id, status, notes)
         ON CONFLICT (intern_id, attendance_date)
         DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, leave_id = NULL, updated_at = now()`,
        [date, list.map((r) => r.intern_id), list.map((r) => r.status), list.map((r) => r.notes ?? "")],
      );
    });
    refresh();
    return { ok: true, message: "Attendance saved successfully.", data: { saved: list.length } };
  } catch (e) {
    if ((e as Error).message === "UNKNOWN_INTERN") return fail("One or more interns no longer exist. Reload and try again.");
    return unexpected(e);
  }
}

const recordSchema = z.object({ status: z.enum(ATTENDANCE_STATUSES), notes: z.string().max(300) });

export async function updateAttendanceRecord(id: number, status: string, notes: string): Promise<ActionResult> {
  const g = await guard(recordSchema, { status, notes });
  if ("result" in g) return g.result;
  try {
    const rows = await query(
      "UPDATE attendance SET status = $1, notes = NULLIF($2, ''), leave_id = NULL, updated_at = now() WHERE id = $3 RETURNING id",
      [g.data.status, g.data.notes.trim(), id],
    );
    if (!rows.length) return fail("Record not found.");
    refresh();
    return { ok: true, message: "Attendance record updated." };
  } catch (e) {
    return unexpected(e);
  }
}
