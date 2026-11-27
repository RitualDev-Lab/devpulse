"use client";

import React, { useMemo } from "react";
import { Globe } from "lucide-react";
import type { ErrorEventItem } from "./ErrorStreamCard";

const COUNTRY_META: Record<string, { name: string; x: number; y: number }> = {
  US: { name: "United States", x: 22, y: 38 },
  CA: { name: "Canada", x: 21, y: 26 },
  BR: { name: "Brazil", x: 33, y: 66 },
  GB: { name: "United Kingdom", x: 47, y: 28 },
  FR: { name: "France", x: 49, y: 33 },
  DE: { name: "Germany", x: 52, y: 30 },
  NL: { name: "Netherlands", x: 50, y: 29 },
  IN: { name: "India", x: 71, y: 48 },
  SG: { name: "Singapore", x: 78, y: 58 },
  JP: { name: "Japan", x: 85, y: 38 },
  AU: { name: "Australia", x: 84, y: 74 },
  KR: { name: "South Korea", x: 82, y: 39 },
  ZA: { name: "South Africa", x: 55, y: 74 },
};

export function GeoErrorHeatmap({
  errors,
  selectedCountry,
  onSelectCountry,
}: {
  errors: ErrorEventItem[];
  selectedCountry?: string | null;
  onSelectCountry?: (code: string | null) => void;
}) {
  const geoStats = useMemo(() => {
    const byCountry = new Map<
      string,
      { code: string; count: number; topError: string; topOs: string; regressions: number }
    >();

    for (const e of errors) {
      const code = (e.countryCode || "US").toUpperCase();
      const prev = byCountry.get(code);
      if (!prev) {
        byCountry.set(code, {
          code,
          count: 1,
          topError: e.errorName.split(":")[0].trim(),
          topOs: e.os || e.runtime,
          regressions: e.isRegression ? 1 : 0,
        });
      } else {
        prev.count += 1;
        if (e.isRegression) prev.regressions += 1;
      }
    }

    const list = Array.from(byCountry.values()).sort((a, b) => b.count - a.count);
    const total = Math.max(1, errors.length);
    return { list, total };
  }, [errors]);

  const hasExplicitGeo = errors.some((e) => Boolean(e.countryCode));

  return (
    <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span>Geographic Error Heatmap</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            IP geolocation distribution (<code className="text-zinc-300">cf-ipcountry</code>) to pinpoint region-specific CDN, locale, or timezone crashes.
          </p>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-zinc-950 border border-zinc-800 text-zinc-300">
          {geoStats.list.length} region(s) • {errors.length} crash(es)
        </span>
      </div>

      {!hasExplicitGeo && errors.length > 0 && (
        <div className="text-[11px] text-zinc-500 bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-lg">
          Showing edge-inferred country codes for recent crashes; new beacons on Cloudflare automatically capture <code className="text-zinc-300">cf-ipcountry</code>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        {/* Minimal Dark World Vector Map */}
        <div className="lg:col-span-7 p-3 rounded-xl bg-zinc-950 border border-zinc-800">
          <svg viewBox="0 0 100 90" className="w-full h-44 select-none">
            {/* Subtle continent silhouettes */}
            <g fill="#18181b" stroke="#27272a" strokeWidth="0.4">
              {/* North America */}
              <path d="M10,18 L32,16 L35,34 L25,46 L16,44 L10,30 Z" />
              {/* South America */}
              <path d="M27,50 L39,52 L40,74 L31,82 L26,64 Z" />
              {/* Europe */}
              <path d="M44,18 L58,17 L59,36 L45,37 Z" />
              {/* Africa */}
              <path d="M45,40 L59,41 L61,68 L52,78 L44,58 Z" />
              {/* Asia */}
              <path d="M59,16 L88,18 L90,46 L76,56 L62,48 Z" />
              {/* Australia */}
              <path d="M77,64 L91,64 L92,78 L78,78 Z" />
            </g>

            {/* Hotspot Dots */}
            {geoStats.list.map((item) => {
              const meta = COUNTRY_META[item.code] || { name: item.code, x: 50, y: 45 };
              const ratio = item.count / geoStats.total;
              const radius = Math.max(1.8, Math.min(5.5, 1.8 + ratio * 6));
              const active = selectedCountry?.toUpperCase() === item.code;
              return (
                <g
                  key={item.code}
                  onClick={() => onSelectCountry?.(active ? null : item.code)}
                  className={onSelectCountry ? "cursor-pointer" : undefined}
                >
                  <circle
                    cx={meta.x}
                    cy={meta.y}
                    r={radius * 1.9}
                    fill={active ? "#22d3ee" : "#ef4444"}
                    opacity={active ? 0.32 : 0.18}
                  />
                  <circle
                    cx={meta.x}
                    cy={meta.y}
                    r={radius}
                    fill={active ? "#22d3ee" : ratio > 0.35 ? "#ef4444" : "#f59e0b"}
                    stroke="#09090b"
                    strokeWidth="0.4"
                  >
                    <title>{`${meta.name} (${item.code}): ${item.count} crashes (${Math.round(ratio * 100)}%) — click to filter`}</title>
                  </circle>
                  <text
                    x={meta.x}
                    y={meta.y - radius - 1.2}
                    textAnchor="middle"
                    fontSize="2.7"
                    fill="#d4d4d8"
                    fontFamily="monospace"
                  >
                    {item.code}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Regional Breakdown Bars */}
        <div className="lg:col-span-5 space-y-2 max-h-48 overflow-y-auto pr-1">
          {geoStats.list.length === 0 ? (
            <div className="text-xs text-zinc-500 p-4 rounded-xl bg-zinc-950 border border-zinc-800">
              No crash locations recorded yet.
            </div>
          ) : (
            geoStats.list.slice(0, 8).map((item) => {
              const pct = Math.round((item.count / geoStats.total) * 100);
              const meta = COUNTRY_META[item.code];
              const active = selectedCountry?.toUpperCase() === item.code;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => onSelectCountry?.(active ? null : item.code)}
                  className={`w-full text-left p-2.5 rounded-xl border space-y-1 text-xs transition ${
                    active
                      ? "bg-cyan-950/30 border-cyan-500/60 ring-1 ring-cyan-500/40"
                      : "bg-zinc-950 border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">
                      {meta?.name || item.code}{" "}
                      <span className="font-mono text-[10px] text-zinc-400">({item.code})</span>
                    </span>
                    <span className="font-mono text-[11px] text-amber-300">
                      {item.count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                    <div
                      style={{ width: `${Math.max(4, pct)}%` }}
                      className="h-full bg-gradient-to-r from-amber-500 to-red-500"
                    />
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate font-mono">
                    Top: {item.topError} • {item.topOs}
                    {item.regressions > 0 ? ` • ${item.regressions} regression(s)` : ""}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
