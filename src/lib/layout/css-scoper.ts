/**
 * DevPulse Live Scoped Custom CSS Engine, Appearance Tokens & Preset Themes
 * Automatically scopes custom styles and presets cleanly across the entire dashboard shell
 * (sidebar, top header, cards, tables, and inputs) without breaking modals.
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

export interface AppearancePreferences {
  accent: string; // hex accent color e.g. #6366f1
  radius: "sharp" | "balanced" | "pill";
  density: "compact" | "comfortable" | "spacious";
  surface: "matte" | "glass" | "contrast";
  monoHeadings: boolean;
}

export const DEFAULT_APPEARANCE_PREFS: AppearancePreferences = {
  accent: "#6366f1",
  radius: "balanced",
  density: "comfortable",
  surface: "matte",
  monoHeadings: false,
};

export const ACCENT_SWATCHES = [
  { id: "indigo", label: "Indigo", hex: "#6366f1" },
  { id: "cyan", label: "Cyan", hex: "#06b6d4" },
  { id: "emerald", label: "Emerald", hex: "#10b981" },
  { id: "violet", label: "Violet", hex: "#8b5cf6" },
  { id: "rose", label: "Rose", hex: "#f43f5e" },
  { id: "amber", label: "Amber", hex: "#f59e0b" },
];

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
    id: "nord",
    name: "Nord Frost",
    description: "Cool polar night slate & frost cyan",
    previewBg: "#2e3440",
    previewCard: "#3b4252",
    accentBorder: "#88c0d0",
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    description: "Warm espresso slate & mauve highlights",
    previewBg: "#1e1e2e",
    previewCard: "#313244",
    accentBorder: "#cba6f7",
  },
  {
    id: "sunset",
    name: "Solar Sunset",
    description: "Deep charcoal with warm amber & rose glow",
    previewBg: "#120c10",
    previewCard: "#21151c",
    accentBorder: "#fb7185",
  },
  {
    id: "midnight_oled",
    name: "Midnight OLED",
    description: "Pure #000000 black with crisp hairline edges",
    previewBg: "#000000",
    previewCard: "#09090b",
    accentBorder: "#38bdf8",
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
  if (!theme || theme === "dark" || theme === "devpulse-dark") return "obsidian";
  if (theme === "tokyo-night") return "tokyo";
  if (theme === "cyber-neon") return "cyberpunk";
  if (theme === "emerald-matrix") return "matrix";
  if (PRESET_THEMES.some((t) => t.id === theme)) return theme;
  return "obsidian";
}

function buildDarkPaletteCss(opts: {
  id: string;
  shellBg: string;
  textColor: string;
  sidebarBg: string;
  headerBg: string;
  cardBg: string;
  innerBg: string;
  borderColor: string;
  subtleBorder: string;
  glowShadow?: string;
}): string {
  return `
    .devpulse-shell[data-theme="${opts.id}"] {
      background: ${opts.shellBg} !important;
      color: ${opts.textColor} !important;
    }
    .devpulse-shell[data-theme="${opts.id}"] aside.devpulse-sidebar {
      background-color: ${opts.sidebarBg} !important;
      border-color: ${opts.borderColor} !important;
    }
    .devpulse-shell[data-theme="${opts.id}"] header.devpulse-topbar {
      background-color: ${opts.headerBg} !important;
      border-color: ${opts.borderColor} !important;
    }
    .devpulse-shell[data-theme="${opts.id}"] .devpulse-workspace [class*="bg-zinc-900"] {
      background-color: ${opts.cardBg} !important;
      border-color: ${opts.borderColor} !important;
      ${opts.glowShadow ? `box-shadow: ${opts.glowShadow} !important;` : ""}
    }
    .devpulse-shell[data-theme="${opts.id}"] .devpulse-workspace [class*="bg-zinc-950"] {
      background-color: ${opts.innerBg} !important;
      border-color: ${opts.subtleBorder} !important;
    }
  `;
}

/**
 * Generates CSS rules for all built-in preset themes across shell, sidebar, header & workspace cards.
 */
export function getPresetThemeCss(themeId: string): string {
  const id = normalizeThemeId(themeId);
  switch (id) {
    case "tokyo":
      return buildDarkPaletteCss({
        id,
        shellBg: "#1a1b26",
        textColor: "#c0caf5",
        sidebarBg: "#16161e",
        headerBg: "rgba(22, 22, 30, 0.85)",
        cardBg: "rgba(36, 40, 59, 0.94)",
        innerBg: "rgba(22, 22, 30, 0.82)",
        borderColor: "rgba(65, 72, 104, 0.78)",
        subtleBorder: "rgba(65, 72, 104, 0.55)",
      });
    case "cyberpunk":
      return buildDarkPaletteCss({
        id,
        shellBg: "radial-gradient(circle at top right, #1f0638 0%, #090014 65%)",
        textColor: "#fae8ff",
        sidebarBg: "#0d021c",
        headerBg: "rgba(13, 2, 28, 0.85)",
        cardBg: "rgba(22, 5, 43, 0.9)",
        innerBg: "rgba(12, 2, 26, 0.82)",
        borderColor: "rgba(217, 70, 239, 0.42)",
        subtleBorder: "rgba(34, 211, 238, 0.28)",
        glowShadow: "0 0 24px rgba(217, 70, 239, 0.09)",
      });
    case "dracula":
      return buildDarkPaletteCss({
        id,
        shellBg: "#282a36",
        textColor: "#f8f8f2",
        sidebarBg: "#21222c",
        headerBg: "rgba(33, 34, 44, 0.88)",
        cardBg: "rgba(52, 55, 70, 0.94)",
        innerBg: "rgba(40, 42, 54, 0.86)",
        borderColor: "rgba(98, 114, 164, 0.55)",
        subtleBorder: "rgba(189, 147, 249, 0.28)",
      });
    case "matrix":
      return buildDarkPaletteCss({
        id,
        shellBg: "#020a05",
        textColor: "#d1fae5",
        sidebarBg: "#010804",
        headerBg: "rgba(1, 8, 4, 0.88)",
        cardBg: "rgba(4, 24, 13, 0.92)",
        innerBg: "rgba(2, 12, 6, 0.88)",
        borderColor: "rgba(16, 185, 129, 0.38)",
        subtleBorder: "rgba(16, 185, 129, 0.24)",
        glowShadow: "0 0 20px rgba(16, 185, 129, 0.08)",
      });
    case "nord":
      return buildDarkPaletteCss({
        id,
        shellBg: "#2e3440",
        textColor: "#eceff4",
        sidebarBg: "#272c36",
        headerBg: "rgba(39, 44, 54, 0.88)",
        cardBg: "rgba(59, 66, 82, 0.94)",
        innerBg: "rgba(46, 52, 64, 0.86)",
        borderColor: "rgba(136, 192, 208, 0.32)",
        subtleBorder: "rgba(76, 86, 106, 0.7)",
      });
    case "catppuccin":
      return buildDarkPaletteCss({
        id,
        shellBg: "#1e1e2e",
        textColor: "#cdd6f4",
        sidebarBg: "#181825",
        headerBg: "rgba(24, 24, 37, 0.88)",
        cardBg: "rgba(49, 50, 68, 0.92)",
        innerBg: "rgba(24, 24, 37, 0.82)",
        borderColor: "rgba(203, 166, 247, 0.3)",
        subtleBorder: "rgba(88, 91, 112, 0.55)",
      });
    case "sunset":
      return buildDarkPaletteCss({
        id,
        shellBg: "radial-gradient(circle at top right, #2e1320 0%, #120c10 65%)",
        textColor: "#ffe4e6",
        sidebarBg: "#0f090d",
        headerBg: "rgba(15, 9, 13, 0.88)",
        cardBg: "rgba(33, 21, 28, 0.92)",
        innerBg: "rgba(18, 12, 16, 0.86)",
        borderColor: "rgba(251, 113, 133, 0.32)",
        subtleBorder: "rgba(245, 158, 11, 0.25)",
      });
    case "midnight_oled":
      return buildDarkPaletteCss({
        id,
        shellBg: "#000000",
        textColor: "#f4f4f5",
        sidebarBg: "#000000",
        headerBg: "rgba(0, 0, 0, 0.9)",
        cardBg: "#09090b",
        innerBg: "#000000",
        borderColor: "#27272a",
        subtleBorder: "#18181b",
      });
    case "minimal_white":
      return `
        .devpulse-shell[data-theme="minimal_white"] {
          background-color: #f8fafc !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] aside.devpulse-sidebar {
          background-color: #ffffff !important;
          border-color: #e2e8f0 !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] aside.devpulse-sidebar .text-white {
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] aside.devpulse-sidebar [class*="text-zinc-400"],
        .devpulse-shell[data-theme="minimal_white"] aside.devpulse-sidebar [class*="text-zinc-300"],
        .devpulse-shell[data-theme="minimal_white"] aside.devpulse-sidebar [class*="text-zinc-200"] {
          color: #334155 !important;
        }
        .devpulse-shell[data-theme="minimal_white"] aside.devpulse-sidebar [class*="bg-zinc-900"] {
          background-color: #f1f5f9 !important;
          border-color: #cbd5e1 !important;
        }
        .devpulse-shell[data-theme="minimal_white"] header.devpulse-topbar {
          background-color: rgba(255, 255, 255, 0.92) !important;
          border-color: #e2e8f0 !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] header.devpulse-topbar .text-white {
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] header.devpulse-topbar [class*="bg-zinc-900"],
        .devpulse-shell[data-theme="minimal_white"] header.devpulse-topbar [class*="bg-zinc-800"] {
          background-color: #f1f5f9 !important;
          border-color: #cbd5e1 !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] header.devpulse-topbar button[class*="from-zinc-800"] {
          background: #18181b !important;
          border-color: #18181b !important;
          color: #ffffff !important;
        }
        .devpulse-shell[data-theme="minimal_white"] header.devpulse-topbar [class*="text-emerald-300"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-emerald-300"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-emerald-200"] {
          color: #047857 !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-cyan-300"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-indigo-300"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-purple-300"] {
          color: #3730a3 !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-amber-300"] {
          color: #b45309 !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace button.bg-indigo-600,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace button.bg-emerald-600,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace button.bg-red-600,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace a.bg-indigo-600,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace a.bg-emerald-600 {
          color: #ffffff !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="bg-zinc-900"] {
          background-color: #ffffff !important;
          border-color: #e2e8f0 !important;
          box-shadow: 0 2px 14px rgba(15, 23, 42, 0.05) !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="bg-zinc-950"] {
          background-color: #f8fafc !important;
          border-color: #cbd5e1 !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="bg-zinc-800"] {
          background-color: #f1f5f9 !important;
          border-color: #cbd5e1 !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace .text-white,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-100"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-200"] {
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-300"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-400"],
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace [class*="text-zinc-500"] {
          color: #475569 !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace input,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace select,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace textarea {
          background-color: #ffffff !important;
          border-color: #cbd5e1 !important;
          color: #0f172a !important;
        }
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace pre,
        .devpulse-shell[data-theme="minimal_white"] .devpulse-workspace .recharts-default-tooltip {
          background-color: #f8fafc !important;
          border-color: #cbd5e1 !important;
          color: #0f172a !important;
        }
        [data-theme="minimal_white"] .devpulse-modal-panel {
          background-color: #ffffff !important;
          border-color: #cbd5e1 !important;
          color: #0f172a !important;
        }
        [data-theme="minimal_white"] .devpulse-modal-panel .text-white,
        [data-theme="minimal_white"] .devpulse-modal-panel [class*="text-zinc-100"],
        [data-theme="minimal_white"] .devpulse-modal-panel [class*="text-zinc-200"] {
          color: #0f172a !important;
        }
        [data-theme="minimal_white"] .devpulse-modal-panel [class*="text-zinc-300"],
        [data-theme="minimal_white"] .devpulse-modal-panel [class*="text-zinc-400"],
        [data-theme="minimal_white"] .devpulse-modal-panel [class*="text-zinc-500"] {
          color: #475569 !important;
        }
        [data-theme="minimal_white"] .devpulse-modal-panel [class*="bg-zinc-950"],
        [data-theme="minimal_white"] .devpulse-modal-panel [class*="bg-zinc-900"],
        [data-theme="minimal_white"] .devpulse-modal-panel [class*="bg-zinc-800"],
        [data-theme="minimal_white"] .devpulse-modal-panel input,
        [data-theme="minimal_white"] .devpulse-modal-panel select,
        [data-theme="minimal_white"] .devpulse-modal-panel textarea {
          background-color: #f8fafc !important;
          border-color: #cbd5e1 !important;
          color: #0f172a !important;
        }
        [data-theme="minimal_white"] .devpulse-modal-panel button.bg-indigo-600,
        [data-theme="minimal_white"] .devpulse-modal-panel button.bg-emerald-600,
        [data-theme="minimal_white"] .devpulse-modal-panel button.bg-cyan-600,
        [data-theme="minimal_white"] .devpulse-modal-panel button.bg-purple-600,
        [data-theme="minimal_white"] .devpulse-modal-panel button.bg-red-600 {
          color: #ffffff !important;
        }
      `;
    case "obsidian":
    default:
      return "";
  }
}

export function getAppearancePrefsCss(prefs?: Partial<AppearancePreferences> | null): string {
  if (!prefs) return "";
  const rules: string[] = [];

  if (prefs.radius === "sharp") {
    rules.push(`
      .devpulse-workspace .rounded-2xl,
      .devpulse-workspace .devpulse-card > div {
        border-radius: 0.5rem !important;
      }
      .devpulse-workspace .rounded-xl {
        border-radius: 0.375rem !important;
      }
    `);
  } else if (prefs.radius === "pill") {
    rules.push(`
      .devpulse-workspace .rounded-2xl,
      .devpulse-workspace .devpulse-card > div {
        border-radius: 1.75rem !important;
      }
      .devpulse-workspace .rounded-xl {
        border-radius: 1.125rem !important;
      }
    `);
  }

  if (prefs.density === "compact") {
    rules.push(`
      .devpulse-workspace .p-5,
      .devpulse-workspace .p-6 {
        padding: 0.875rem !important;
      }
      .devpulse-workspace .space-y-6 > :not([hidden]) ~ :not([hidden]) {
        margin-top: 1rem !important;
      }
    `);
  } else if (prefs.density === "spacious") {
    rules.push(`
      .devpulse-workspace .p-5 {
        padding: 1.625rem !important;
      }
      .devpulse-workspace .space-y-6 > :not([hidden]) ~ :not([hidden]) {
        margin-top: 2rem !important;
      }
    `);
  }

  if (prefs.surface === "glass") {
    rules.push(`
      .devpulse-workspace .rounded-2xl {
        backdrop-filter: blur(16px) !important;
      }
    `);
  } else if (prefs.surface === "contrast") {
    rules.push(`
      .devpulse-workspace .rounded-2xl {
        border-width: 1.5px !important;
      }
    `);
  }

  if (prefs.monoHeadings) {
    rules.push(`
      .devpulse-workspace h1,
      .devpulse-workspace h2,
      .devpulse-workspace h3 {
        font-family: var(--font-geist-mono), ui-monospace, monospace !important;
        letter-spacing: -0.02em !important;
      }
    `);
  }

  if (prefs.accent && /^#[0-9a-f]{6}$/i.test(prefs.accent) && prefs.accent !== "#6366f1") {
    rules.push(`
      .devpulse-shell {
        --dp-accent: ${prefs.accent};
      }
      .devpulse-shell aside.devpulse-sidebar a[aria-current="page"],
      .devpulse-shell .devpulse-nav-active {
        border-color: ${prefs.accent}88 !important;
        background-color: ${prefs.accent}24 !important;
      }
      .devpulse-shell .devpulse-accent-btn {
        background: ${prefs.accent} !important;
        border-color: ${prefs.accent} !important;
      }
    `);
  }

  return rules.join("\n");
}

/**
 * Automatically scopes arbitrary user-authored CSS to `.devpulse-workspace`
 * so custom rules can style cards, typography, and widgets without breaking
 * top navigation bars or fullscreen modals.
 */
export function scopeCustomCss(rawCss: string, scopeSelector = ".devpulse-workspace"): string {
  if (!rawCss || !rawCss.trim()) return "";

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
    while (i < len && /\s/.test(css[i])) {
      output += css[i++];
    }
    if (i >= len) break;

    const braceStart = css.indexOf("{", i);
    if (braceStart === -1) break;

    const prelude = css.slice(i, braceStart).trim();

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
        output += `${prelude} {\n${scopeCssBlock(body, scopeSelector)}\n}\n`;
      } else if (lower.startsWith("@keyframes") || lower.startsWith("@-webkit-keyframes")) {
        output += `${prelude} {${body}}\n`;
      }
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
        });

      if (scopedSelectors.length > 0) {
        output += `${scopedSelectors.join(", ")} {${body}}\n`;
      }
    }

    i = j;
  }

  return output;
}
