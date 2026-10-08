import { NextResponse, type NextRequest } from "next/server";
import { getAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { DEPARTMENTS, INTERN_STATUSES } from "@/lib/constants";
import { monthStart, todayISO } from "@/lib/dates";
import { dateParam, intParam, oneOf, str } from "@/lib/params";
import { attendanceHistoryAll, attendanceSummary } from "@/lib/queries/attendance";
import { allInterns } from "@/lib/queries/interns";
import { listReviews } from "@/lib/queries/performance";
import { listTasks } from "@/lib/queries/tasks";

export const dynamic = "force-dynamic";

function csv(name: string, body: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${todayISO()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { type } = await params;
  const q = Object.fromEntries(req.nextUrl.searchParams);
  const today = todayISO();
  const department = oneOf(q.department, DEPARTMENTS);

  switch (type) {
    case "interns": {
      const rows = await allInterns({ q: str(q.q), department, status: oneOf(q.status, INTERN_STATUSES), batch: str(q.batch) });
      return csv("interns", toCsv(
        ["HSIM ID", "Name", "Phone", "Email", "Department", "Batch", "Joining date", "Duration (months)", "End date", "Trainer", "Status", "Notes"],
        rows.map((r) => [r.hsim_id, r.full_name, r.phone, r.email, r.department, r.batch, r.joining_date, r.internship_duration_months, r.end_date, r.trainer, r.status, r.notes]),
      ));
    }
    case "attendance": {
      const f = { from: dateParam(q.from, monthStart(today)), to: dateParam(q.to, today), department, batch: str(q.batch), internId: intParam(q.intern), q: str(q.q) };
      if (q.view === "summary") {
        const needle = f.q.trim().toLowerCase();
        const rows = (await attendanceSummary(f)).filter((r) => !needle || `${r.full_name} ${r.hsim_id}`.toLowerCase().includes(needle));
        return csv("attendance-summary", toCsv(
          ["HSIM ID", "Name", "Department", "Batch", "From", "To", "Present", "Absent", "Leave", "Half day", "Attendance %"],
          rows.map((r) => [r.hsim_id, r.full_name, r.department, r.batch, f.from, f.to, r.present, r.absent, r.leave, r.half, r.percent ?? ""]),
        ));
      }
      const rows = await attendanceHistoryAll(f);
      return csv("attendance", toCsv(["Date", "HSIM ID", "Name", "Department", "Status", "Notes"], rows.map((r) => [r.attendance_date, r.hsim_id, r.full_name, r.department, r.status, r.notes])));
    }
    case "tasks": {
      const rows = await listTasks({ department, internId: intParam(q.intern), from: q.from ? dateParam(q.from, "") || undefined : undefined, to: q.to ? dateParam(q.to, "") || undefined : undefined, status: str(q.status) || undefined, q: str(q.q) }, 10000);
      return csv("tasks", toCsv(
        ["Task", "Description", "HSIM ID", "Intern", "Department", "Assigned", "Due", "Priority", "Status", "Overdue", "Trainer notes"],
        rows.map((t) => [t.title, t.description, t.hsim_id, t.full_name, t.department, t.assigned_date, t.due_date, t.priority, t.status, t.overdue ? "Yes" : "No", t.trainer_notes]),
      ));
    }
    case "performance": {
      const rows = await listReviews({ department, internId: intParam(q.intern), from: dateParam(q.from, "") || undefined, to: dateParam(q.to, "") || undefined, q: str(q.q) }, 10000);
      return csv("performance", toCsv(
        ["Review date", "HSIM ID", "Intern", "Department", "Work quality", "Learning progress", "Task completion", "Punctuality", "Communication", "Overall", "Feedback"],
        rows.map((r) => [r.review_date, r.hsim_id, r.full_name, r.department, r.work_quality, r.learning_progress, r.task_completion, r.punctuality, r.communication, r.overall_rating, r.feedback]),
      ));
    }
    default:
      return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  }
}

