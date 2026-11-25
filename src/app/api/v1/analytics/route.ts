import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, pageviews, dailyMetrics, metricsHourly } from "@/db/schema";
import { eq, or, sql } from "drizzle-orm";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { scrubTelemetryText, scrubTelemetryValue } from "@/lib/security/ingest-scrub";

export const dynamic = "force-dynamic";

const BOT_UA_REGEX =
  /\b(bot|crawler|spider|slurp|headlesschrome|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|bingpreview|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|bytespider|gptbot|claudebot|anthropic-ai|ccbot|semrush|ahrefs|mj12bot|dotbot|petalbot|yandex)\b|^(curl|wget|python-requests|python-urllib|go-http-client|node-fetch|undici|axios)\b/i;

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
    const ip = getClientIp(req.headers);
    const userAgent = req.headers.get("user-agent") || "";

    // 1. Per-IP Rate Limit (120 beacons/min) to stop spam/flood abuse
    const rl = await checkRateLimit({
      key: `analytics:${ip}`,
      limit: 120,
      windowSeconds: 60,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Analytics rate limit exceeded", retryAfterSeconds: rl.retryAfterSeconds },
        {
          status: 429,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Retry-After": String(rl.retryAfterSeconds),
          },
        }
      );
    }

    let body: any = {};
    try {
      const rawText = await req.text();
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const sourceType = ["web", "app", "desktop", "cli"].includes(String(body.sourceType || body.source_type))
      ? String(body.sourceType || body.source_type)
      : "web";

    // 2. Drop automated bots/crawlers on web beacons cleanly (still allow explicit CLI/app beacons)
    if (sourceType === "web" && userAgent && BOT_UA_REGEX.test(userAgent)) {
      return NextResponse.json(
        { success: true, accepted: false, filtered: "bot" },
        { status: 202, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Prefer dedicated frontend read-only `writeKey` (`dp_pub_*`), with slug/id/legacy apiKey compat
    const projectIdentifier =
      body.writeKey || body.publicWriteKey || body.project || body.projectId || body.apiKey;
    if (!projectIdentifier) {
      return NextResponse.json({ error: "Missing writeKey or project identifier" }, { status: 400 });
    }

    const idStr = String(projectIdentifier).trim();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        or(
          eq(projects.publicWriteKey, idStr),
          eq(projects.id, idStr),
          eq(projects.slug, idStr),
          eq(projects.telemetryApiKey, idStr)
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
    const eventName = String(body.eventName || body.event_name || "pageview").slice(0, 64);
    const appVersion =
      body.appVersion || body.app_version || body.version
        ? String(body.appVersion || body.app_version || body.version).slice(0, 40)
        : null;

    const country = req.headers.get("cf-ipcountry") || "Global";
    const browser = detectBrowser(userAgent);
    const os = detectOs(userAgent, body.os);

    const hitId = `pv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const rawMetricName = body.metricName || body.metric_name;
    const rawMetricValue = body.metricValue ?? body.metric_value;
    const hasCustomMetric =
      typeof rawMetricName === "string" &&
      rawMetricName.trim().length > 0 &&
      typeof rawMetricValue === "number" &&
      Number.isFinite(rawMetricValue);

    const finalEventName = hasCustomMetric
      ? `metric:${rawMetricName.trim().slice(0, 56)}`
      : eventName;
    const finalPath = hasCustomMetric ? String(rawMetricValue) : path;
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.slice(0, 10);
    const hourBucket = nowIso.slice(0, 13); // YYYY-MM-DDTHH
    const hourlyId = `mh_${project.id}_${hourBucket}_${sourceType}`;

    await db.batch([
      db.insert(pageviews).values({
        id: hitId,
        projectId: project.id,
        path: scrubTelemetryText(finalPath),
        referrer,
        country,
        device,
        browser,
        sourceType,
        eventName: finalEventName,
        os,
        appVersion,
      }),
      db
        .insert(metricsHourly)
        .values({
          id: hourlyId,
          projectId: project.id,
          hourBucket,
          sourceType,
          hits: 1,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: metricsHourly.id,
          set: {
            hits: sql`${metricsHourly.hits} + 1`,
            updatedAt: nowIso,
          },
        }),
    ]);

    if (hasCustomMetric) {
      const metricId = `dm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.insert(dailyMetrics).values({
        id: metricId,
        projectId: project.id,
        source: "web",
        metricType: "pageviews",
        date: todayStr,
        value: Math.round(rawMetricValue),
        metadataJson: JSON.stringify({
          kind: "custom_metric",
          metricName: rawMetricName.trim().slice(0, 64),
          metricValue: rawMetricValue,
          properties: body.properties || null,
          sourceType,
          os,
        }),
      });
    } else if (finalEventName === "pageview") {
      // Atomic SQL daily rollup counter so daily traffic aggregates without raw row scans
      const rollupId = `met_web_${project.id}_${todayStr}`;
      await db
        .insert(dailyMetrics)
        .values({
          id: rollupId,
          projectId: project.id,
          source: "web",
          metricType: "pageviews",
          date: todayStr,
          value: 1,
        })
        .onConflictDoUpdate({
          target: dailyMetrics.id,
          set: { value: sql`${dailyMetrics.value} + 1` },
        })
        .catch(() => {});
    }

    return NextResponse.json(
      {
        success: true,
        hitId,
        ...(hasCustomMetric ? { metricName: rawMetricName.trim(), metricValue: rawMetricValue } : {}),
      },
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
