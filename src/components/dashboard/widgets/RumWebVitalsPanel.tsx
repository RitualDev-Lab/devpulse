"use client";

import React, { useState } from "react";
import { Gauge } from "lucide-react";
import type { RumWebVitalsSummary, VitalMetricName } from "@/lib/analytics/rum-vitals";

const VITAL_META: Array<{
  metric: VitalMetricName;
  label: string;
  unit: string;
  threshold: string;
  goodMax: number;
  poorMin: number;
  scaleMax: number;
}> = [
  { metric: "LCP", label: "Largest Contentful Paint", unit: "ms", threshold: "Good <= 2500ms", goodMax: 2500, poorMin: 4000, scaleMax: 5000 },
  { metric: "INP", label: "Interaction to Next Paint", unit: "ms", threshold: "Good <= 200ms", goodMax: 200, poorMin: 500, scaleMax: 650 },
  { metric: "CLS", label: "Cumulative Layout Shift", unit: "", threshold: "Good <= 0.1", goodMax: 0.1, poorMin: 0.25, scaleMax: 0.35 },
  { metric: "TTFB", label: "Time to First Byte", unit: "ms", threshold: "Good <= 800ms", goodMax: 800, poorMin: 1800, scaleMax: 2400 },
];

export function RumWebVitalsPanel({ summary }: { summary?: RumWebVitalsSummary | null }) {
  const [groupBy, setGroupBy] = useState<"route" | "country" | "browser" | "release">("route");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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
              onClick={() => {
                setGroupBy(dim);
                setSelectedKey(null);
              }}
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

          const p75Pct = stat ? Math.min(98, Math.max(2, (stat.p75 / v.scaleMax) * 100)) : null;
          const goodZonePct = Math.round((v.goodMax / v.scaleMax) * 100);
          const warnZonePct = Math.round(((v.poorMin - v.goodMax) / v.scaleMax) * 100);
          const poorZonePct = Math.max(5, 100 - goodZonePct - warnZonePct);

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
              {/* Threshold Zones Progress Track */}
              <div className="relative h-2 rounded-full overflow-hidden flex bg-zinc-900 border border-zinc-800/80">
                <div style={{ width: `${goodZonePct}%` }} className="bg-emerald-500/45 h-full" />
                <div style={{ width: `${warnZonePct}%` }} className="bg-amber-500/45 h-full" />
                <div style={{ width: `${poorZonePct}%` }} className="bg-red-500/45 h-full" />
                {p75Pct !== null && (
                  <div
                    style={{ left: `${p75Pct}%` }}
                    title={`p75 = ${stat?.p75}${v.unit}`}
                    className="absolute top-0 bottom-0 w-1 -ml-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
                  />
                )}
              </div>
              <div className="text-[10px] text-zinc-500 flex items-center justify-between">
                <span>{v.threshold}</span>
                {stat && <span className="font-mono text-zinc-400">p75</span>}
              </div>
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
              {rows.map((r) => {
                const isSelected = selectedKey === r.key;
                return (
                <tr
                  key={r.key}
                  onClick={() => setSelectedKey(isSelected ? null : r.key)}
                  className={`cursor-pointer transition ${isSelected ? "bg-indigo-950/40" : "hover:bg-zinc-900/50"}`}
                >
                  <td className="px-3 py-2 text-zinc-200 font-semibold">{r.key}</td>
                  <td className="px-3 py-2 text-zinc-400">{r.count}</td>
                  <td
                    className={`px-3 py-2 font-semibold ${
                      r.lcpP75 === null
                        ? "text-zinc-500"
                        : r.lcpP75 <= 2500
                        ? "text-emerald-300"
                        : r.lcpP75 <= 4000
                        ? "text-amber-300"
                        : "text-red-300"
                    }`}
                  >
                    {r.lcpP75 !== null ? `${r.lcpP75}ms` : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 font-semibold ${
                      r.inpP75 === null
                        ? "text-zinc-500"
                        : r.inpP75 <= 200
                        ? "text-emerald-300"
                        : r.inpP75 <= 500
                        ? "text-amber-300"
                        : "text-red-300"
                    }`}
                  >
                    {r.inpP75 !== null ? `${r.inpP75}ms` : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 font-semibold ${
                      r.clsP75 === null
                        ? "text-zinc-500"
                        : r.clsP75 <= 0.1
                        ? "text-emerald-300"
                        : r.clsP75 <= 0.25
                        ? "text-amber-300"
                        : "text-red-300"
                    }`}
                  >
                    {r.clsP75 !== null ? r.clsP75 : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 font-semibold ${
                      r.ttfbP75 === null
                        ? "text-zinc-500"
                        : r.ttfbP75 <= 800
                        ? "text-emerald-300"
                        : r.ttfbP75 <= 1800
                        ? "text-amber-300"
                        : "text-red-300"
                    }`}
                  >
                    {r.ttfbP75 !== null ? `${r.ttfbP75}ms` : "—"}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedKey && (() => {
        const row = rows.find((r) => r.key === selectedKey);
        if (!row) return null;
        return (
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-indigo-500/40 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-white">
                Drill-Down: <code className="text-cyan-300">{row.key}</code> ({row.count} RUM samples)
              </span>
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="text-[11px] text-zinc-400 hover:text-white underline"
              >
                Clear
              </button>
            </div>
            <div className="text-[11px] text-zinc-400">
              {row.lcpP75 !== null && row.lcpP75 > 2500
                ? "Optimization Tip: LCP exceeds 2.5s — preload hero media, inline critical CSS, or enable edge HTML streaming."
                : row.inpP75 !== null && row.inpP75 > 200
                ? "Optimization Tip: INP exceeds 200ms — defer heavy hydration listeners and break up long main-thread tasks."
                : "All sampled Core Web Vitals for this cohort meet Google Good thresholds."}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
