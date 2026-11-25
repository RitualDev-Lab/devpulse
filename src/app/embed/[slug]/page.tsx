import React from "react";
import { db } from "@/db";
import { dailyMetrics, projects, uptimeMonitors } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { Activity, Star, Download, Gauge } from "lucide-react";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";

export default async function EmbedMetricsCardPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const cleanSlug = decodeURIComponent(slug);

  const [proj] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, cleanSlug))
    .limit(1);

  if (!proj) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-400 flex items-center justify-center p-4 text-xs font-mono">
        Project &quot;{cleanSlug}&quot; not found on DevPulse.
      </div>
    );
  }

  const [metrics, monitors] = await Promise.all([
    db
      .select()
      .from(dailyMetrics)
      .where(eq(dailyMetrics.projectId, proj.id))
      .orderBy(desc(dailyMetrics.date))
      .limit(40)
      .catch(() => []),
    db
      .select()
      .from(uptimeMonitors)
      .where(eq(uptimeMonitors.projectId, proj.id))
      .limit(10)
      .catch(() => []),
  ]);

  let stars = 0;
  let downloads = 0;
  for (const m of metrics) {
    if (m.metricType === "stars") stars = Math.max(stars, m.value);
    if (m.metricType === "downloads" || m.metricType === "installs" || m.metricType === "pulls") {
      downloads += m.value;
    }
  }

  const avgUptimeBp =
    monitors.length > 0
      ? Math.round(monitors.reduce((s, m) => s + m.uptimeBasisPoints, 0) / monitors.length)
      : 10000;
  const maxP95 = monitors.reduce((max, m) => Math.max(max, m.p95LatencyMs), 0);
  const anyDown = monitors.some((m) => m.lastStatus === "down");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-3 flex items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white truncate">{proj.name}</h1>
              <div className="text-[10px] font-mono text-zinc-400 truncate">
                {proj.githubRepo || proj.slug}
              </div>
            </div>
          </div>

          <span
            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border shrink-0 ${
              anyDown
                ? "bg-red-500/15 text-red-300 border-red-500/30"
                : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            }`}
          >
            {anyDown ? "Degraded" : "Operational"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <div className="text-[10px] text-zinc-400 flex items-center justify-center gap-1">
              <Star className="w-3 h-3 text-amber-400" /> Stars
            </div>
            <div className="text-base font-bold text-white mt-0.5">{stars.toLocaleString()}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <div className="text-[10px] text-zinc-400 flex items-center justify-center gap-1">
              <Download className="w-3 h-3 text-blue-400" /> Downloads
            </div>
            <div className="text-base font-bold text-white mt-0.5">{downloads.toLocaleString()}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <div className="text-[10px] text-zinc-400 flex items-center justify-center gap-1">
              <Gauge className="w-3 h-3 text-emerald-400" /> Uptime
            </div>
            <div className="text-base font-bold text-emerald-300 mt-0.5">
              {(avgUptimeBp / 100).toFixed(2)}%
              {maxP95 > 0 ? <span className="text-[10px] text-zinc-400 ml-1">({maxP95}ms)</span> : null}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/70">
          <span>Live Developer Telemetry</span>
          <a
            href={`${PUBLIC_APP_URL}`}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:underline font-medium"
          >
            Powered by DevPulse
          </a>
        </div>
      </div>
    </div>
  );
}
