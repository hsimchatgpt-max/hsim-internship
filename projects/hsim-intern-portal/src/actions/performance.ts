"use server";
import { fail, guard, guardAdmin, refresh, unexpected, type ActionResult } from "@/lib/action";
import { isForeignKeyViolation, query } from "@/lib/db";
import { overallRating } from "@/lib/rating";
import { reviewSchema } from "@/lib/validation";

const COLS = ["intern_id", "review_date", "work_quality", "learning_progress", "task_completion", "punctuality", "communication", "overall_rating", "feedback"] as const;

export async function createReview(input: unknown): Promise<ActionResult> {
  const g = await guard(reviewSchema, input);
  if ("result" in g) return g.result;
  const d = { ...g.data, overall_rating: overallRating(g.data) };
  try {
    await query(`INSERT INTO performance_reviews (${COLS.join(",")}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(",")})`, COLS.map((c) => d[c]));
    refresh();
    return { ok: true, message: `Review saved. Overall rating ${d.overall_rating}/5.` };
  } catch (e) {
    if (isForeignKeyViolation(e)) return fail("Choose a valid intern.", { intern_id: "Choose a valid intern" });
    return unexpected(e);
  }
}

export async function updateReview(id: number, input: unknown): Promise<ActionResult> {
  const g = await guard(reviewSchema, input);
  if ("result" in g) return g.result;
  const d = { ...g.data, overall_rating: overallRating(g.data) };
  try {
    const rows = await query(
      `UPDATE performance_reviews SET ${COLS.map((c, i) => `${c} = $${i + 1}`).join(", ")}, updated_at = now() WHERE id = $${COLS.length + 1} RETURNING id`,
      [...COLS.map((c) => d[c]), id],
    );
    if (!rows.length) return fail("Review not found.");
    refresh();
    return { ok: true, message: "Review updated." };
  } catch (e) {
    return unexpected(e);
  }
}

export async function deleteReview(id: number): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  try {
    await query("DELETE FROM performance_reviews WHERE id = $1", [id]);
    refresh();
    return { ok: true, message: "Review deleted." };
  } catch (e) {
    return unexpected(e);
  }
}
