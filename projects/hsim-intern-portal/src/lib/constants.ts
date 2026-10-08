export const DEPARTMENTS = ["SEO", "Social Media"] as const;
export const INTERN_STATUSES = ["Active", "Completed", "Left"] as const;
export const ATTENDANCE_STATUSES = ["Present", "Absent", "Leave", "Half Day"] as const;
export const LEAVE_STATUSES = ["Pending", "Approved", "Rejected"] as const;
export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;
export const TASK_STATUSES = ["Not Started", "In Progress", "Completed"] as const;
export const CERT_STATUSES = ["Pending", "Issued"] as const;

export const RATING_FIELDS = [
  ["work_quality", "Work quality"],
  ["learning_progress", "Learning progress"],
  ["task_completion", "Task completion"],
  ["punctuality", "Punctuality"],
  ["communication", "Communication"],
] as const;

export type Department = (typeof DEPARTMENTS)[number];
export type InternStatus = (typeof INTERN_STATUSES)[number];
