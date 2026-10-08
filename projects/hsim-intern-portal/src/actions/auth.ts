"use server";
import { headers } from "next/headers";
import { z } from "zod";
import {
  checkPassword, clearLoginFailures, dummyHash, endSession, loginThrottled, recordLoginFailure, startSession,
} from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { fail, type ActionResult } from "@/lib/action";

const loginSchema = z.object({ email: z.string().trim().min(1, "Enter your email").max(200), password: z.string().min(1, "Enter your password").max(200) });

export async function login(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return fail("Enter your email and password.");
  const { email, password } = parsed.data;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}|${email.toLowerCase()}`;
  if (loginThrottled(key)) return fail("Too many failed attempts. Try again in 15 minutes.");

  const admin = await queryOne<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM admins WHERE lower(email) = lower($1)",
    [email],
  );
  const valid = await checkPassword(password, admin?.password_hash ?? dummyHash());
  if (!admin || !valid) {
    recordLoginFailure(key);
    return fail("Incorrect email or password.");
  }
  clearLoginFailures(key);
  await startSession(admin.id);
  return { ok: true, message: "Signed in." };
}

export async function logout() {
  await endSession();
}
