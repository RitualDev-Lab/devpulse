import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, pageviews, dailyMetrics, metricsHourly } from "@/db/schema";
import { eq, or, sql } from "drizzle-orm";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { scrubTelemetryText } from "@/lib/security/ingest-scrub";
import { buildVisitorId } from "@/lib/analytics/visitor";
import { client } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { buildFunnelResults, parseFunnelSteps } from "@/lib/analytics/engagement";

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

export async function GET(req: NextRequest) {
  try {
    const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    let projectId = req.nextUrl.searchParams.get("projectId")?.trim() || "";
    if (apiKey) {
      const verified = await verifyTelemetryApiKey(apiKey);
      if (!verified) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      projectId = verified.id;
    } else {
      if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const daysInput = Number(req.nextUrl.searchParams.get("days") || 30);
    const days = Number.isFinite(daysInput) ? Math.max(1, Math.min(90, Math.floor(daysInput))) : 30;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const events = parseFunnelSteps(req.nextUrl.searchParams.get("funnel"));
    const params: Array<string | number> = [];
    const ctes: string[] = [];
    const countQueries: string[] = [];

    for (let i = 0; i < events.length; i++) {
      const nameParam = `event_${i}`;
      const prior = `event_${i - 1}`;
      if (i === 0) {
        ctes.push(`${nameParam} AS (
          SELECT session_id, MIN(julianday(created_at)) AS step_at
          FROM pageviews WHERE project_id = ? AND date(created_at) >= ? AND event_name = ? AND session_id IS NOT NULL
          GROUP BY session_id
        )`);
      } else {
        ctes.push(`${nameParam} AS (
          SELECT e.session_id, MIN(julianday(e.created_at)) AS step_at
          FROM pageviews e JOIN ${prior} p ON p.session_id = e.session_id
          WHERE e.project_id = ? AND date(e.created_at) >= ? AND e.event_name = ? AND julianday(e.created_at) > p.step_at
          GROUP BY e.session_id
        )`);
      }
      params.push(projectId, cutoff, events[i]);
      countQueries.push(`(SELECT COUNT(*) FROM ${nameParam}) AS step_${i}`);
    }

    const [engagementRes, sessionTotalsRes, retentionRes, funnelRes] = await Promise.all([
      client.execute({
        sql: `SELECT date(created_at) AS date, COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS events
          FROM pageviews WHERE project_id = ? AND date(created_at) >= ? AND session_id IS NOT NULL
          GROUP BY date(created_at) ORDER BY date ASC`,
        args: [projectId, cutoff],
      }),
      client.execute({
        sql: `SELECT COUNT(DISTINCT session_id) AS total_sessions FROM pageviews
          WHERE project_id = ? AND date(created_at) >= ? AND session_id IS NOT NULL`,
        args: [projectId, cutoff],
      }),
      client.execute({
        sql: `WITH cohort AS (
            SELECT visitor_id, MIN(date(created_at)) AS cohort_day
            FROM pageviews WHERE project_id = ? AND visitor_id IS NOT NULL
              AND date(created_at) >= date('now', '-37 days')
            GROUP BY visitor_id
          ), mature AS (
            SELECT visitor_id, cohort_day FROM cohort WHERE cohort_day <= date('now', '-7 days')
          ), retained AS (
            SELECT DISTINCT m.visitor_id FROM mature m JOIN pageviews p
              ON p.project_id = ? AND p.visitor_id = m.visitor_id
              AND date(p.created_at) > m.cohort_day
              AND date(p.created_at) <= date(m.cohort_day, '+7 days')
          )
          SELECT (SELECT COUNT(*) FROM mature) AS cohort_users,
            (SELECT COUNT(*) FROM retained) AS retained_users`,
        args: [projectId, projectId],
      }),
      events.length > 0
        ? client.execute({
            sql: `WITH ${ctes.join(", ")} SELECT ${countQueries.join(", ")}`,
            args: params,
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);

    const retention = (retentionRes.rows[0] || {}) as Record<string, unknown>;
    const cohortUsers = Number(retention.cohort_users || 0);
    const retainedUsers = Number(retention.retained_users || 0);
    const counts = events.map((_, index) => Number((funnelRes.rows[0] as Record<string, unknown> | undefined)?.[`step_${index}`] || 0));
    return NextResponse.json({
      days,
      totalSessions: Number(sessionTotalsRes.rows[0]?.total_sessions || 0),
      sessionsByDay: engagementRes.rows.map((row) => ({
        date: String(row.date), sessions: Number(row.sessions || 0), events: Number(row.events || 0),
      })),
      retention7d: {
        cohortUsers,
        retainedUsers,
        ratePercent: cohortUsers ? Number(((retainedUsers / cohortUsers) * 100).toFixed(1)) : null,
        note: "Uses privacy-preserving monthly visitor IDs; cross-month returns may be undercounted.",
      },
      funnel: buildFunnelResults(events, counts),
    });
  } catch (err) {
    console.error("Analytics report error:", err);
    return NextResponse.json({ error: "Failed to load analytics report" }, { status: 500 });
  }
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

    let body: Record<string, unknown> = {};
    try {
      const rawText = await req.text();
      const parsed: unknown = rawText ? JSON.parse(rawText) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
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
    const os = detectOs(userAgent, typeof body.os === "string" ? body.os : undefined);

    const hitId = `pv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const rawSessionId = typeof body.sessionId === "string" ? body.sessionId.trim().slice(0, 160) : "";
    const sessionId = rawSessionId
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(`${project.id}|${rawSessionId}`)
            )
          )
        ).map((b) => b.toString(16).padStart(2, "0")).join("")
      : null;
    const visitorId = await buildVisitorId({
      secret: process.env.ANALYTICS_HASH_SECRET || "",
      projectId: project.id,
      ip,
      userAgent,
      now: new Date(),
    });

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
        visitorId,
        sessionId,
        createdAt: nowIso.replace("T", " ").slice(0, 19),
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
  } catch (err) {
    console.error("Analytics ingest error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
