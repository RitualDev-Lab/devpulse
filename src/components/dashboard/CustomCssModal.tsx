"use client";

import React, { useState } from "react";
import { Palette, X, Sparkles, Check } from "lucide-react";

interface CustomCssModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: string;
  onApplyTheme: (theme: string) => void;
  customCss: string;
  onSaveCustomCss: (css: string) => void;
}

const PRESET_THEMES = [
  { id: "dark", name: "DevPulse Dark", previewBg: "bg-zinc-950", accent: "border-zinc-700" },
  { id: "cyberpunk", name: "Cyber Neon", previewBg: "bg-fuchsia-950", accent: "border-fuchsia-500" },
  { id: "tokyo", name: "Tokyo Night", previewBg: "bg-blue-950", accent: "border-cyan-400" },
  { id: "matrix", name: "Emerald Matrix", previewBg: "bg-emerald-950", accent: "border-emerald-500" },
];

export function CustomCssModal({
  isOpen,
  onClose,
  currentTheme,
  onApplyTheme,
  customCss,
  onSaveCustomCss,
}: CustomCssModalProps) {
  const [cssCode, setCssCode] = useState(customCss);
  const [selectedTheme, setSelectedTheme] = useState(currentTheme);

  if (!isOpen) return null;

  const handleSave = () => {
    onApplyTheme(selectedTheme);
    onSaveCustomCss(cssCode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Dashboard Styling & Themes</h3>
              <p className="text-xs text-zinc-400">Customize your public & private view</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preset Themes */}
        <div className="mb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2">
            Preset Themes
          </span>
          <div className="grid grid-cols-2 gap-2.5">
            {PRESET_THEMES.map((theme) => (
              <button
                key={theme.id}
                onClick={() => setSelectedTheme(theme.id)}
                className={`p-3 rounded-xl border flex items-center justify-between transition ${
                  selectedTheme === theme.id
                    ? "bg-zinc-800 border-indigo-500 text-white shadow-md shadow-indigo-500/10"
                    : "bg-zinc-950/60 border-zinc-800 text-zinc-300 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-5 h-5 rounded-full ${theme.previewBg} border ${theme.accent}`}
                  ></div>
                  <span className="text-xs font-medium">{theme.name}</span>
                </div>
                {selectedTheme === theme.id && <Check className="w-4 h-4 text-indigo-400" />}
              </button>
            ))}
          </div>
        </div>

        {/* Custom CSS Editor */}
        <div className="flex-1 flex flex-col min-h-0 mb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2">
            Custom CSS Overrides
          </span>
          <textarea
            value={cssCode}
            onChange={(e) => setCssCode(e.target.value)}
            placeholder={`/* Add your custom styles here */\n.dashboard-card {\n  backdrop-filter: blur(20px);\n}`}
            className="w-full flex-1 min-h-[140px] p-3 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 resize-none"
          />
          <span className="text-[11px] text-zinc-500 mt-1">
            Overrides apply directly to all cards and metrics.
          </span>
        </div>

        <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-lg shadow-indigo-600/20"
          >
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
}
