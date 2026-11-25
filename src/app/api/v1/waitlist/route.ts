import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { waitlistSignups } from "@/db/schema";
import { initDb } from "@/db/setup";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const githubUsername = body?.githubUsername ? String(body.githubUsername).trim().slice(0, 80) : null;
    const repoUrl = body?.repoUrl ? String(body.repoUrl).trim().slice(0, 200) : null;
    const source = String(body?.source || "landing").slice(0, 40);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    await db
      .insert(waitlistSignups)
      .values({
        id: `wl_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        email,
        githubUsername,
        repoUrl,
        source,
      })
      .onConflictDoUpdate({
        target: waitlistSignups.email,
        set: {
          githubUsername,
          repoUrl,
        },
      });

    return NextResponse.json({
      success: true,
      message: "You're on the DevPulse Beta list! Sign in with GitHub anytime for instant free access.",
    });
  } catch (err: unknown) {
    console.error("Waitlist error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to join beta waitlist" },
      { status: 500 }
    );
  }
}
