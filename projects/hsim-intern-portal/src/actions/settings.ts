"use server";
import { checkPassword, getAdmin, hashPassword, requireAdmin } from "@/lib/auth";
import { fail, guard, refresh, unexpected, type ActionResult } from "@/lib/action";
import { isUniqueViolation, query, queryOne, transaction } from "@/lib/db";
import { passwordSchema, profileSchema, settingsSchema } from "@/lib/validation";

export async function saveSettings(input: unknown): Promise<ActionResult> {
  const g = await guard(settingsSchema, input);
  if ("result" in g) return g.result;
  try {
    await transaction(async (c) => {
      for (const [k, v] of Object.entries(g.data)) {
        await c.query(
          "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
          [k, String(v)],
        );
      }
    });
    refresh();
    return { ok: true, message: "Settings saved." };
  } catch (e) {
    return unexpected(e);
  }
}

export async function saveProfile(input: unknown): Promise<ActionResult> {
  const g = await guard(profileSchema, input);
  if ("result" in g) return g.result;
  try {
    const admin = await requireAdmin();
    await query("UPDATE admins SET name = $1, email = $2, updated_at = now() WHERE id = $3", [g.data.name, g.data.email, admin.id]);
    refresh();
    return { ok: true, message: "Profile updated." };
  } catch (e) {
    if (isUniqueViolation(e)) return fail("That email is already used by another admin.", { email: "Already in use" });
    return unexpected(e);
  }
}

export async function changePassword(input: unknown): Promise<ActionResult> {
  const g = await guard(passwordSchema, input);
  if ("result" in g) return g.result;
  try {
    const admin = await getAdmin();
    if (!admin) return fail("Your session has expired. Please sign in again.");
    const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM admins WHERE id = $1", [admin.id]);
    if (!row || !(await checkPassword(g.data.current_password, row.password_hash)))
      return fail("Current password is incorrect.", { current_password: "Incorrect password" });
    await query("UPDATE admins SET password_hash = $1, updated_at = now() WHERE id = $2", [await hashPassword(g.data.new_password), admin.id]);
    return { ok: true, message: "Password changed." };
  } catch (e) {
    return unexpected(e);
  }
}
