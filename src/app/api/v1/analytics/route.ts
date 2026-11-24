import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, pageviews } from "@/db/schema";
import { eq, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function detectBrowser(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("firefox")) return "firefox";
  if (ua.includes("edg")) return "edge";
  if (ua.includes("chrome")) return "chrome";
  if (ua.includes("safari")) return "safari";
  return "other";
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const projectIdentifier = body.project || body.projectId || body.apiKey;
    if (!projectIdentifier) {
      return NextResponse.json({ error: "Missing project identifier" }, { status: 400 });
    }

    // Match project by ID, slug, or telemetryApiKey
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        or(
          eq(projects.id, projectIdentifier),
          eq(projects.slug, projectIdentifier),
          eq(projects.telemetryApiKey, projectIdentifier)
        )
      )
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const path = String(body.path || "/").slice(0, 255);
    const rawReferrer = String(body.referrer || "direct").slice(0, 255);
    const referrer = rawReferrer.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "direct";
    const device = body.device === "mobile" || body.device === "tablet" ? body.device : "desktop";

    // Cloudflare Edge automatically provides the 2-letter country code via cf-ipcountry header
    const country = req.headers.get("cf-ipcountry") || "Global";
    const userAgent = req.headers.get("user-agent") || "";
    const browser = detectBrowser(userAgent);

    const hitId = `pv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    await db.insert(pageviews).values({
      id: hitId,
      projectId: project.id,
      path,
      referrer,
      country,
      device,
      browser,
    });

    return NextResponse.json(
      { success: true, hitId },
      {
        status: 201,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: any) {
    console.error("Analytics ingest error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
