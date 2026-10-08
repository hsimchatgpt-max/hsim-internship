import { z } from "zod";
import { ATTENDANCE_STATUSES, DEPARTMENTS, INTERN_STATUSES, LEAVE_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "./constants";
import { isValidISODate } from "./dates";

const text = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);
const optionalText = (max = 2000) =>
  z.string().trim().max(max, "Too long").optional().transform((v) => (v ? v : null));
export const isoDate = (label: string) =>
  z.string({ error: `${label} is required` }).refine(isValidISODate, `${label} must be a valid date`);
const id = z.coerce.number().int().positive();

export const internSchema = z
  .object({
    hsim_id: text("HSIM ID", 30).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _ only").transform((v) => v.toUpperCase()),
    full_name: text("Full name", 120),
    phone: text("Phone number", 20).refine((v) => /^\+?[0-9][0-9\s-]{6,17}[0-9]$/.test(v), "Enter a valid phone number"),
    email: text("Email", 200).pipe(z.email("Enter a valid email address")),
    department: z.enum(DEPARTMENTS, { error: "Choose a department" }),
    batch: text("Batch", 50),
    joining_date: isoDate("Joining date"),
    internship_duration_months: z.coerce.number({ error: "Duration is required" }).int().min(1, "Minimum 1 month").max(36, "Maximum 36 months"),
    end_date: isoDate("End date"),
    trainer: text("Trainer / mentor", 120),
    status: z.enum(INTERN_STATUSES, { error: "Choose a status" }),
    notes: optionalText(),
  })
  .refine((v) => v.end_date >= v.joining_date, { path: ["end_date"], message: "End date cannot be before the joining date" });
export type InternInput = z.infer<typeof internSchema>;

export const attendanceSaveSchema = z.object({
  date: isoDate("Date"),
  records: z
    .array(z.object({ intern_id: id, status: z.enum(ATTENDANCE_STATUSES), notes: optionalText(300) }))
    .min(1, "Nothing to save")
    .max(1000),
});

export const leaveSchema = z
  .object({
    intern_id: id,
    start_date: isoDate("Start date"),
    end_date: isoDate("End date"),
    reason: text("Reason", 1000),
    status: z.enum(LEAVE_STATUSES).default("Pending"),
  })
  .refine((v) => v.end_date >= v.start_date, { path: ["end_date"], message: "End date cannot be before the start date" });

export const taskSchema = z
  .object({
    intern_id: id,
    title: text("Title", 200),
    description: optionalText(),
    assigned_date: isoDate("Assigned date"),
    due_date: isoDate("Due date"),
    priority: z.enum(TASK_PRIORITIES),
    status: z.enum(TASK_STATUSES),
    trainer_notes: optionalText(),
  })
  .refine((v) => v.due_date >= v.assigned_date, { path: ["due_date"], message: "Due date cannot be before the assigned date" });

const rating = (label: string) =>
  z.coerce.number({ error: `${label} rating is required` }).int().min(1, "Rating is 1–5").max(5, "Rating is 1–5");
export const reviewSchema = z.object({
  intern_id: id,
  review_date: isoDate("Review date"),
  work_quality: rating("Work quality"),
  learning_progress: rating("Learning progress"),
  task_completion: rating("Task completion"),
  punctuality: rating("Punctuality"),
  communication: rating("Communication"),
  feedback: optionalText(),
});

export const certificateIssueSchema = z.object({
  intern_id: id,
  certificate_number: text("Certificate number", 60),
  issue_date: isoDate("Issue date"),
  certificate_url: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), "Link must start with http:// or https://"),
});

export const settingsSchema = z.object({
  institute_name: text("Institute name", 80),
  attendance_threshold: z.coerce.number().min(1, "1–100").max(100, "1–100"),
  ending_soon_days: z.coerce.number().int().min(1, "1–90").max(90, "1–90"),
});

export const profileSchema = z.object({ name: text("Name", 100), email: text("Email", 200).pipe(z.email("Enter a valid email address")) });
export const passwordSchema = z.object({
  current_password: z.string().min(1, "Enter your current password"),
  new_password: z.string().min(10, "Use at least 10 characters").max(200),
});

/** Flattens a zod error into { field: message }. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const k = issue.path.join(".") || "_form";
    out[k] ??= issue.message;
  }
  return out;
}
