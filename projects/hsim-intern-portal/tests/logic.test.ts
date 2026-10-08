import { describe, expect, it } from "vitest";
import { attendancePercent } from "@/lib/attendance-stats";
import { toCsv } from "@/lib/csv";
import { addDays, addMonths, eachDate, isSunday, isValidISODate } from "@/lib/dates";
import { overallRating } from "@/lib/rating";
import { internSchema, leaveSchema, taskSchema } from "@/lib/validation";

describe("attendance percentage", () => {
  it("counts half days as 0.5 and excludes leave from the denominator", () => {
    expect(attendancePercent({ present: 8, absent: 1, half: 2, leave: 5 })).toBe(81.8); // (8+1)/11
  });
  it("is null with no applicable days", () => {
    expect(attendancePercent({ present: 0, absent: 0, half: 0, leave: 3 })).toBeNull();
  });
  it("is 100 for all present", () => expect(attendancePercent({ present: 10, absent: 0, half: 0, leave: 0 })).toBe(100));
});

describe("dates", () => {
  it("validates ISO dates", () => {
    expect(isValidISODate("2026-02-29")).toBe(false);
    expect(isValidISODate("2028-02-29")).toBe(true);
    expect(isValidISODate("26-1-1")).toBe(false);
  });
  it("adds months with day clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("adds days and enumerates ranges", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(eachDate("2026-10-08", "2026-10-10")).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
  });
  it("detects Sundays", () => expect(isSunday("2026-10-11")).toBe(true));
});

describe("performance rating", () => {
  it("averages five ratings to one decimal", () => {
    expect(overallRating({ work_quality: 5, learning_progress: 4, task_completion: 4, punctuality: 3, communication: 4 })).toBe(4);
    expect(overallRating({ work_quality: 5, learning_progress: 5, task_completion: 4, punctuality: 4, communication: 4 })).toBe(4.4);
  });
});

describe("csv", () => {
  it("quotes special characters and neutralises formulas", () => {
    const out = toCsv(["a", "b"], [['x,"y"', "=SUM(A1)"], [null, "-5"]]);
    expect(out).toContain('"x,""y"""');
    expect(out).toContain("'=SUM(A1)");
    expect(out).toContain(",-5"); // plain negative numbers untouched
  });
});

const validIntern = {
  hsim_id: "hsim050", full_name: "A B", phone: "+91 98765 43210", email: "a@b.co", department: "SEO", batch: "A",
  joining_date: "2026-10-01", internship_duration_months: "3", end_date: "2027-01-01", trainer: "T", status: "Active",
};
describe("validation", () => {
  it("accepts a valid intern and normalises HSIM ID", () => {
    const r = internSchema.safeParse(validIntern);
    expect(r.success && r.data.hsim_id).toBe("HSIM050");
  });
  it("rejects bad department, email, phone and date order", () => {
    expect(internSchema.safeParse({ ...validIntern, department: "HR" }).success).toBe(false);
    expect(internSchema.safeParse({ ...validIntern, email: "nope" }).success).toBe(false);
    expect(internSchema.safeParse({ ...validIntern, phone: "abc" }).success).toBe(false);
    expect(internSchema.safeParse({ ...validIntern, end_date: "2026-09-01" }).success).toBe(false);
  });
  it("validates leave and task date ranges", () => {
    expect(leaveSchema.safeParse({ intern_id: 1, start_date: "2026-10-05", end_date: "2026-10-04", reason: "x" }).success).toBe(false);
    expect(taskSchema.safeParse({ intern_id: 1, title: "t", assigned_date: "2026-10-05", due_date: "2026-10-01", priority: "Low", status: "Not Started" }).success).toBe(false);
  });
});
