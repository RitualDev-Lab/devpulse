"use client";

import React, { useMemo, useState } from "react";
import {
  Wand2,
  Link2,
  KeyRound,
  CheckCircle2,
  Loader2,
  Sparkles,
  Copy,
  Check,
  Layers,
  X,
} from "lucide-react";
import { parseMultipleConnectorInputs } from "@/lib/integrations/url-parser";
import { STACK_PRESETS, type StackPresetId } from "@/lib/dashboard/presets";

interface QuickConnectPanelProps {
  projectId: string;
  projectSlug: string;
  telemetryApiKey: string;
  initialPreset?: string | null;
  hasNpmToken?: boolean;
  hasGithubToken?: boolean;
  isDemo?: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
}

export function QuickConnectPanel({
  projectId,
  projectSlug,
  telemetryApiKey,
  initialPreset = "saas",
  hasNpmToken = false,
  hasGithubToken = false,
  isDemo = false,
  onSuccess,
  onClose,
}: QuickConnectPanelProps) {
  const [linksText, setLinksText] = useState("");
  const [npmToken, setNpmToken] = useState(hasNpmToken ? "••••••••" : "");
  const [githubToken, setGithubToken] = useState(hasGithubToken ? "••••••••" : "");
  const [preset, setPreset] = useState<StackPresetId>(
    (initialPreset as StackPresetId) || "saas"
  );
  const [applyPresetWidgets, setApplyPresetWidgets] = useState(false);
  const [showTokens, setShowTokens] = useState(Boolean(hasNpmToken || hasGithubToken));
  const [saving, setSaving] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const detected = useMemo(() => parseMultipleConnectorInputs(linksText), [linksText]);
  const presetDef = STACK_PRESETS[preset] || STACK_PRESETS.saas;
  const snippetText = presetDef.buildSnippet(telemetryApiKey || "dp_live_your_key", projectSlug);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) {
      setFeedback({ ok: false, msg: "Sign in with GitHub to save live workspace connectors." });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/projects/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quick_connect",
          projectId,
          linksText,
          npmToken,
          githubToken,
          stackPreset: preset,
          applyPresetWidgets,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply quick connect");

      const summaryCount = Array.isArray(data.detectedSummary) ? data.detectedSummary.length : 0;
      setFeedback({
        ok: true,
        msg:
          summaryCount > 0
            ? `Connected ${summaryCount} source(s): ${data.detectedSummary.join(", ")}`
            : `Updated ${presetDef.name} preset & credentials.`,
      });
      setLinksText("");
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Connection failed" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleApply}
      className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-5 sm:p-6 space-y-5 shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
            <Wand2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>1-Screen Quick Connect Wizard</span>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                Paste Any URL
              </span>
            </h2>
            <p className="text-xs text-zinc-400">
              Paste GitHub, npm, PyPI, Crates, Docker Hub, Lemon Squeezy, Polar, or /health URLs — we auto-detect everything.
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Paste Any Link Box */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-cyan-400" />
          <span>Paste Any Ecosystem, Payment, or Health Endpoint Links (one per line)</span>
        </label>
        <textarea
          rows={3}
          value={linksText}
          onChange={(e) => setLinksText(e.target.value)}
          placeholder={`https://github.com/RitualDev-Lab/devpulse\nhttps://www.npmjs.com/package/@ritualdev/devpulse\nhttps://pypi.org/project/devpulse-sdk/\nhttps://devpulse.ritualdev.in/api/v1/monitors?projectId=prj_ritual_core`}
          className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />

        {detected.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {detected.map((d, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 font-mono"
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>{d.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Optional Registry / Repo Tokens */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowTokens(!showTokens)}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 hover:text-white transition"
        >
          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
          <span>
            {showTokens ? "Hide Optional API Keys" : "Add Optional npm API Key or GitHub Token (Private Packages & Daily Clones)"}
          </span>
        </button>

        {showTokens && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                npm Read Token (AES-256 Encrypted)
              </label>
              <input
                type="password"
                value={npmToken}
                onChange={(e) => setNpmToken(e.target.value)}
                placeholder="npm_xxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                GitHub PAT Override (Optional for Traffic/PRs)
              </label>
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
              />
            </div>
          </div>
        )}
      </div>

      {/* Role-Aware Stack Presets */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>Role-Aware Stack Preset</span>
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={applyPresetWidgets}
              onChange={(e) => setApplyPresetWidgets(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950 text-indigo-500"
            />
            <span>Reset Overview Grid to preset widgets</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {(Object.values(STACK_PRESETS)).map((item) => {
            const active = preset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreset(item.id)}
                className={`p-3 rounded-xl border text-left transition ${
                  active
                    ? "bg-indigo-600/15 border-indigo-500 shadow-sm shadow-indigo-500/20"
                    : "bg-zinc-950/70 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-xs font-bold text-white">{item.name}</span>
                </div>
                <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-indigo-300 border border-zinc-800 mb-1.5">
                  {item.badge}
                </span>
                <p className="text-[11px] text-zinc-400 leading-snug">{item.tagline}</p>
              </button>
            );
          })}
        </div>

        {/* Auto-tailored SDK Snippet */}
        <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Tailored Snippet: {presetDef.snippetTitle}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(snippetText);
                setCopiedSnippet(true);
                setTimeout(() => setCopiedSnippet(false), 1500);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
            >
              {copiedSnippet ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedSnippet ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <pre className="text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {snippetText}
          </pre>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs border ${
            feedback.ok
              ? "bg-emerald-950/50 border-emerald-700/60 text-emerald-200"
              : "bg-red-950/50 border-red-700/60 text-red-200"
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          <span>{saving ? "Connecting..." : "Save & Connect Automatically"}</span>
        </button>
      </div>
    </form>
  );
}
