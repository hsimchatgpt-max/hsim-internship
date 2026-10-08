"use server";
import type { PoolClient } from "pg";
import { z } from "zod";
import { fail, guard, guardAdmin, refresh, unexpected, type ActionResult } from "@/lib/action";
import { LEAVE_STATUSES } from "@/lib/constants";
import { eachDate, formatDate, isSunday } from "@/lib/dates";
import { transaction } from "@/lib/db";
import { leaveSchema } from "@/lib/validation";

interface LeaveRecord { id: number; intern_id: number; start_date: string; end_date: string; status: string }

class Conflict extends Error {
  constructor(public lines: string[]) { super("CONFLICT"); }
}

async function assertNoOverlap(c: PoolClient, internId: number, start: string, end: string, excludeId?: number) {
  const r = await c.query(
    `SELECT 1 FROM leaves WHERE intern_id = $1 AND status <> 'Rejected' AND start_date <= $3 AND end_date >= $2
        AND ($4::bigint IS NULL OR id <> $4) LIMIT 1`,
    [internId, start, end, excludeId ?? null],
  );
  if (r.rowCount) throw new Error("OVERLAP");
}

/** Marks every non-Sunday date of an approved leave as Leave. Throws Conflict if Present/Absent/Half Day rows exist and !force. */
async function applyLeaveToAttendance(c: PoolClient, leave: LeaveRecord, force: boolean) {
  const dates = eachDate(leave.start_date, leave.end_date).filter((d) => !isSunday(d));
  if (!dates.length) return;
  const existing = await c.query<{ attendance_date: string; status: string }>(
    `SELECT attendance_date, status FROM attendance
      WHERE intern_id = $1 AND attendance_date = ANY($2::date[]) AND status <> 'Leave' ORDER BY attendance_date`,
    [leave.intern_id, dates],
  );
  if (existing.rowCount && !force) {
    throw new Conflict(existing.rows.map((r) => `${formatDate(r.attendance_date)} is already marked ${r.status}`));
  }
  await c.query(
    `INSERT INTO attendance (intern_id, attendance_date, status, notes, leave_id)
     SELECT $1, d, 'Leave', 'Approved leave', $3 FROM unnest($2::date[]) AS d
     ON CONFLICT (intern_id, attendance_date)
     DO UPDATE SET status = 'Leave', notes = 'Approved leave', leave_id = EXCLUDED.leave_id, updated_at = now()`,
    [leave.intern_id, dates, leave.id],
  );
}

const revertLeaveAttendance = (c: PoolClient, leaveId: number) =>
  c.query("DELETE FROM attendance WHERE leave_id = $1", [leaveId]);

function mapError(e: unknown): ActionResult<never> {
  if (e instanceof Conflict)
    return { ok: false, message: "This leave conflicts with existing attendance. Confirm to overwrite those days with Leave.", conflicts: e.lines };
  if ((e as Error).message === "OVERLAP") return fail("This intern already has a pending or approved leave overlapping these dates.", { start_date: "Overlaps an existing leave" });
  return unexpected(e);
}

/** Creates a leave. If created as Approved, attendance is updated in the same transaction. */
export async function createLeave(input: unknown, force = false): Promise<ActionResult> {
  const g = await guard(leaveSchema, input);
  if ("result" in g) return g.result;
  const d = g.data;
  try {
    await transaction(async (c) => {
      await assertNoOverlap(c, d.intern_id, d.start_date, d.end_date);
      const r = await c.query<LeaveRecord>(
        "INSERT INTO leaves (intern_id, start_date, end_date, reason, status) VALUES ($1,$2,$3,$4,$5) RETURNING id, intern_id, start_date, end_date, status",
        [d.intern_id, d.start_date, d.end_date, d.reason, d.status === "Rejected" ? "Pending" : d.status],
      );
      if (r.rows[0].status === "Approved") await applyLeaveToAttendance(c, r.rows[0], force);
    });
    refresh();
    return { ok: true, message: d.status === "Approved" ? "Leave approved and attendance updated." : "Leave request added." };
  } catch (e) {
    return mapError(e);
  }
}

export async function updateLeave(id: number, input: unknown): Promise<ActionResult> {
  const g = await guard(leaveSchema, input);
  if ("result" in g) return g.result;
  const d = g.data;
  try {
    await transaction(async (c) => {
      const cur = await c.query<LeaveRecord>("SELECT id, status FROM leaves WHERE id = $1 FOR UPDATE", [id]);
      if (!cur.rowCount) throw new Error("NOT_FOUND");
      if (cur.rows[0].status === "Approved") throw new Error("APPROVED");
      await assertNoOverlap(c, d.intern_id, d.start_date, d.end_date, id);
      await c.query(
        "UPDATE leaves SET intern_id=$1, start_date=$2, end_date=$3, reason=$4, updated_at=now() WHERE id=$5",
        [d.intern_id, d.start_date, d.end_date, d.reason, id],
      );
    });
    refresh();
    return { ok: true, message: "Leave updated." };
  } catch (e) {
    if ((e as Error).message === "NOT_FOUND") return fail("Leave not found.");
    if ((e as Error).message === "APPROVED") return fail("Approved leaves can't be edited. Move it back to Pending first.");
    return mapError(e);
  }
}

export async function setLeaveStatus(id: number, status: string, force = false): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  const parsed = z.enum(LEAVE_STATUSES).safeParse(status);
  if (!parsed.success) return fail("Invalid status.");
  try {
    await transaction(async (c) => {
      const cur = await c.query<LeaveRecord>("SELECT id, intern_id, start_date, end_date, status FROM leaves WHERE id = $1 FOR UPDATE", [id]);
      if (!cur.rowCount) throw new Error("NOT_FOUND");
      const leave = cur.rows[0];
      if (parsed.data === "Approved") {
        await assertNoOverlap(c, leave.intern_id, leave.start_date, leave.end_date, id);
        await applyLeaveToAttendance(c, leave, force);
      } else if (leave.status === "Approved") {
        await revertLeaveAttendance(c, id);
      }
      await c.query("UPDATE leaves SET status = $1, updated_at = now() WHERE id = $2", [parsed.data, id]);
    });
    refresh();
    return { ok: true, message: `Leave ${parsed.data.toLowerCase()}.` };
  } catch (e) {
    if ((e as Error).message === "NOT_FOUND") return fail("Leave not found.");
    return mapError(e);
  }
}

export async function deleteLeave(id: number): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  try {
    await transaction(async (c) => {
      await revertLeaveAttendance(c, id);
      await c.query("DELETE FROM leaves WHERE id = $1", [id]);
    });
    refresh();
    return { ok: true, message: "Leave deleted." };
  } catch (e) {
    return unexpected(e);
  }
}

