"use client";

import React, { useState } from "react";
import { Sparkles, Play, Code2, Loader2, ShieldCheck } from "lucide-react";

interface ExploreResponse {
  source?: string;
  intentLabel?: string;
  description?: string;
  sql?: string;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  error?: string;
}

const PRESET_PROMPTS = [
  "Show top crash routes and unresolved error hits",
  "Summarize MCP AI agent calls and token cost",
  "Show daily package registry download velocity",
  "List daily web active users by country",
];

export function NlExplorerPanel({
  projectId,
  isDemo = false,
}: {
  projectId: string;
  isDemo?: boolean;
}) {
  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExploreResponse | null>(null);

  const runExplore = async (targetPrompt?: string) => {
    const q = (targetPrompt ?? prompt).trim();
    if (!q) return;
    setLoading(true);
    try {
      const res = await fetch("/api/v1/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, prompt: q, isDemo }),
      });
      const json = (await res.json()) as ExploreResponse;
      setResult(json);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>AI Natural-Language Telemetry Explorer (Read-Only SQL)</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Ask plain-English questions; compiles to tenant-scoped SELECT queries with DBShield injection guardrails.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
          <ShieldCheck className="w-3 h-3" /> AST Read-Only Guard
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESET_PROMPTS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setPrompt(preset);
              void runExplore(preset);
            }}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition"
          >
            {preset}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runExplore();
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask e.g. Show top crash routes or MCP agent token costs..."
          className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:border-purple-500 outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-xs font-semibold text-white transition"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          <span>Run Query</span>
        </button>
      </form>

      {result?.error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {result.error}
        </div>
      )}

      {result && !result.error && (
        <div className="space-y-3">
          {result.sql && (
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1 font-semibold text-zinc-200">
                  <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                  {result.intentLabel}
                </span>
                <span className="font-mono text-zinc-500">{result.source}</span>
              </div>
              <pre className="text-[11px] font-mono text-cyan-300 overflow-x-auto">{result.sql}</pre>
            </div>
          )}

          {result.rows && result.rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                  <tr>
                    {(result.columns || Object.keys(result.rows[0])).map((col) => (
                      <th key={col} className="px-3 py-2 font-mono">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {result.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-zinc-950/40">
                      {(result.columns || Object.keys(row)).map((col) => (
                        <td key={col} className="px-3 py-2 font-mono text-zinc-200 tabular-nums">
                          {String(row[col] ?? "-")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
