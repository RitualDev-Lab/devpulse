"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Palette,
  X,
  Check,
  ShieldCheck,
  Sparkles,
  Loader2,
  AlertCircle,
  SlidersHorizontal,
} from "lucide-react";
import { ModalShell } from "./ModalShell";
import { getProjectStorageKey } from "@/lib/storage-keys";
import {
  ACCENT_SWATCHES,
  DEFAULT_APPEARANCE_PREFS,
  PRESET_THEMES,
  normalizeThemeId,
  scopeCustomCss,
  type AppearancePreferences,
} from "@/lib/layout/css-scoper";

interface CustomCssModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentTheme: string;
  onApplyTheme: (theme: string) => void;
  customCss: string;
  onSaveCustomCss: (css: string) => void;
  appearancePrefs?: AppearancePreferences;
  onSaveAppearancePrefs?: (prefs: AppearancePreferences) => void;
  isDemo?: boolean;
}

const CSS_SNIPPETS = [
  {
    label: "Neon Borders",
    css: `.devpulse-card > div {\n  border-color: rgba(139, 92, 246, 0.45) !important;\n  box-shadow: 0 0 24px rgba(139, 92, 246, 0.12) !important;\n}`,
  },
  {
    label: "Pill Cards (2rem)",
    css: `.devpulse-card > div {\n  border-radius: 2rem !important;\n}`,
  },
  {
    label: "Gradient Hero Cards",
    css: `.rounded-2xl {\n  background-image: linear-gradient(145deg, rgba(99,102,241,0.06), transparent 60%) !important;\n}`,
  },
  {
    label: "Mono Headings",
    css: `h1, h2, h3 {\n  font-family: ui-monospace, monospace !important;\n  letter-spacing: -0.03em !important;\n}`,
  },
];

export function CustomCssModal({
  isOpen,
  onClose,
  projectId,
  currentTheme,
  onApplyTheme,
  customCss,
  onSaveCustomCss,
  appearancePrefs = DEFAULT_APPEARANCE_PREFS,
  onSaveAppearancePrefs,
  isDemo = false,
}: CustomCssModalProps) {
  const router = useRouter();
  const [cssCode, setCssCode] = useState(customCss);
  const [selectedTheme, setSelectedTheme] = useState(normalizeThemeId(currentTheme));
  const [prefs, setPrefs] = useState<AppearancePreferences>(appearancePrefs);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCssCode(customCss);
      setSelectedTheme(normalizeThemeId(currentTheme));
      setPrefs(appearancePrefs);
      setErrorMsg(null);
    }
  }, [isOpen, customCss, currentTheme, appearancePrefs]);

  if (!isOpen) return null;

  const handleSelectTheme = (themeId: string) => {
    setSelectedTheme(themeId);
    setErrorMsg(null);
    try {
      document.cookie = `dp_theme=${encodeURIComponent(themeId)}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.setAttribute("data-theme", themeId);
    } catch {
      // ignore
    }
    onApplyTheme(themeId);
  };

  const handleUpdatePrefs = (patch: Partial<AppearancePreferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (onSaveAppearancePrefs) {
      onSaveAppearancePrefs(next);
    }
    try {
      localStorage.setItem(getProjectStorageKey("prefs", projectId, isDemo), JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleCssChange = (val: string) => {
    setCssCode(val);
    setErrorMsg(null);
    onSaveCustomCss(val);
  };

  const handleSave = async () => {
    setErrorMsg(null);
    onApplyTheme(selectedTheme);
    onSaveCustomCss(cssCode);
    if (onSaveAppearancePrefs) onSaveAppearancePrefs(prefs);

    try {
      localStorage.setItem(getProjectStorageKey("theme", projectId, isDemo), selectedTheme);
      localStorage.setItem(getProjectStorageKey("css", projectId, isDemo), cssCode);
      localStorage.setItem(getProjectStorageKey("prefs", projectId, isDemo), JSON.stringify(prefs));
    } catch {
      // ignore
    }

    if (isDemo) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/projects/styling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          theme: selectedTheme,
          customCss: cssCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to save styling preferences.");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setErrorMsg("Network error saving styling preferences.");
    } finally {
      setSaving(false);
    }
  };

  const scopedRuleCount = scopeCustomCss(cssCode) ? (cssCode.match(/\{/g) || []).length : 0;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} maxWidthClass="max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Theme, Appearance &amp; CSS Studio</h3>
              <p className="text-xs text-zinc-400">
                10 themes, live accent/density/radius controls &amp; safe CSS scoped to{" "}
                <code className="text-indigo-300">.devpulse-workspace</code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 space-y-5">
          {/* 10 Preset Themes Grid */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2.5">
              Preset Themes ({PRESET_THEMES.length} Built-In)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {PRESET_THEMES.map((theme) => {
                const active = selectedTheme === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => handleSelectTheme(theme.id)}
                    data-theme-option={theme.id}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between gap-2 ${
                      active
                        ? "bg-zinc-800 border-indigo-500 text-white shadow-md shadow-indigo-500/15"
                        : "bg-zinc-950/60 border-zinc-800 text-zinc-300 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-4 h-4 rounded-full border"
                          style={{ backgroundColor: theme.previewBg, borderColor: theme.accentBorder }}
                        />
                        <span
                          className="w-3 h-3 rounded-full -ml-2.5 border"
                          style={{ backgroundColor: theme.previewCard, borderColor: theme.accentBorder }}
                        />
                      </div>
                      {active && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                    </div>
                    <div>
                      <div className="text-xs font-semibold">{theme.name}</div>
                      <div className="text-[10px] text-zinc-400 line-clamp-1">{theme.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Layout & Visual Tokens */}
          <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
              <span>Workspace Appearance Customization</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[11px] text-zinc-400 mb-1.5">Accent Highlight</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {ACCENT_SWATCHES.map((sw) => (
                    <button
                      key={sw.id}
                      type="button"
                      onClick={() => handleUpdatePrefs({ accent: sw.hex })}
                      title={sw.label}
                      className={`w-6 h-6 rounded-full border-2 transition ${
                        prefs.accent === sw.hex ? "border-white scale-110" : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: sw.hex }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-zinc-400 mb-1.5">Card Corner Radius</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["sharp", "balanced", "pill"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleUpdatePrefs({ radius: r })}
                      className={`px-2 py-1 rounded-lg border capitalize font-medium transition ${
                        prefs.radius === r
                          ? "bg-indigo-600 text-white border-indigo-500"
                          : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-zinc-400 mb-1.5">Layout Density</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["compact", "comfortable", "spacious"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleUpdatePrefs({ density: d })}
                      className={`px-2 py-1 rounded-lg border capitalize font-medium transition ${
                        prefs.density === d
                          ? "bg-indigo-600 text-white border-indigo-500"
                          : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-zinc-400 mb-1.5">Card Surface Style</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["matte", "glass", "contrast"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleUpdatePrefs({ surface: s })}
                      className={`px-2 py-1 rounded-lg border capitalize font-medium transition ${
                        prefs.surface === s
                          ? "bg-indigo-600 text-white border-indigo-500"
                          : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-zinc-300 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.monoHeadings}
                onChange={(e) => handleUpdatePrefs({ monoHeadings: e.target.checked })}
                className="rounded border-zinc-700"
              />
              <span>Use monospace typography for dashboard headings</span>
            </label>
          </div>

          {/* Live Scoped Custom CSS Editor */}
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Scoped Custom CSS</span>
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {CSS_SNIPPETS.map((snip) => (
                  <button
                    key={snip.label}
                    type="button"
                    onClick={() => handleCssChange(cssCode ? `${cssCode}\n\n${snip.css}` : snip.css)}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
                  >
                    + {snip.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={cssCode}
              onChange={(e) => handleCssChange(e.target.value)}
              placeholder={`/* Automatically scoped inside .devpulse-workspace */\n.devpulse-card > div {\n  border-radius: 1.5rem;\n}`}
              className="w-full min-h-[120px] p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 resize-y leading-relaxed"
            />

            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Auto-scoped to <code className="text-zinc-300">.devpulse-workspace</code> — header &amp; modals stay protected.
                </span>
              </span>
              <span className="font-mono text-zinc-500">{scopedRuleCount} rules active</span>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-zinc-800 flex justify-between items-center gap-2">
          <button
            type="button"
            onClick={() => {
              handleSelectTheme("obsidian");
              handleUpdatePrefs(DEFAULT_APPEARANCE_PREFS);
              handleCssChange("");
            }}
            className="px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs transition"
          >
            Reset Theme &amp; CSS
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-lg shadow-indigo-600/20 flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>{saving ? "Saving..." : isDemo ? "Apply Preview" : "Save Appearance"}</span>
            </button>
          </div>
        </div>
    </ModalShell>
  );
}
