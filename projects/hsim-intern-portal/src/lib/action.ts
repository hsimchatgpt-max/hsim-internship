import "server-only";
import { revalidatePath } from "next/cache";
import type { ZodType } from "zod";
import { requireAdmin } from "./auth";
import { fieldErrors } from "./validation";

export type ActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; errors?: Record<string, string>; conflicts?: string[] };

export const fail = (message: string, errors?: Record<string, string>): ActionResult<never> => ({ ok: false, message, errors });

/** Authorises the caller and validates input; returns either parsed data or a ready-made failure result. */
export async function guard<S>(schema: ZodType<S>, input: unknown): Promise<{ data: S } | { result: ActionResult<never> }> {
  try {
    await requireAdmin();
  } catch {
    return { result: fail("Your session has expired. Please sign in again.") };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { result: fail("Please fix the highlighted fields.", fieldErrors(parsed.error)) };
  return { data: parsed.data };
}

export async function guardAdmin(): Promise<ActionResult<never> | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return fail("Your session has expired. Please sign in again.");
  }
}

export function refresh() {
  revalidatePath("/", "layout");
}

export function unexpected(e: unknown): ActionResult<never> {
  console.error(e);
  return fail("Something went wrong while saving. Please try again.");
}
