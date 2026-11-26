"use client";

import React, { useState } from "react";
import { Gauge } from "lucide-react";
import type { RumWebVitalsSummary, VitalMetricName } from "@/lib/analytics/rum-vitals";

const VITAL_META: Array<{ metric: VitalMetricName; label: string; unit: string; threshold: string }> = [
  { metric: "LCP", label: "Largest Contentful Paint", unit: "ms", threshold: "Good <= 2500ms" },
  { metric: "INP", label: "Interaction to Next Paint", unit: "ms", threshold: "Good <= 200ms" },
  { metric: "CLS", label: "Cumulative Layout Shift", unit: "", threshold: "Good <= 0.1" },
  { metric: "TTFB", label: "Time to First Byte", unit: "ms", threshold: "Good <= 800ms" },
];

export function RumWebVitalsPanel({ summary }: { summary?: RumWebVitalsSummary | null }) {
  const [groupBy, setGroupBy] = useState<"route" | "country" | "browser" | "release">("route");

  const rows =
    groupBy === "country"
      ? summary?.byCountry || []
      : groupBy === "browser"
        ? summary?.byBrowser || []
        : groupBy === "release"
          ? summary?.byRelease || []
          : summary?.byRoute || [];

  return (
    <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Gauge className="w-4 h-4 text-emerald-400" />
            <span>Real User Monitoring (RUM) &amp; Core Web Vitals</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            p50 / p75 / p95 quantiles for LCP, INP, CLS &amp; TTFB streamed automatically by <code className="text-cyan-300">@ritualdev/devpulse</code> ({summary?.sampleCount || 0} samples).
          </p>
        </div>

        <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-[11px] gap-1">
          {(["route", "country", "browser", "release"] as const).map((dim) => (
            <button
              key={dim}
              type="button"
              onClick={() => setGroupBy(dim)}
              className={`px-2.5 py-1 rounded-lg capitalize font-semibold transition ${
                groupBy === dim ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {dim}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {VITAL_META.map((v) => {
          const stat = summary?.metrics?.[v.metric] || null;
          const badgeCls =
            stat?.rating === "good"
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              : stat?.rating === "needs_improvement"
                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                : stat?.rating === "poor"
                  ? "bg-red-500/15 text-red-300 border-red-500/30"
                  : "bg-zinc-800 text-zinc-400 border-zinc-700";

          return (
            <div key={v.metric} className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white">{v.metric}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase font-semibold ${badgeCls}`}>
                  {stat ? stat.rating.replace("_", " ") : "no data"}
                </span>
              </div>
              <div className="text-[11px] text-zinc-500">{v.label}</div>
              <div className="grid grid-cols-3 gap-1.5 text-center pt-1 font-mono text-xs">
                <div className="p-1.5 rounded-lg bg-zinc-900">
                  <div className="text-[9px] text-zinc-500">p50</div>
                  <div className="text-zinc-200 font-bold">{stat ? `${stat.p50}${v.unit}` : "—"}</div>
                </div>
                <div className="p-1.5 rounded-lg bg-zinc-900 border border-indigo-500/30">
                  <div className="text-[9px] text-indigo-300">p75</div>
                  <div className="text-white font-bold">{stat ? `${stat.p75}${v.unit}` : "—"}</div>
                </div>
                <div className="p-1.5 rounded-lg bg-zinc-900">
                  <div className="text-[9px] text-zinc-500">p95</div>
                  <div className="text-zinc-200 font-bold">{stat ? `${stat.p95}${v.unit}` : "—"}</div>
                </div>
              </div>
              <div className="text-[10px] text-zinc-500">{v.threshold}</div>
            </div>
          );
        })}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="px-3 py-2 capitalize">{groupBy}</th>
                <th className="px-3 py-2">Samples</th>
                <th className="px-3 py-2">LCP p75</th>
                <th className="px-3 py-2">INP p75</th>
                <th className="px-3 py-2">CLS p75</th>
                <th className="px-3 py-2">TTFB p75</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/40 font-mono">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2 text-zinc-200">{r.key}</td>
                  <td className="px-3 py-2 text-zinc-400">{r.count}</td>
                  <td className="px-3 py-2 text-cyan-300">{r.lcpP75 !== null ? `${r.lcpP75}ms` : "—"}</td>
                  <td className="px-3 py-2 text-indigo-300">{r.inpP75 !== null ? `${r.inpP75}ms` : "—"}</td>
                  <td className="px-3 py-2 text-emerald-300">{r.clsP75 !== null ? r.clsP75 : "—"}</td>
                  <td className="px-3 py-2 text-amber-300">{r.ttfbP75 !== null ? `${r.ttfbP75}ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
