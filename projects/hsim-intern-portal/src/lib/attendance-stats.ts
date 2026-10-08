export type AttendanceStatus = "Present" | "Absent" | "Leave" | "Half Day";

export interface AttendanceCounts {
  present: number;
  absent: number;
  leave: number;
  half: number;
}

/**
 * Attendance % = (Present + 0.5 × Half Day) / (Present + Absent + Half Day) × 100.
 * Approved-leave days are excused, so they are excluded from the denominator.
 * Returns null when there are no applicable days.
 */
export function attendancePercent(c: AttendanceCounts): number | null {
  const applicable = c.present + c.absent + c.half;
  if (applicable === 0) return null;
  return Math.round(((c.present + c.half * 0.5) / applicable) * 1000) / 10;
}

export function markedDays(c: AttendanceCounts): number {
  return c.present + c.absent + c.leave + c.half;
}

export const ATTENDANCE_RULE_TEXT =
  "Attendance % = (Present + ½ × Half Day) ÷ (Present + Absent + Half Day) × 100. Leave days are excused and not counted.";

/** Minimum applicable days before an intern can be flagged for low attendance. */
export const MIN_DAYS_FOR_LOW_ATTENDANCE_ALERT = 5;
