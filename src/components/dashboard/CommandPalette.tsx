"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutGrid,
  GitBranch,
  Package,
  BarChart3,
  Bug,
  HeartPulse,
  CreditCard,
  Settings,
  FolderGit2,
  Wand2,
  FileDown,
  GitPullRequest,
  ExternalLink,
  X,
} from "lucide-react";
import type { ProjectSummary } from "./ProjectWorkspaceSwitcher";

interface CommandItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject: ProjectSummary;
  projects: ProjectSummary[];
  isDemo?: boolean;
  onOpenQuickConnect: () => void;
  onOpenImport: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  currentProject,
  projects,
  isDemo = false,
  onOpenQuickConnect,
  onOpenImport,
}: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [ghMatches, setGhMatches] = useState<
    Array<{ number: number; title: string; type: "issue" | "pr"; htmlUrl: string }>
  >([]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setGhMatches([]);
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Live GitHub Issue/PR search when query starts with # or >= 2 chars
  useEffect(() => {
    if (!isOpen || isDemo || !currentProject.githubRepo) return;
    const trimmed = query.trim().replace(/^#/, "");
    if (trimmed.length < 2) {
      setGhMatches([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/github/manage?projectId=${encodeURIComponent(currentProject.id)}&q=${encodeURIComponent(trimmed)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const combined: Array<{ number: number; title: string; type: "issue" | "pr"; htmlUrl: string }> = [];
        for (const pr of (data.pulls || []).slice(0, 4)) {
          combined.push({ number: pr.number, title: pr.title, type: "pr", htmlUrl: pr.htmlUrl });
        }
        for (const iss of (data.issues || []).slice(0, 4)) {
          combined.push({ number: iss.number, title: iss.title, type: "issue", htmlUrl: iss.htmlUrl });
        }
        setGhMatches(combined);
      } catch {
        // non-fatal
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, isOpen, isDemo, currentProject.id, currentProject.githubRepo]);

  const qs = isDemo ? "?demo=1" : `?project=${encodeURIComponent(currentProject.slug)}`;

  const items: CommandItem[] = useMemo(() => {
    const baseItems: CommandItem[] = [
      { id: "nav-overview", group: "Workspace Pages", label: "Overview Grid", sublabel: "/dashboard", icon: LayoutGrid, action: () => router.push(`/dashboard${qs}`) },
      { id: "nav-github", group: "Workspace Pages", label: "GitHub & PR Manager", sublabel: "/dashboard/github", icon: GitBranch, action: () => router.push(`/dashboard/github${qs}`) },
      { id: "nav-packages", group: "Workspace Pages", label: "Packages & Daily Downloads", sublabel: "/dashboard/packages", icon: Package, action: () => router.push(`/dashboard/packages${qs}`) },
      { id: "nav-analytics", group: "Workspace Pages", label: "Daily Users & Telemetry", sublabel: "/dashboard/analytics", icon: BarChart3, action: () => router.push(`/dashboard/analytics${qs}`) },
      { id: "nav-crashes", group: "Workspace Pages", label: "Crash Stream & Source Maps", sublabel: "/dashboard/crashes", icon: Bug, action: () => router.push(`/dashboard/crashes${qs}`) },
      { id: "nav-uptime", group: "Workspace Pages", label: "Uptime & P95 Latency", sublabel: "/dashboard/uptime", icon: HeartPulse, action: () => router.push(`/dashboard/uptime${qs}`) },
      { id: "nav-revenue", group: "Workspace Pages", label: "Revenue, Payments & Plan", sublabel: "/dashboard/revenue", icon: CreditCard, action: () => router.push(`/dashboard/revenue${qs}`) },
      { id: "nav-settings", group: "Workspace Pages", label: "Settings, Quick Connect & Embeds", sublabel: "/dashboard/settings", icon: Settings, action: () => router.push(`/dashboard/settings${qs}`) },

      { id: "act-quick", group: "Quick Actions", label: "Open 1-Screen Quick Connect Wizard", sublabel: "Paste any URL or add npm/GitHub tokens", icon: Wand2, action: () => onOpenQuickConnect() },
      { id: "act-import", group: "Quick Actions", label: "Import GitHub Repository", sublabel: "Auto-scan manifests & preset", icon: FolderGit2, action: () => onOpenImport() },
      {
        id: "act-csv",
        group: "Quick Actions",
        label: "Export Weekly CSV Report",
        sublabel: "Download downloads, stars, uptime & crashes CSV",
        icon: FileDown,
        action: () => {
          window.open(`/api/v1/export?projectId=${encodeURIComponent(currentProject.id)}&format=csv`, "_blank");
        },
      },
      {
        id: "act-pdf",
        group: "Quick Actions",
        label: "Open Printable Weekly PDF Report",
        sublabel: "Save clean weekly executive summary as PDF",
        icon: FileDown,
        action: () => {
          window.open(`/api/v1/export?projectId=${encodeURIComponent(currentProject.id)}&format=report`, "_blank");
        },
      },
      {
        id: "act-embed",
        group: "Quick Actions",
        label: "Preview Public Metrics Embed Card",
        sublabel: `/embed/${currentProject.slug}`,
        icon: ExternalLink,
        action: () => {
          window.open(`/embed/${encodeURIComponent(currentProject.slug)}`, "_blank");
        },
      },
    ];

    const projectItems: CommandItem[] = projects.map((p) => ({
      id: `proj-${p.id}`,
      group: "Switch Project",
      label: p.name,
      sublabel: p.githubRepo || p.slug,
      icon: FolderGit2,
      action: () => router.push(`/dashboard?project=${encodeURIComponent(p.slug)}`),
    }));

    const ghItems: CommandItem[] = ghMatches.map((m) => ({
      id: `gh-${m.type}-${m.number}`,
      group: "GitHub Issues & PRs",
      label: `#${m.number} ${m.title}`,
      sublabel: m.type === "pr" ? "Open Pull Request on GitHub" : "Open Issue on GitHub",
      icon: GitPullRequest,
      action: () => window.open(m.htmlUrl, "_blank", "noopener,noreferrer"),
    }));

    const all = [...ghItems, ...baseItems, ...projectItems];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 14);
    return all.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.sublabel || "").toLowerCase().includes(q) ||
        it.group.toLowerCase().includes(q)
    );
  }, [query, qs, projects, ghMatches, currentProject.id, currentProject.slug, router, onOpenQuickConnect, onOpenImport]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items.length, query]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter" && items[selectedIndex]) {
      e.preventDefault();
      items[selectedIndex].action();
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <Search className="w-4 h-4 text-indigo-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to project, page, #PR, setting, or export..."
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {items.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No matching commands, projects, or GitHub items.
            </div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const selected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition ${
                    selected
                      ? "bg-indigo-600/25 border border-indigo-500/40 text-white"
                      : "text-zinc-300 hover:bg-zinc-800/70 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${selected ? "text-indigo-300" : "text-zinc-500"}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      {item.sublabel && (
                        <div className="text-[10px] font-mono text-zinc-500 truncate">{item.sublabel}</div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400 shrink-0">
                    {item.group}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
          <span>↑↓ Navigate &bull; ↵ Open</span>
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
}
