import type { Metadata } from "next";
import { AttendanceSheet } from "@/components/AttendanceSheet";
import { LinkButton, PageHeader } from "@/components/ui";
import { formatDateLong, todayISO } from "@/lib/dates";
import { dateParam, type SearchParams } from "@/lib/params";
import { attendanceSheet } from "@/lib/queries/attendance";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: SearchParams }) {
  const today = todayISO();
  const date = dateParam((await searchParams).date, today);
  const rows = await attendanceSheet(date);
  const saved = rows.filter((r) => r.attendance_id).length;

  return (
    <>
      <PageHeader title={`Attendance — ${formatDateLong(date)}`}
        subtitle={rows.length === 0 ? undefined : saved === 0 ? "Attendance has not been marked for this date." : `${saved} of ${rows.length} marked and saved.`}
        actions={<LinkButton variant="secondary" href="/attendance/history">History &amp; summary</LinkButton>} />
      <AttendanceSheet key={`${date}|${rows.map((r) => `${r.intern_id}:${r.status}:${r.notes}`).join(",")}`} date={date} today={today} rows={rows} />
    </>
  );
}
