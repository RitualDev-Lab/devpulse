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
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function detectBrowser(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("electron")) return "electron";
  if (ua.includes("tauri")) return "tauri";
  if (ua.includes("firefox")) return "firefox";
  if (ua.includes("edg")) return "edge";
  if (ua.includes("chrome")) return "chrome";
  if (ua.includes("safari")) return "safari";
  return "other";
}

function detectOs(userAgent: string, explicitOs?: string): string {
  if (explicitOs && explicitOs.trim()) return explicitOs.trim().slice(0, 40);
  const ua = userAgent.toLowerCase();
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os") || ua.includes("darwin")) return "macOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "iOS";
  if (ua.includes("linux")) return "Linux";
  return "Unknown";
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
          eq(projects.id, String(projectIdentifier)),
          eq(projects.slug, String(projectIdentifier)),
          eq(projects.telemetryApiKey, String(projectIdentifier))
        )
      )
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const path = String(body.path || body.screen || "/").slice(0, 255);
    const rawReferrer = String(body.referrer || "direct").slice(0, 255);
    const referrer = rawReferrer.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "direct";
    const device = body.device === "mobile" || body.device === "tablet" ? body.device : "desktop";
    const sourceType = ["web", "app", "desktop", "cli"].includes(String(body.sourceType || body.source_type))
      ? String(body.sourceType || body.source_type)
      : "web";
    const eventName = String(body.eventName || body.event_name || "pageview").slice(0, 64);
    const appVersion = body.appVersion || body.app_version || body.version
      ? String(body.appVersion || body.app_version || body.version).slice(0, 40)
      : null;

    const country = req.headers.get("cf-ipcountry") || "Global";
    const userAgent = req.headers.get("user-agent") || "";
    const browser = detectBrowser(userAgent);
    const os = detectOs(userAgent, body.os);

    const hitId = `pv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    await db.insert(pageviews).values({
      id: hitId,
      projectId: project.id,
      path,
      referrer,
      country,
      device,
      browser,
      sourceType,
      eventName,
      os,
      appVersion,
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
