"use client";

import React, { useState, useEffect } from "react";
import { MessageSquarePlus, Copy, Check, ExternalLink } from "lucide-react";

interface BugReportBadgeCardProps {
  projectSlug: string;
  projectName: string;
}

export function BugReportBadgeCard({ projectSlug, projectName }: BugReportBadgeCardProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedBadge, setCopiedBadge] = useState(false);
  const [origin, setOrigin] = useState("https://devpulse.rolenest.in");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const reportUrl = `${origin}/report/${projectSlug}`;
  const readmeBadge = `[![Report Issue](https://img.shields.io/badge/DevPulse-Report_Bug-red?style=flat-square&logo=github)](${reportUrl})`;

  const copyLink = () => {
    navigator.clipboard.writeText(reportUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyBadge = () => {
    navigator.clipboard.writeText(readmeBadge);
    setCopiedBadge(true);
    setTimeout(() => setCopiedBadge(false), 2000);
  };

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400">
              <MessageSquarePlus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight">
                Public Bug Report Hub
              </h3>
              <p className="text-xs text-zinc-400">For non-GitHub users to report package bugs</p>
            </div>
          </div>
          <a
            href={`/report/${projectSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-zinc-800"
            title="Open Public Report Page"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        <p className="text-xs text-zinc-300 mb-3">
          Users of your package on npm or PyPI often don't have GitHub accounts to open issues. Give them this 1-click form to paste logs or report crashes.
        </p>

        {/* Public Link Box */}
        <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 mb-2.5">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block mb-1">
            Direct Report URL
          </span>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono text-zinc-200 truncate" suppressHydrationWarning>{reportUrl}</span>
            <button
              onClick={copyLink}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition shrink-0"
            >
              {copiedLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedLink ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>

        {/* README.md Badge Box */}
        <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block mb-1">
            README.md Markdown Badge
          </span>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono text-zinc-400 truncate text-[11px]" suppressHydrationWarning>{readmeBadge}</span>
            <button
              onClick={copyBadge}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition shrink-0"
            >
              {copiedBadge ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedBadge ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2 text-[11px] text-zinc-500 border-t border-zinc-800/40">
        Reports submitted here land directly in your Telemetry stream above.
      </div>
    </div>
  );
}
