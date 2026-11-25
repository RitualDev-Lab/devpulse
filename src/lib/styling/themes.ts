export interface ThemePreset {
  id: string;
  name: string;
  previewBg: string;
  accent: string;
  wrapperClass: string;
  varsCss: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "dark",
    name: "DevPulse Dark",
    previewBg: "bg-zinc-950",
    accent: "border-zinc-700",
    wrapperClass: "bg-zinc-950 text-zinc-100",
    varsCss: `
      --dp-bg: #09090b;
      --dp-card-bg: rgba(24, 24, 27, 0.9);
      --dp-card-border: rgba(39, 39, 42, 0.85);
      --dp-accent: #6366f1;
    `,
  },
  {
    id: "cyberpunk",
    name: "Cyber Neon",
    previewBg: "bg-fuchsia-950",
    accent: "border-fuchsia-500",
    wrapperClass: "bg-[#0d051a] text-fuchsia-50",
    varsCss: `
      --dp-bg: #0d051a;
      --dp-card-bg: rgba(32, 11, 56, 0.82);
      --dp-card-border: rgba(217, 70, 239, 0.35);
      --dp-accent: #ec4899;
    `,
  },
  {
    id: "tokyo",
    name: "Tokyo Night",
    previewBg: "bg-blue-950",
    accent: "border-cyan-400",
    wrapperClass: "bg-[#0f172a] text-slate-100",
    varsCss: `
      --dp-bg: #0f172a;
      --dp-card-bg: rgba(15, 23, 42, 0.88);
      --dp-card-border: rgba(56, 189, 248, 0.28);
      --dp-accent: #38bdf8;
    `,
  },
  {
    id: "matrix",
    name: "Emerald Matrix",
    previewBg: "bg-emerald-950",
    accent: "border-emerald-500",
    wrapperClass: "bg-[#02120a] text-emerald-50",
    varsCss: `
      --dp-bg: #02120a;
      --dp-card-bg: rgba(4, 28, 16, 0.88);
      --dp-card-border: rgba(16, 185, 129, 0.32);
      --dp-accent: #10b981;
    `,
  },
  {
    id: "minimal",
    name: "Carbon Slate",
    previewBg: "bg-slate-900",
    accent: "border-slate-500",
    wrapperClass: "bg-[#111318] text-slate-100",
    varsCss: `
      --dp-bg: #111318;
      --dp-card-bg: rgba(25, 29, 36, 0.92);
      --dp-card-border: rgba(148, 163, 184, 0.22);
      --dp-accent: #818cf8;
    `,
  },
];

export function getThemePreset(themeId?: string | null): ThemePreset {
  return THEME_PRESETS.find((t) => t.id === themeId) || THEME_PRESETS[0];
}

export function buildThemeCss(themeId?: string | null): string {
  const preset = getThemePreset(themeId);
  return `
.devpulse-dashboard {
  ${preset.varsCss}
}
.devpulse-dashboard .dashboard-card > div {
  background-color: var(--dp-card-bg);
  border-color: var(--dp-card-border);
}
`.trim();
}

/**
 * Strips potentially dangerous constructs before storing or rendering user CSS.
 */
export function sanitizeCustomCss(rawCss: string): string {
  if (!rawCss || typeof rawCss !== "string") return "";
  return rawCss
    .slice(0, 12000)
    .replace(/<\/?style[^>]*>/gi, "")
    .replace(/<\/?script[^>]*>/gi, "")
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "blocked(")
    .replace(/javascript\s*:/gi, "blocked:")
    .trim();
}

/**
 * Scopes user CSS selectors inside `.devpulse-dashboard` so dashboard overrides
 * cannot leak into top-level navigation bars or modal dialogs.
 */
export function scopeCustomCss(rawCss: string, scope = ".devpulse-dashboard"): string {
  const safe = sanitizeCustomCss(rawCss);
  if (!safe) return "";

  // Strip CSS comments temporarily only to check structure safely
  const uncommented = safe.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!uncommented) return safe;

  // Split top-level blocks and prefix selectors unless inside @media / @keyframes
  let out = "";
  let i = 0;
  while (i < uncommented.length) {
    const openBrace = uncommented.indexOf("{", i);
    if (openBrace === -1) {
      const trailing = uncommented.slice(i).trim();
      if (trailing && trailing.includes(":")) {
        out += `${scope} { ${trailing} }\n`;
      }
      break;
    }

    const header = uncommented.slice(i, openBrace).trim();
    // Find matching closing brace accounting for nested blocks
    let depth = 1;
    let cursor = openBrace + 1;
    while (cursor < uncommented.length && depth > 0) {
      if (uncommented[cursor] === "{") depth++;
      else if (uncommented[cursor] === "}") depth--;
      cursor++;
    }

    const body = uncommented.slice(openBrace + 1, cursor - 1).trim();
    i = cursor;

    if (!header) continue;

    if (header.startsWith("@keyframes") || header.startsWith("@font-face")) {
      out += `${header} {\n${body}\n}\n`;
    } else if (header.startsWith("@media") || header.startsWith("@supports") || header.startsWith("@container")) {
      out += `${header} {\n${scopeCustomCss(body, scope)}\n}\n`;
    } else {
      const scopedSelectors = header
        .split(",")
        .map((sel) => sel.trim())
        .filter(Boolean)
        .map((sel) => {
          if (sel === scope || sel.startsWith(`${scope} `) || sel.startsWith(`${scope}.`) || sel.startsWith(`${scope}[`)) {
            return sel;
          }
          if (sel === ":root" || sel === "body" || sel === "html") {
            return scope;
          }
          return `${scope} ${sel}`;
        })
        .join(", ");

      if (scopedSelectors) {
        out += `${scopedSelectors} {\n${body}\n}\n`;
      }
    }
  }

  return out.trim();
}
