/**
 * DevPulse Live Scoped Custom CSS Engine & Preset Themes
 * Ensures user-authored CSS is automatically scoped to `.devpulse-workspace`
 * so custom styles enhance cards/metrics without breaking navigation or modals.
 */

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  previewBg: string;
  previewCard: string;
  accentBorder: string;
  isLight?: boolean;
}

export const PRESET_THEMES: ThemePreset[] = [
  {
    id: "obsidian",
    name: "Obsidian Dark",
    description: "Default deep matte zinc & indigo accents",
    previewBg: "#09090b",
    previewCard: "#18181b",
    accentBorder: "#6366f1",
  },
  {
    id: "tokyo",
    name: "Tokyo Night",
    description: "Midnight indigo storm with cyan highlights",
    previewBg: "#1a1b26",
    previewCard: "#24283b",
    accentBorder: "#7aa2f7",
  },
  {
    id: "cyberpunk",
    name: "Cyber Neon",
    description: "Synthwave void with neon magenta glow",
    previewBg: "#090014",
    previewCard: "#16052b",
    accentBorder: "#e879f9",
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Iconic dark slate with orchid & cyan",
    previewBg: "#282a36",
    previewCard: "#343746",
    accentBorder: "#bd93f9",
  },
  {
    id: "matrix",
    name: "Emerald Matrix",
    description: "Terminal black with phosphor green grid",
    previewBg: "#020a05",
    previewCard: "#051b0e",
    accentBorder: "#10b981",
  },
  {
    id: "minimal_white",
    name: "Minimal White",
    description: "Clean crisp studio light mode",
    previewBg: "#f8fafc",
    previewCard: "#ffffff",
    accentBorder: "#4f46e5",
    isLight: true,
  },
];

export function normalizeThemeId(theme?: string | null): string {
  if (!theme || theme === "dark") return "obsidian";
  if (PRESET_THEMES.some((t) => t.id === theme)) return theme;
  return "obsidian";
}

/**
 * Generates CSS rules for all 6 preset themes scoped to `.devpulse-theme-{id}`
 * inside `.devpulse-workspace`, preserving header & modal layout integrity.
 */
export function getPresetThemeCss(themeId: string): string {
  const id = normalizeThemeId(themeId);
  switch (id) {
    case "tokyo":
      return `
        .devpulse-shell[data-theme="tokyo"] {
          background-color: #1a1b26 !important;
          color: #c0caf5 !important;
        }
        .devpulse-shell[data-theme="tokyo"] .devpulse-workspace [class*="bg-zinc-900"] {
          background-color: rgba(36, 40, 59, 0.92) !important;
          border-color: rgba(65, 72, 104, 0.75) !important;
        }
        .devpulse-shell[data-theme="tokyo"] .devpulse-workspace [class*="bg-zinc-950"] {
          background-color: rgba(22, 22, 30, 0.75) !important;
          border-color: rgba(65, 72, 104, 0.5) !important;
        }
      `;
    case "cyberpunk":
      return `
        .devpulse-shell[data-theme="cyberpunk"] {
          background: radial-gradient(circle at top right, #1f0638 0%, #090014 60%) !important;
          color: #fae8ff !important;
        }
        .devpulse-shell[data-theme="cyberpunk"] .devpulse-workspace [class*="bg-zinc-900"] {
          background-color: rgba(22, 5, 43, 0.88) !important;
          border-color: rgba(217, 70, 239, 0.38) !important;
          box-shadow: 0 0 24px rgba(217, 70, 239, 0.08) !important;
        }
        .devpulse-shell[data-theme="cyberpunk"] .devpulse-workspace [class*="bg-zinc-950"] {
          background-color: rgba(12, 2, 26, 0.78) !important;
          border-color: rgba(34, 211, 238, 0.25) !important;
        }
      `;
    case "dracula":
      return `
        .devpulse-shell[data-theme="dracula"] {
          background-color: #282a36 !important;
          color: #f8f8f2 !important;
        }
        .devpulse-shell[data-theme="dracula"] .devpulse-workspace [class*="bg-zinc-900"] {
          background-color: rgba(52, 55, 70, 0.94) !important;
          border-color: rgba(98, 114, 164, 0.55) !important;
        }
        .devpulse-shell[data-theme="dracula"] .devpulse-workspace [class*="bg-zinc-950"] {
          background-color: rgba(40, 42, 54, 0.85) !important;
          border-color: rgba(189, 147, 249, 0.25) !important;
        }
      `;
    case "matrix":
      return `
        .devpulse-shell[data-theme="matrix"] {
          background-color: #020a05 !important;
          color: #d1fae5 !important;
        }
        .devpulse-shell[data-theme="matrix"] .devpulse-workspace [class*="bg-zinc-900"] {
          background-color: rgba(4, 24, 13, 0.9) !important;
          border-color: rgba(16, 185, 129, 0.35) !important;
          box-shadow: 0 0 20px rgba(16, 185, 129, 0.07) !important;
        }
        .devpulse-shell[data-theme="matrix"] .devpulse-workspace [class*="bg-zinc-950"] {
          background-color: rgba(2, 12, 6, 0.85) !important;
          border-color: rgba(16, 185, 129, 0.22) !important;
        }
      `;
    case "minimal_white":
      return `
        .devpulse-shell[data-theme="minimal_white"] {
          background-color: #f8fafc !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] header {
          background-color: rgba(255, 255, 255, 0.9) !important;
          border-color: #e2e8f0 !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="bg-zinc-900"] {
          background-color: #ffffff !important;
          border-color: #e2e8f0 !important;
          box-shadow: 0 4px 20px rgba(15, 23, 42, 0.05) !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="bg-zinc-950"] {
          background-color: #f1f5f9 !important;
          border-color: #e2e8f0 !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace .text-white,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-100"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-200"] {
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-300"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-400"] {
          color: #475569 !important;
        }
      `;
    case "obsidian":
    default:
      return "";
  }
}

/**
 * Automatically scopes arbitrary user-authored CSS to `.devpulse-workspace`
 * so custom rules can style cards, typography, and widgets without breaking
 * top navigation bars or fullscreen modals.
 */
export function scopeCustomCss(rawCss: string, scopeSelector = ".devpulse-workspace"): string {
  if (!rawCss || !rawCss.trim()) return "";

  // 1. Strip any attempt to close the <style> tag, inject markup, or load external @import stylesheets
  const sanitized = rawCss
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<\/?(?:style|script)[^>]*>/gi, "")
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "blocked(")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  return scopeCssBlock(sanitized, scopeSelector);
}

function scopeCssBlock(css: string, scopeSelector: string): string {
  let output = "";
  let i = 0;
  const len = css.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(css[i])) {
      output += css[i++];
    }
    if (i >= len) break;

    // Read until `{`
    const braceStart = css.indexOf("{", i);
    if (braceStart === -1) break;

    const prelude = css.slice(i, braceStart).trim();

    // Find matching closing `}`
    let depth = 1;
    let j = braceStart + 1;
    while (j < len && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }

    const body = css.slice(braceStart + 1, j - 1);

    if (prelude.startsWith("@")) {
      const lower = prelude.toLowerCase();
      if (lower.startsWith("@media") || lower.startsWith("@supports") || lower.startsWith("@container")) {
        // Recursively scope rules inside media/supports blocks
        output += `${prelude} {\n${scopeCssBlock(body, scopeSelector)}\n}\n`;
      } else if (lower.startsWith("@keyframes") || lower.startsWith("@-webkit-keyframes")) {
        // Keep keyframes unscoped
        output += `${prelude} {${body}}\n`;
      }
      // Ignore @import for security
    } else if (prelude) {
      const scopedSelectors = prelude
        .split(",")
        .map((sel) => sel.trim())
        .filter(Boolean)
        .map((sel) => {
          if (sel.startsWith(scopeSelector)) return sel;
          if (/^(body|html|:root)$/i.test(sel)) return scopeSelector;
          if (/^(body|html|:root)\s+/i.test(sel)) {
            return sel.replace(/^(body|html|:root)\s+/i, `${scopeSelector} `);
          }
          return `${scopeSelector} ${sel}`;
        })
        .join(", ");

      if (scopedSelectors) {
        output += `${scopedSelectors} {${body}}\n`;
      }
    }

    i = j;
  }

  return output.trim();
}
