"use client";

import React, { useState } from "react";
import { Share2, X, Copy, Check, ExternalLink, Code2, Sparkles } from "lucide-react";

interface ShareEmbedModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  projectSlug: string;
  subdomain?: string | null;
  customDomain?: string | null;
  isPublic: boolean;
}

export function ShareEmbedModal({
  isOpen,
  onClose,
  projectName,
  projectSlug,
  subdomain,
  customDomain,
  isPublic,
}: ShareEmbedModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const publicUrl = customDomain
    ? `https://${customDomain}`
    : subdomain
      ? `https://${subdomain}.devpulse.ritualdev.in`
      : `https://devpulse.ritualdev.in/p/${projectSlug}`;

  const directPathUrl = `https://devpulse.ritualdev.in/p/${projectSlug}`;
  const cardBadgeMarkdown = `[![${projectName} Telemetry](https://devpulse.ritualdev.in/api/badge/card/${projectSlug}.svg)](${publicUrl})`;
  const downloadsBadgeMarkdown = `[![Downloads](https://devpulse.ritualdev.in/api/badge/downloads/${projectSlug}.svg)](${publicUrl}) [![Health](https://devpulse.ritualdev.in/api/badge/health/${projectSlug}.svg)](${publicUrl}) [![Stars](https://devpulse.ritualdev.in/api/badge/stars/${projectSlug}.svg)](${publicUrl})`;
  const iframeSnippet = `<iframe src="https://devpulse.ritualdev.in/p/${projectSlug}?embed=1" width="100%" height="680" style="border:0;border-radius:16px;overflow:hidden;" loading="lazy"></iframe>`;

  const copy = (key: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Share Public Dashboard &amp; Embeds</h3>
              <p className="text-xs text-zinc-400">
                Add live DevPulse SVG telemetry cards &amp; badges to your GitHub README
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-4 pr-1 flex-1">
          {!isPublic && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs">
              This project is currently set to <strong>Private</strong>. Toggle Public visibility in Theme / CSS to make external links accessible.
            </div>
          )}

          {/* Share URLs */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Public Telemetry URL
              </span>
              <a
                href={`/p/${projectSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
              >
                <span>Preview Public Page</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <code className="text-xs text-emerald-300 truncate">{publicUrl}</code>
              <button
                type="button"
                onClick={() => copy("publicUrl", publicUrl)}
                className="shrink-0 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-white flex items-center gap-1"
              >
                {copiedKey === "publicUrl" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey === "publicUrl" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            {publicUrl !== directPathUrl && (
              <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                <span className="truncate font-mono">{directPathUrl}</span>
                <button
                  type="button"
                  onClick={() => copy("directUrl", directPathUrl)}
                  className="text-indigo-400 hover:text-indigo-300 shrink-0"
                >
                  {copiedKey === "directUrl" ? "Copied!" : "Copy direct link"}
                </button>
              </div>
            )}
          </div>

          {/* Multi-Registry SVG Overview Card */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>README Live Telemetry Card (SVG)</span>
            </div>
            <pre className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto">
              {cardBadgeMarkdown}
            </pre>
            <button
              type="button"
              onClick={() => copy("card", cardBadgeMarkdown)}
              className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 inline-flex items-center gap-1.5"
            >
              {copiedKey === "card" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedKey === "card" ? "Copied Markdown" : "Copy Card Markdown"}</span>
            </button>
          </div>

          {/* Shields Badges Row */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block">
              Individual Shields SVG Badges
            </span>
            <pre className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto whitespace-pre-wrap">
              {downloadsBadgeMarkdown}
            </pre>
            <button
              type="button"
              onClick={() => copy("badges", downloadsBadgeMarkdown)}
              className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 inline-flex items-center gap-1.5"
            >
              {copiedKey === "badges" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedKey === "badges" ? "Copied Badges" : "Copy Badges Markdown"}</span>
            </button>
          </div>

          {/* Iframe Embed */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <Code2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Docs / Website Iframe Embed</span>
            </div>
            <pre className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto whitespace-pre-wrap">
              {iframeSnippet}
            </pre>
            <button
              type="button"
              onClick={() => copy("iframe", iframeSnippet)}
              className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 inline-flex items-center gap-1.5"
            >
              {copiedKey === "iframe" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedKey === "iframe" ? "Copied Iframe" : "Copy Iframe HTML"}</span>
            </button>
          </div>
        </div>

        <div className="pt-3 mt-4 border-t border-zinc-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
