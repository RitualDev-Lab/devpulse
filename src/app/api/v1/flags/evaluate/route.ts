import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { featureFlags, flagExposures } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { evaluateFlagForUser } from "@/lib/flags/flag-engine";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

/**
 * GET /api/v1/flags/evaluate?apiKey=...&userId=...&key=...
 * High-speed SDK endpoint powering: if (await pulse.flag("new-checkout")) { ... }
 */
export async function GET(req: NextRequest) {
  try {
    const apiKey =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      req.nextUrl.searchParams.get("apiKey") ||
      "";
    const userKey = req.nextUrl.searchParams.get("userId") || "anonymous";
    const singleKey = req.nextUrl.searchParams.get("key");

    if (!apiKey.trim()) {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 401 });
    }

    const project = await verifyTelemetryApiKey(apiKey);
    if (!project) {
      return NextResponse.json({ error: "Invalid apiKey" }, { status: 403 });
    }

    const rows = singleKey
      ? await db
          .select()
          .from(featureFlags)
          .where(and(eq(featureFlags.projectId, project.id), eq(featureFlags.key, singleKey)))
      : await db
          .select()
          .from(featureFlags)
          .where(eq(featureFlags.projectId, project.id));

    const flags: Record<string, boolean> = {};
    const variants: Record<string, string> = {};

    for (const row of rows) {
      const evaluated = evaluateFlagForUser(row, userKey);
      flags[row.key] = evaluated.enabled;
      variants[row.key] = evaluated.variant;
    }

    return NextResponse.json(
      { flags, variants, userId: userKey },
      { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/v1/flags/evaluate error:", err);
    return NextResponse.json({ error: "Flag evaluation failed" }, { status: 500 });
  }
}

/**
 * POST /api/v1/flags/evaluate
 * Tracks A/B test exposure and conversion events from the SDK.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || body.apiKey || "";
    const project = await verifyTelemetryApiKey(String(apiKey));
    if (!project) {
      return NextResponse.json({ error: "Invalid apiKey" }, { status: 403 });
    }

    const flagKey = String(body.flagKey || body.key || "").trim();
    const variant = String(body.variant || "control").trim();
    const userKey = String(body.userId || body.userKey || "anonymous").trim();
    const converted = Boolean(body.converted);

    if (!flagKey) {
      return NextResponse.json({ error: "Missing flagKey" }, { status: 400 });
    }

    await db.insert(flagExposures).values({
      id: `exp_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
      projectId: project.id,
      flagKey,
      variant,
      userKey,
      converted,
    });

    return NextResponse.json(
      { success: true },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("POST /api/v1/flags/evaluate error:", err);
    return NextResponse.json({ error: "Failed to track flag exposure" }, { status: 500 });
  }
}
