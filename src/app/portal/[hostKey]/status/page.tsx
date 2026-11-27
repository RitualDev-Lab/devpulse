import React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  FileText,
} from "lucide-react";
import { loadPortalStatusHistory } from "@/lib/domains/status-loader";
import { StatusSubscribeWidget } from "@/components/portal/StatusSubscribeWidget";
import { normalizeThemeId, getPresetThemeCss, scopeCustomCss } from "@/lib/layout/css-scoper";

export const dynamic = "force-dynamic";

export default async function PortalStatusHistoryPage(props: {
  params: Promise<{ hostKey: string }>;
  searchParams?: Promise<{ project?: string }>;
}) {
  const { hostKey } = await props.params;
  const sp = (await props.searchParams) || {};
  const loaded = await loadPortalStatusHistory(hostKey, sp.project);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="p-8 rounded-2xl bg-zinc-900 border border-zinc-800 text-center space-y-3">
          <h1 className="text-lg font-bold text-white">Status Portal Not Found</h1>
          <Link href="/" className="text-xs text-indigo-400 hover:underline">
            Return to DevPulse
          </Link>
        </div>
      </div>
    );
  }

  const { portal, history, incidents, maintenanceWindows = [] } = loaded;
  const project = portal.activeProject;
  const activeTheme = normalizeThemeId(project?.theme);
  const dynamicCss = [
    getPresetThemeCss(activeTheme),
    scopeCustomCss(project?.customCss || "", ".devpulse-workspace"),
  ]
    .filter(Boolean)
    .join("\n");
  const brandName = portal.user.brandTitle || project?.name || portal.user.githubUsername;
  const hasActiveOutage = history.perMonitor.some((m) => m.lastStatus === "down");
  const hasDegraded = history.perMonitor.some((m) => m.lastStatus === "degraded");

  return (
    <div data-theme={activeTheme} className="devpulse-shell min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {dynamicCss && <style dangerouslySetInnerHTML={{ __html: dynamicCss }} />}
      <header className="devpulse-topbar border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h1 className="font-bold text-white text-base">
                {brandName} — 90-Day Status History
              </h1>
              <p className="text-xs text-zinc-400">
                Public uptime telemetry, SLA compliance, and Incident Root Cause Analysis (RCA)
              </p>
            </div>
          </div>
          <Link
            href={project ? `/portal/${encodeURIComponent(hostKey)}?project=${encodeURIComponent(project.slug)}` : `/portal/${encodeURIComponent(hostKey)}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Portal</span>
          </Link>
        </div>
      </header>

      <main className="devpulse-workspace flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Global Operational Banner */}
        {maintenanceWindows.length > 0 && (
          <div className="p-4 rounded-2xl border bg-amber-950/35 border-amber-600/40 text-amber-100 space-y-1.5">
            {maintenanceWindows.map((mw) => (
              <div key={mw.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-bold uppercase text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 mr-2">
                    {mw.isActiveNow ? "Maintenance Active" : "Scheduled Maintenance"}
                  </span>
                  <span className="font-semibold text-white">{mw.title}</span>
                  {mw.reason && <span className="text-amber-200/80 ml-2">— {mw.reason}</span>}
                </div>
                <span className="font-mono text-[11px] text-amber-200/75">
                  {new Date(mw.startsAt).toISOString().slice(0, 16).replace("T", " ")} UTC &rarr;{" "}
                  {new Date(mw.endsAt).toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
              </div>
            ))}
          </div>
        )}

        <div
          className={`p-5 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
            hasActiveOutage
              ? "bg-red-950/40 border-red-700/60 text-red-100"
              : hasDegraded
              ? "bg-amber-950/40 border-amber-700/60 text-amber-100"
              : "bg-emerald-950/35 border-emerald-700/50 text-emerald-100"
          }`}
        >
          <div className="flex items-center gap-3">
            {hasActiveOutage ? (
              <XCircle className="w-6 h-6 text-red-400 shrink-0" />
            ) : hasDegraded ? (
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            )}
            <div>
              <div className="font-bold text-base">
                {hasActiveOutage
                  ? "Service Disruption Detected"
                  : hasDegraded
                  ? "Degraded Performance on Some Endpoints"
                  : "All Systems Operational"}
              </div>
              <div className="text-xs opacity-80">
                Rolling 90-Day Availability: <strong className="font-mono">{history.overall90dPercent}%</strong>
              </div>
            </div>
          </div>
          <div className="text-xs font-mono px-3 py-1.5 rounded-xl bg-zinc-950/60 border border-zinc-800 text-zinc-200">
            Last 90 Days • Updated Live
          </div>
        </div>

        <StatusSubscribeWidget
          projectId={project?.id}
          projectSlug={project?.slug}
          rssHref={`/portal/${encodeURIComponent(hostKey)}/status/rss.xml${
            project ? `?project=${encodeURIComponent(project.slug)}` : ""
          }`}
        />

        {/* 90-Day Daily Uptime Strip Per Monitor */}
        <section className="space-y-4">
          <h2 className="text-sm font-bold text-white">Endpoint 90-Day Uptime Bars</h2>
          {history.perMonitor.length === 0 ? (
            <div className="p-6 rounded-2xl bg-zinc-900/70 border border-zinc-800 text-xs text-zinc-400">
              No public uptime monitors are attached to this project yet.
            </div>
          ) : (
            history.perMonitor.map((m) => (
              <div
                key={m.monitorId}
                className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-white">{m.name}</div>
                    <div className="text-[11px] font-mono text-zinc-500">{m.url}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-zinc-400">P95 {m.p95LatencyMs}ms</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                      {m.uptime90dPercent}%
                    </span>
                  </div>
                </div>

                {/* 90-bar grid */}
                <div className="grid grid-cols-[repeat(90,minmax(0,1fr))] gap-[2px] h-7 items-stretch">
                  {m.days.map((d) => {
                    const color =
                      d.status === "operational"
                        ? "bg-emerald-500 hover:bg-emerald-400"
                        : d.status === "degraded"
                        ? "bg-amber-400 hover:bg-amber-300"
                        : d.status === "outage"
                        ? "bg-red-500 hover:bg-red-400"
                        : "bg-zinc-800 hover:bg-zinc-700";
                    return (
                      <div
                        key={d.date}
                        title={`${d.date}: ${d.status} (${d.uptimePercent}%, ${d.totalChecks} checks)`}
                        className={`rounded-[2px] transition-colors ${color}`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>90 days ago</span>
                  <span>{m.days[Math.floor(m.days.length / 2)]?.date}</span>
                  <span>Today</span>
                </div>
              </div>
            ))
          )}
        </section>

        {/* Public Incident Timeline & RCA */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" />
            <span>Incident History &amp; Root Cause Analysis (Last 90 Days)</span>
          </h2>

          {incidents.length === 0 ? (
            <div className="p-6 rounded-2xl bg-zinc-900/70 border border-zinc-800 text-xs text-zinc-400">
              No public incidents reported over the last 90 days.
            </div>
          ) : (
            <div className="space-y-3">
              {incidents.map((inc) => (
                <article
                  key={inc.id}
                  className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-white">{inc.title}</h3>
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <span
                        className={`px-2 py-0.5 rounded-full uppercase font-semibold ${
                          inc.severity === "critical"
                            ? "bg-red-500/15 text-red-300"
                            : inc.severity === "major"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-cyan-500/15 text-cyan-300"
                        }`}
                      >
                        {inc.severity}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full uppercase font-semibold ${
                          inc.status === "resolved"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-indigo-500/15 text-indigo-300"
                        }`}
                      >
                        {inc.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Started: {inc.startedAt.slice(0, 16).replace("T", " ")} UTC
                    </span>
                    {inc.resolvedAt && (
                      <span>Resolved: {inc.resolvedAt.slice(0, 16).replace("T", " ")} UTC</span>
                    )}
                    {inc.durationMinutes > 0 && <span>Duration: {inc.durationMinutes} min</span>}
                  </div>
                  {inc.impactSummary && (
                    <p className="text-xs text-zinc-300">{inc.impactSummary}</p>
                  )}
                  {inc.rcaText && (
                    <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 border-l-2 border-l-indigo-500 text-xs text-zinc-300">
                      <span className="font-bold text-indigo-300 block mb-1">
                        Root Cause Analysis (RCA)
                      </span>
                      {inc.rcaText}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
