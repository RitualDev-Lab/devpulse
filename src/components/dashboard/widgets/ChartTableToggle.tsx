"use client";

import React, { useState } from "react";
import { BarChart2, Table as TableIcon } from "lucide-react";

interface ChartTableColumn {
  key: string;
  label: string;
}

interface ChartTableToggleProps {
  title?: string;
  sourceLabel?: string;
  windowLabel?: string;
  estimated?: boolean;
  columns: ChartTableColumn[];
  rows: Array<Record<string, unknown>>;
  children: React.ReactNode;
}

/**
 * WCAG 2.2 AA Accessible Chart Container
 * Provides explicit provenance metadata (Source, Window, Estimated badge)
 * and a keyboard-accessible Show Chart / Show Table toggle.
 */
export function ChartTableToggle({
  sourceLabel,
  windowLabel,
  estimated = false,
  columns,
  rows,
  children,
}: ChartTableToggleProps) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5 text-zinc-400">
          {sourceLabel && (
            <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 font-mono">
              Source: {sourceLabel}
            </span>
          )}
          {windowLabel && (
            <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 font-mono">
              Window: {windowLabel}
            </span>
          )}
          {estimated && (
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono">
              Estimated
            </span>
          )}
        </div>
        <button
          type="button"
          aria-pressed={viewMode === "table"}
          onClick={() => setViewMode((m) => (m === "chart" ? "table" : "chart"))}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-medium transition"
        >
          {viewMode === "chart" ? (
            <>
              <TableIcon className="w-3.5 h-3.5 text-cyan-400" />
              <span>Show Table</span>
            </>
          ) : (
            <>
              <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Show Chart</span>
            </>
          )}
        </button>
      </div>

      {viewMode === "chart" ? (
        children
      ) : (
        <div className="max-h-56 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950/70">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-300 border-b border-zinc-800 sticky top-0">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-mono">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-4 text-center text-zinc-500">
                    No data rows in window.
                  </td>
                </tr>
              ) : (
                rows.slice(-30).map((r, i) => (
                  <tr key={i} className="hover:bg-zinc-900/50">
                    {columns.map((c) => (
                      <td key={c.key} className="px-3 py-1.5 font-mono text-zinc-200 tabular-nums">
                        {r[c.key] == null ? "—" : String(r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
