"use client";

import React, { useMemo, useState } from "react";
import { ArrowRight, Check, Copy, Sparkles, Terminal } from "lucide-react";

function normalizeSlugFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "ritual-core";

  // Parse owner/repo from pasted next.ossinsight.io URL or GitHub slug
  const ossMatch = trimmed.match(/repo_name=([^&"'\s)]+)|github\.com\/([^/\s]+\/[^/\s?#]+)/i);
  const repoPath = decodeURIComponent(ossMatch?.[1] || ossMatch?.[2] || trimmed);
  const leaf = repoPath.split("/").filter(Boolean).pop() || repoPath;
  return (
    leaf
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-project"
  );
}

export function OssInsightConverterClient() {
  const [input, setInput] = useState(
    "https://next.ossinsight.io/widgets/official/analyze-repo-stars-history?repo_id=41986369&repo_name=RitualDev-Lab/devpulse"
  );
  const [customSlug, setCustomSlug] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const resolvedSlug = useMemo(
    () => (customSlug.trim() ? normalizeSlugFromInput(customSlug) : normalizeSlugFromInput(input)),
    [input, customSlug]
  );

  const shields = useMemo(() => {
    const base = "https://devpulse.ritualdev.in";
    return [
      {
        id: "stars",
        label: "GitHub Stars Badge",
        markdown: `[![DevPulse Stars](${base}/api/badge/stars/${resolvedSlug}.svg)](${base}/dashboard?demo=1)`,
        url: `${base}/api/badge/stars/${resolvedSlug}.svg`,
      },
      {
        id: "downloads",
        label: "Multi-Registry Downloads (npm + PyPI + Crates + Docker)",
        markdown: `[![DevPulse Downloads](${base}/api/badge/downloads/${resolvedSlug}.svg)](${base}/dashboard/packages?demo=1)`,
        url: `${base}/api/badge/downloads/${resolvedSlug}.svg`,
      },
      {
        id: "health",
        label: "Crash-Free Runtime Health Badge",
        markdown: `[![DevPulse Health](${base}/api/badge/health/${resolvedSlug}.svg)](${base}/dashboard/crashes?demo=1)`,
        url: `${base}/api/badge/health/${resolvedSlug}.svg`,
      },
      {
        id: "security",
        label: "OSV.dev & SBOM CVE Security Badge",
        markdown: `[![DevPulse Security](${base}/api/badge/security/${resolvedSlug}.svg)](${base}/dashboard/security?demo=1)`,
        url: `${base}/api/badge/security/${resolvedSlug}.svg`,
      },
    ];
  }, [resolvedSlug]);

  const copySnippet = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <div className="p-6 rounded-3xl bg-zinc-900/90 border border-zinc-800 space-y-5 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>1-Click OSSInsight URL &rarr; DevPulse Badge Converter</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Paste any frozen <code className="text-zinc-200">next.ossinsight.io</code> widget URL, GitHub URL, or <code className="text-zinc-200">owner/repo</code> slug below.
          </p>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Slug: {resolvedSlug}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
            OSSInsight Widget URL / GitHub Repo
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://next.ossinsight.io/widgets/...?repo_name=owner/repo"
            className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
            Override DevPulse Slug (optional)
          </label>
          <input
            type="text"
            value={customSlug}
            onChange={(e) => setCustomSlug(e.target.value)}
            placeholder="e.g. ritual-core"
            className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-white"
          />
        </div>
      </div>

      <div className="space-y-2.5">
        {shields.map((item) => (
          <div
            key={item.id}
            className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">{item.label}</span>
              <button
                type="button"
                onClick={() => copySnippet(item.id, item.markdown)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-200 transition"
              >
                {copiedKey === item.id ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>{copiedKey === item.id ? "Copied Markdown" : "Copy Markdown"}</span>
              </button>
            </div>
            <pre className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800/80 text-[11px] font-mono text-cyan-300 overflow-x-auto">
              {item.markdown}
            </pre>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800">
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
          <Terminal className="w-3.5 h-3.5 text-indigo-400" />
          <span>ETag cached at Cloudflare Edge &bull; No 14-day GitHub traffic truncation</span>
        </div>
        <a
          href="/dashboard?demo=1"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white transition"
        >
          <span>Try Live Demo Workspace</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
