import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { queryOne } from "./db";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./session";

export interface Admin {
  id: number;
  name: string;
  email: string;
}

export const getAdmin = cache(async (): Promise<Admin | null> => {
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) return null;
  return queryOne<Admin>("SELECT id, name, email FROM admins WHERE id = $1", [id]);
});

/** For pages/layouts: redirects to /login when not signed in. */
export async function requireAdminPage(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect("/login");
  return admin;
}

/** For server actions and route handlers: throws when not signed in. */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) throw new Error("Unauthorized");
  return admin;
}

export async function startSession(adminId: number) {
  (await cookies()).set(SESSION_COOKIE, await signSession(adminId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const checkPassword = (p: string, hash: string) => bcrypt.compare(p, hash);

// Compared against when the email is unknown, so unknown emails take as long as wrong passwords.
let dummy: string | undefined;
export const dummyHash = () => (dummy ??= bcrypt.hashSync("not-a-real-password", 12));

// Simple in-memory login throttle: 8 failures per key per 15 minutes.
const attempts = new Map<string, { count: number; reset: number }>();
export function loginThrottled(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.reset > Date.now() && a.count >= 8;
}
export function recordLoginFailure(key: string) {
  const a = attempts.get(key);
  if (!a || a.reset < Date.now()) attempts.set(key, { count: 1, reset: Date.now() + 15 * 60_000 });
  else a.count++;
}
export function clearLoginFailures(key: string) {
  attempts.delete(key);
}
