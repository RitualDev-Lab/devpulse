import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret } from "@/lib/security/crypto";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  const baseUrl = isLocalEnv
    ? origin
    : forwardedHost
    ? `https://${forwardedHost}`
    : origin;

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      try {
        const synced = await getCurrentUser();
        const providerToken = data?.session?.provider_token;
        if (synced && providerToken) {
          const encryptedToken = await encryptSecret(providerToken);
          await db
            .update(users)
            .set({
              githubAccessToken: encryptedToken,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(users.id, synced.id));
        }
      } catch (e) {
        console.error("User sync error in callback:", e);
      }
      return NextResponse.redirect(`${baseUrl}${next}`);
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${baseUrl}/?error=auth-failed`);
}
