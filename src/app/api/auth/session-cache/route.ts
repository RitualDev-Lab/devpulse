import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { SESSION_CACHE_COOKIE } from "@/lib/security/session-cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/session-cache -> populates short-lived HMAC Edge Session Cookie Cache (`dp_user_cache`)
 * DELETE /api/auth/session-cache -> clears `dp_user_cache` immediately on sign-out
 */
export async function POST() {
  const user = await getCurrentUser();
  return NextResponse.json({ authenticated: Boolean(user) });
}

export async function DELETE() {
  const res = NextResponse.json({ cleared: true });
  res.cookies.set(SESSION_CACHE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
