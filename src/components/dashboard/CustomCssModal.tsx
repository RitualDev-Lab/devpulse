"use client";

import React, { useState, useEffect } from "react";
import { Palette, X, Check, ShieldCheck, Sparkles, Loader2 } from "lucide-react";
import { PRESET_THEMES, normalizeThemeId, scopeCustomCss } from "@/lib/layout/css-scoper";

interface CustomCssModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentTheme: string;
  onApplyTheme: (theme: string) => void;
  customCss: string;
  onSaveCustomCss: (css: string) => void;
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
    label: "Mono Headings",
    css: `h3 {\n  font-family: ui-monospace, monospace !important;\n  letter-spacing: -0.03em !important;\n}`,
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
  isDemo = false,
}: CustomCssModalProps) {
  const [cssCode, setCssCode] = useState(customCss);
  const [selectedTheme, setSelectedTheme] = useState(normalizeThemeId(currentTheme));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCssCode(customCss);
      setSelectedTheme(normalizeThemeId(currentTheme));
    }
  }, [isOpen, customCss, currentTheme]);

  if (!isOpen) return null;

  const handleSelectTheme = (themeId: string) => {
    setSelectedTheme(themeId);
    onApplyTheme(themeId); // Live preview immediately
  };

  const handleCssChange = (val: string) => {
    setCssCode(val);
    onSaveCustomCss(val); // Live scoped CSS preview immediately
  };

  const handleSave = async () => {
    onApplyTheme(selectedTheme);
    onSaveCustomCss(cssCode);

    if (isDemo) {
      try {
        localStorage.setItem(`devpulse_theme_${projectId}`, selectedTheme);
        localStorage.setItem(`devpulse_css_${projectId}`, cssCode);
      } catch {
        // ignore
      }
      onClose();
      return;
    }

    setSaving(true);
    try {
      await fetch("/api/v1/projects/styling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          theme: selectedTheme,
          customCss: cssCode,
        }),
      });
    } catch {
      // keep local state even if network glitches
    } finally {
      setSaving(false);
      onClose();
    }
  };

  const scopedRuleCount = scopeCustomCss(cssCode) ? (cssCode.match(/\{/g) || []).length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Theme Switcher & Scoped CSS Studio</h3>
              <p className="text-xs text-zinc-400">
                1-click presets & live CSS scoped safely inside <code className="text-indigo-300">.devpulse-workspace</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 space-y-5">
          {/* 6 Preset Themes Grid */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2.5">
              Preset Themes (6 Built-In)
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
                      <div className="text-[10px] text-zinc-500 line-clamp-1">{theme.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
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
              className="w-full min-h-[150px] p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 resize-y leading-relaxed"
            />

            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Auto-scoped to <code className="text-zinc-300">.devpulse-workspace</code> — header &amp; modals are protected.
                </span>
              </span>
              <span className="font-mono text-zinc-500">{scopedRuleCount} rules active</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-zinc-800 flex justify-between items-center gap-2">
          <button
            type="button"
            onClick={() => {
              handleSelectTheme("obsidian");
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
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{saving ? "Saving..." : "Save & Apply"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
