import "server-only";
import { query } from "./db";

export interface AppSettings {
  instituteName: string;
  attendanceThreshold: number;
  endingSoonDays: number;
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings");
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    instituteName: m.institute_name ?? "HSIM",
    attendanceThreshold: Number(m.attendance_threshold ?? 75),
    endingSoonDays: Number(m.ending_soon_days ?? 7),
  };
}
