"use client";

import React, { useState, useEffect } from "react";
import {
  Search,
  Loader2,
  Plus,
  Check,
  ExternalLink,
  Package,
} from "lucide-react";
import type { RegistrySearchResult, SearchableEcosystem } from "@/app/api/v1/registries/search/route";

export const REGISTRY_ECOSYSTEMS: Array<{
  id: SearchableEcosystem;
  label: string;
  field:
    | "pypiPackage"
    | "npmPackage"
    | "rustCrate"
    | "dockerImage"
    | "vscodeExtension"
    | "mcpServerName"
    | "goModule";
  placeholder: string;
  buildUrl: (name: string) => string;
}> = [
  {
    id: "npm",
    label: "npm",
    field: "npmPackage",
    placeholder: "Search npm packages (e.g. vite, zod, @scope/pkg)...",
    buildUrl: (n) => `https://www.npmjs.com/package/${n}`,
  },
  {
    id: "pypi",
    label: "PyPI",
    field: "pypiPackage",
    placeholder: "Enter exact PyPI package (e.g. fastapi, httpx)...",
    buildUrl: (n) => `https://pypi.org/project/${n}/`,
  },
  {
    id: "crates",
    label: "Crates.io",
    field: "rustCrate",
    placeholder: "Search Rust crates (e.g. serde, tokio)...",
    buildUrl: (n) => `https://crates.io/crates/${n}`,
  },
  {
    id: "vscode",
    label: "VS Code",
    field: "vscodeExtension",
    placeholder: "Search VS Code / Open-VSX extensions (e.g. eslint, python)...",
    buildUrl: (n) => {
      const parts = n.split(".");
      return parts.length >= 2
        ? `https://open-vsx.org/extension/${parts[0]}/${parts.slice(1).join(".")}`
        : `https://marketplace.visualstudio.com/items?itemName=${n}`;
    },
  },
  {
    id: "docker",
    label: "Docker",
    field: "dockerImage",
    placeholder: "Search Docker Hub images (e.g. nginx, postgres, myorg/app)...",
    buildUrl: (n) =>
      n.startsWith("library/")
        ? `https://hub.docker.com/_/${n.slice("library/".length)}`
        : `https://hub.docker.com/r/${n}`,
  },
  {
    id: "mcp",
    label: "MCP",
    field: "mcpServerName",
    placeholder: "Search MCP servers (e.g. github, postgres, devpulse)...",
    buildUrl: (n) => `https://smithery.ai/server/${n}`,
  },
  {
    id: "go",
    label: "Go",
    field: "goModule",
    placeholder: "Enter Go module path (e.g. github.com/gin-gonic/gin)...",
    buildUrl: (n) => `https://pkg.go.dev/${n}`,
  },
];

interface PackageSearchPickerProps {
  onSelectItem: (item: {
    ecosystem: SearchableEcosystem;
    field: (typeof REGISTRY_ECOSYSTEMS)[number]["field"];
    name: string;
    url: string;
  }) => Promise<void> | void;
  actionLabel?: string;
  selectedValues?: Partial<Record<(typeof REGISTRY_ECOSYSTEMS)[number]["field"], string | null | undefined>>;
  compact?: boolean;
}

export function PackageSearchPicker({
  onSelectItem,
  actionLabel = "Add",
  selectedValues = {},
  compact = false,
}: PackageSearchPickerProps) {
  const [ecosystem, setEcosystem] = useState<SearchableEcosystem>("npm");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistrySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const meta = REGISTRY_ECOSYSTEMS.find((e) => e.id === ecosystem) || REGISTRY_ECOSYSTEMS[0];
  const currentAssigned = selectedValues[meta.field] || null;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/v1/registries/search?ecosystem=${encodeURIComponent(ecosystem)}&q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          setResults(Array.isArray(data.results) ? data.results : []);
        } else {
          setResults([]);
        }
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ecosystem, query]);

  const handleChoose = async (name: string, url?: string | null) => {
    setBusyId(name);
    try {
      await onSelectItem({
        ecosystem,
        field: meta.field,
        name,
        url: url || meta.buildUrl(name),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {REGISTRY_ECOSYSTEMS.map((eco) => (
          <button
            key={eco.id}
            type="button"
            onClick={() => {
              setEcosystem(eco.id);
              setResults([]);
            }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
              ecosystem === eco.id
                ? "bg-emerald-600/20 border-emerald-500 text-emerald-300"
                : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            {eco.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={meta.placeholder}
          className="w-full pl-9 pr-9 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
        />
        {loading && (
          <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>

      <div
        className={`${compact ? "max-h-44" : "max-h-60"} overflow-y-auto divide-y divide-zinc-800/70 rounded-xl border border-zinc-800 bg-zinc-950/60`}
      >
        {query.trim().length < 2 ? (
          <div className="py-5 text-center text-xs text-zinc-500 px-4">
            Type at least 2 characters to search {meta.label} packages &amp; extensions.
          </div>
        ) : loading ? (
          <div className="py-5 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            <span>Searching {meta.label} registry...</span>
          </div>
        ) : results.length === 0 ? (
          <div className="p-3 flex items-center justify-between gap-2 text-xs">
            <span className="text-zinc-400 truncate">
              No public match — add <code className="text-zinc-200">{query.trim()}</code> manually?
            </span>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => handleChoose(query.trim())}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold"
            >
              Use &quot;{query.trim()}&quot;
            </button>
          </div>
        ) : (
          results.map((item) => {
            const isAdded =
              currentAssigned &&
              currentAssigned.toLowerCase() === item.name.toLowerCase();
            return (
              <div
                key={`${item.ecosystem}-${item.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-zinc-900/70 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Package className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-xs font-semibold text-white font-mono truncate">
                      {item.name}
                    </span>
                    {item.statsLabel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        {item.statsLabel}
                      </span>
                    )}
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-500 hover:text-zinc-300"
                        title="Open in registry"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                      {item.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={Boolean(isAdded) || busyId === item.name}
                  onClick={() => handleChoose(item.name, item.url)}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-400 text-[11px] font-semibold text-white flex items-center gap-1 transition"
                >
                  {busyId === item.name ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : isAdded ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  <span>{isAdded ? "Added" : actionLabel}</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
