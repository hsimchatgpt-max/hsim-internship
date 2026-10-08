import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "hsim_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(adminId: number): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(String(adminId)).setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`).sign(key());
}

/** Returns the admin id from a session token, or null if invalid/expired. */
export async function verifySession(token: string | undefined): Promise<number | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}
