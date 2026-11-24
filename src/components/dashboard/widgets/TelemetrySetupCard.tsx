"use client";

import React, { useState } from "react";
import { Copy, Check, Code2, Terminal, Key } from "lucide-react";
import { getPythonSnippet, getNodeSnippet, getRustSnippet, getCliSnippet } from "@/lib/sdk-generator";

interface TelemetrySetupCardProps {
  apiKey: string;
}

export function TelemetrySetupCard({ apiKey }: TelemetrySetupCardProps) {
  const [tab, setTab] = useState<"python" | "node" | "rust" | "cli">("python");
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const snippets: Record<"python" | "node" | "rust" | "cli", { file: string; code: string }> = {
    python: { file: "tracker.py", code: getPythonSnippet(apiKey) },
    node: { file: "tracker.js", code: getNodeSnippet(apiKey) },
    rust: { file: "panic_hook.rs", code: getRustSnippet(apiKey) },
    cli: { file: "beacon.sh", code: getCliSnippet(apiKey) },
  };

  const current = snippets[tab];

  const copyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(current.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight">
                Package Crash SDK
              </h3>
              <p className="text-xs text-zinc-400">Zero dependencies &bull; Auto R2 trace offload</p>
            </div>
          </div>
          <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-[11px]">
            {(
              [
                { id: "python", label: "Python", active: "bg-blue-600 text-white" },
                { id: "node", label: "Node", active: "bg-red-600 text-white" },
                { id: "rust", label: "Rust", active: "bg-orange-600 text-white" },
                { id: "cli", label: "CLI", active: "bg-zinc-700 text-white" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-2 py-1 rounded-lg transition font-medium ${
                  tab === t.id ? `${t.active} shadow-sm` : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* API Key Box */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 mb-3 text-xs">
          <div className="flex items-center gap-2 text-zinc-400 truncate">
            <Key className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-mono text-zinc-200 truncate">{apiKey}</span>
          </div>
          <button
            onClick={copyKey}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition shrink-0"
          >
            {copiedKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copiedKey ? "Copied" : "Copy Key"}</span>
          </button>
        </div>

        {/* Code Snippet */}
        <div className="relative rounded-xl bg-zinc-950/90 border border-zinc-800/80 p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-1.5 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1 font-mono text-zinc-300">
              <Terminal className="w-3.5 h-3.5 text-zinc-500" />
              {current.file}
            </span>
            <button
              onClick={copySnippet}
              className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition"
            >
              {copiedCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copiedCode ? "Copied Code" : "Copy Code"}</span>
            </button>
          </div>
          <pre className="text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-36 leading-relaxed select-text">
            {current.code}
          </pre>
        </div>
      </div>

      <div className="mt-3 pt-2 text-[11px] text-zinc-500 border-t border-zinc-800/40">
        Captures unhandled exceptions, OS, and offloads 100 KB+ logs to Cloudflare R2 automatically.
      </div>
    </div>
  );
}
