import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dailyMetrics, errorEvents, projectReleases, projects, uptimeMonitors } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";

export const dynamic = "force-dynamic";

function escapeCsv(val: unknown): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const format = req.nextUrl.searchParams.get("format") === "report" ? "report" : "csv";
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    let proj: any = null;
    if (projectId === "prj_ritual_core") {
      const [demoProj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      proj = demoProj || null;
    } else {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      proj = access.project;
    }

    if (!proj) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const [metrics, errors, monitors, releases] = await Promise.all([
      db
        .select()
        .from(dailyMetrics)
        .where(eq(dailyMetrics.projectId, proj.id))
        .orderBy(desc(dailyMetrics.date))
        .limit(90)
        .catch(() => []),
      db
        .select()
        .from(errorEvents)
        .where(eq(errorEvents.projectId, proj.id))
        .orderBy(desc(errorEvents.createdAt))
        .limit(50)
        .catch(() => []),
      db
        .select()
        .from(uptimeMonitors)
        .where(eq(uptimeMonitors.projectId, proj.id))
        .limit(20)
        .catch(() => []),
      db
        .select()
        .from(projectReleases)
        .where(eq(projectReleases.projectId, proj.id))
        .orderBy(desc(projectReleases.releasedAt))
        .limit(15)
        .catch(() => []),
    ]);

    if (format === "csv") {
      const lines: string[] = ["Section,Date,Metric,Value,Details"];
      for (const m of metrics) {
        lines.push(
          [
            "DailyMetric",
            m.date,
            `${m.source}:${m.metricType}`,
            m.value,
            m.metadataJson || "",
          ]
            .map(escapeCsv)
            .join(",")
        );
      }
      for (const mon of monitors) {
        lines.push(
          [
            "UptimeMonitor",
            mon.lastCheckedAt || mon.createdAt,
            mon.name,
            `${(mon.uptimeBasisPoints / 100).toFixed(2)}% (P95 ${mon.p95LatencyMs}ms)`,
            mon.url,
          ]
            .map(escapeCsv)
            .join(",")
        );
      }
      for (const rel of releases) {
        lines.push(
          [
            "ReleaseHealth",
            rel.releasedAt,
            rel.version,
            `${rel.totalSessions} sessions / ${rel.crashCount} crashes`,
            rel.commitSha || "",
          ]
            .map(escapeCsv)
            .join(",")
        );
      }
      for (const err of errors) {
        lines.push(
          [
            "CrashEvent",
            err.createdAt,
            err.errorName,
            err.status,
            `${err.runtime}: ${err.message.slice(0, 120)}`,
          ]
            .map(escapeCsv)
            .join(",")
        );
      }

      return new NextResponse(lines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="devpulse-${proj.slug}-weekly-report.csv"`,
        },
      });
    }

    // Printable HTML Weekly Report (Print / Save as PDF in 1 click)
    const unresolvedCount = errors.filter((e) => e.status === "unresolved").length;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${proj.name} — Weekly Maintainer Report</title>
<style>
  body { font-family: Inter, system-ui, -apple-system, sans-serif; color: #111827; margin: 36px auto; max-width: 820px; padding: 0 20px; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px; }
  .btn { background: #4f46e5; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font-weight: 600; cursor: pointer; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; background: #f9fafb; }
  .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
  .val { font-size: 22px; font-weight: 700; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 24px; }
  th, td { border-bottom: 1px solid #e5e7eb; text-align: left; padding: 8px 6px; }
  th { color: #6b7280; font-weight: 600; }
  @media print { .no-print { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <header>
    <div>
      <h1 style="margin:0;font-size:22px;">${proj.name} — Weekly Telemetry Report</h1>
      <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">Generated by DevPulse &bull; ${new Date().toUTCString()}</p>
    </div>
    <button class="btn no-print" onclick="window.print()">Save / Print PDF</button>
  </header>
  <div class="grid">
    <div class="card"><div class="label">Metrics Recorded</div><div class="val">${metrics.length}</div></div>
    <div class="card"><div class="label">Uptime Monitors</div><div class="val">${monitors.length}</div></div>
    <div class="card"><div class="label">Unresolved Crashes</div><div class="val">${unresolvedCount}</div></div>
    <div class="card"><div class="label">Releases Tracked</div><div class="val">${releases.length}</div></div>
  </div>
  <h3>Uptime &amp; P95 Latency</h3>
  <table>
    <thead><tr><th>Endpoint</th><th>Status</th><th>Uptime</th><th>P95 Latency</th></tr></thead>
    <tbody>
      ${monitors.length === 0 ? `<tr><td colspan="4">No monitors configured.</td></tr>` : monitors.map((m) => `<tr><td>${m.name}</td><td>${m.lastStatus.toUpperCase()}</td><td>${(m.uptimeBasisPoints / 100).toFixed(2)}%</td><td>${m.p95LatencyMs} ms</td></tr>`).join("")}
    </tbody>
  </table>
  <h3>Recent Daily Metrics</h3>
  <table>
    <thead><tr><th>Date</th><th>Source</th><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      ${metrics.slice(0, 20).map((m) => `<tr><td>${m.date}</td><td>${m.source}</td><td>${m.metricType}</td><td>${m.value.toLocaleString()}</td></tr>`).join("")}
    </tbody>
  </table>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err: any) {
    console.error("GET /api/v1/export error:", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
