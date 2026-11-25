"use client";

import React, { useState } from "react";
import { Palette, X, Check, Globe, Lock, Loader2 } from "lucide-react";
import { THEME_PRESETS, scopeCustomCss } from "@/lib/styling/themes";

interface CustomCssModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentTheme: string;
  customCss: string;
  isPublic: boolean;
  isDemo?: boolean;
  onSaved: (next: { theme: string; customCss: string; isPublic: boolean }) => void;
}

export function CustomCssModal(props: CustomCssModalProps) {
  if (!props.isOpen) return null;
  return <CustomCssModalInner key={`${props.projectId}_${props.currentTheme}_${props.isPublic}`} {...props} />;
}

function CustomCssModalInner({
  onClose,
  projectId,
  currentTheme,
  customCss,
  isPublic,
  isDemo = false,
  onSaved,
}: CustomCssModalProps) {
  const [cssCode, setCssCode] = useState(customCss);
  const [selectedTheme, setSelectedTheme] = useState(currentTheme || "dark");
  const [publicEnabled, setPublicEnabled] = useState(isPublic);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const previewScopedCss = scopeCustomCss(cssCode, ".devpulse-css-preview");

  const handleSave = async () => {
    setErrorMsg(null);
    if (isDemo) {
      onSaved({ theme: selectedTheme, customCss: cssCode, isPublic: publicEnabled });
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/projects/appearance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          theme: selectedTheme,
          customCss: cssCode,
          isPublic: publicEnabled,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "Failed to save styling");
      }
      onSaved({
        theme: json.theme || selectedTheme,
        customCss: json.customCss ?? cssCode,
        isPublic: typeof json.isPublic === "boolean" ? json.isPublic : publicEnabled,
      });
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to persist theme");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Dashboard Styling, Theme & Public Visibility</h3>
              <p className="text-xs text-zinc-400">Scoped to .devpulse-dashboard and persisted in Turso</p>
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
          {/* Public Dashboard Visibility */}
          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {publicEnabled ? (
                <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Lock className="w-4 h-4 text-zinc-500 shrink-0" />
              )}
              <div>
                <p className="text-xs font-semibold text-white">Public Shareable Dashboard</p>
                <p className="text-[11px] text-zinc-400">
                  Allow anyone with your link, subdomain, or custom domain to inspect live telemetry
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPublicEnabled((prev) => !prev)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition shrink-0 ${
                publicEnabled
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-zinc-900 border-zinc-700 text-zinc-400"
              }`}
            >
              {publicEnabled ? "Public" : "Private"}
            </button>
          </div>

          {/* Preset Themes */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2">
              Preset Themes
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {THEME_PRESETS.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setSelectedTheme(theme.id)}
                  className={`p-2.5 rounded-xl border flex items-center justify-between transition ${
                    selectedTheme === theme.id
                      ? "bg-zinc-800 border-indigo-500 text-white shadow-md shadow-indigo-500/10"
                      : "bg-zinc-950/60 border-zinc-800 text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full ${theme.previewBg} border ${theme.accent}`} />
                    <span className="text-xs font-medium">{theme.name}</span>
                  </div>
                  {selectedTheme === theme.id && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </button>
              ))}
            </div>
          </div>

          {/* Scoped Custom CSS Editor */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Scoped Custom CSS Editor
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                Target: .dashboard-card
              </span>
            </div>
            <textarea
              value={cssCode}
              onChange={(e) => setCssCode(e.target.value)}
              placeholder={`/* Automatically scoped under .devpulse-dashboard */\n.dashboard-card > div {\n  border-color: rgba(99, 102, 241, 0.5);\n  box-shadow: 0 0 24px rgba(99, 102, 241, 0.12);\n}`}
              className="w-full min-h-[130px] p-3 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 resize-y"
            />
          </div>

          {/* Live Scoped CSS Preview */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 block mb-1.5">
              Live Scoped Preview
            </span>
            {previewScopedCss && <style dangerouslySetInnerHTML={{ __html: previewScopedCss }} />}
            <div className="devpulse-css-preview p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="dashboard-card">
                <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">Sample Telemetry Widget</span>
                  <span className="font-mono text-emerald-400">8.1k/mo</span>
                </div>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-red-950/50 border border-red-800 text-red-300 text-xs">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="pt-3 mt-4 border-t border-zinc-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-lg shadow-indigo-600/20 disabled:opacity-60"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{saving ? "Saving..." : "Save & Apply"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
