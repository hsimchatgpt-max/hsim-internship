import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Fast gate: unauthenticated requests never reach dashboard pages or exports.
// Server actions and route handlers re-check the session themselves (defence in depth).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const signedIn = !!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value));

  if (pathname === "/login") {
    return signedIn ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (signedIn) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
