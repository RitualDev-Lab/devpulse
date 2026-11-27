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

export type PrimarySearchField =
  | "pypiPackage"
  | "npmPackage"
  | "rustCrate"
  | "dockerImage"
  | "vscodeExtension"
  | "mcpServerName"
  | "goModule";

export const REGISTRY_ECOSYSTEMS: Array<{
  id: SearchableEcosystem;
  label: string;
  field: PrimarySearchField | null;
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
  {
    id: "nuget",
    label: "NuGet (.NET)",
    field: null,
    placeholder: "Search NuGet packages (e.g. Newtonsoft.Json, Serilog)...",
    buildUrl: (n) => `https://www.nuget.org/packages/${encodeURIComponent(n)}`,
  },
  {
    id: "rubygems",
    label: "RubyGems",
    field: null,
    placeholder: "Search Ruby gems (e.g. rails, sidekiq, puma)...",
    buildUrl: (n) => `https://rubygems.org/gems/${encodeURIComponent(n)}`,
  },
  {
    id: "packagist",
    label: "Packagist (PHP)",
    field: null,
    placeholder: "Search Composer packages (e.g. laravel/framework, symfony/http-kernel)...",
    buildUrl: (n) => `https://packagist.org/packages/${n}`,
  },
  {
    id: "pubdev",
    label: "pub.dev (Flutter)",
    field: null,
    placeholder: "Search Dart & Flutter packages (e.g. riverpod, dio, go_router)...",
    buildUrl: (n) => `https://pub.dev/packages/${encodeURIComponent(n)}`,
  },
  {
    id: "jsr",
    label: "JSR (Deno/TS)",
    field: null,
    placeholder: "Search JSR packages (e.g. @std/path, @hono/hono)...",
    buildUrl: (n) => `https://jsr.io/${n.startsWith("@") ? n : `@${n}`}`,
  },
  {
    id: "hex",
    label: "Hex.pm (Elixir)",
    field: null,
    placeholder: "Search Hex packages (e.g. phoenix, ecto, req)...",
    buildUrl: (n) => `https://hex.pm/packages/${encodeURIComponent(n)}`,
  },
  {
    id: "anaconda",
    label: "Anaconda",
    field: null,
    placeholder: "Search Conda packages (e.g. numpy, pytorch, conda-forge/polars)...",
    buildUrl: (n) => (n.includes("/") ? `https://anaconda.org/${n}` : `https://anaconda.org/conda-forge/${n}`),
  },
  {
    id: "cran",
    label: "CRAN (R)",
    field: null,
    placeholder: "Search CRAN packages (e.g. ggplot2, dplyr, shiny)...",
    buildUrl: (n) => `https://cran.r-project.org/package=${encodeURIComponent(n)}`,
  },
  {
    id: "homebrew",
    label: "Homebrew",
    field: null,
    placeholder: "Enter Homebrew formula or cask (e.g. ripgrep, jq, gh)...",
    buildUrl: (n) =>
      n.startsWith("cask/")
        ? `https://formulae.brew.sh/cask/${encodeURIComponent(n.slice("cask/".length))}`
        : `https://formulae.brew.sh/formula/${encodeURIComponent(n)}`,
  },
  {
    id: "maven",
    label: "Maven / JVM",
    field: null,
    placeholder: "Search Maven Central (e.g. com.google.guava:guava, spring-boot)...",
    buildUrl: (n) => {
      const [g, a] = n.includes(":") ? n.split(":") : n.split("/");
      return g && a
        ? `https://central.sonatype.com/artifact/${encodeURIComponent(g)}/${encodeURIComponent(a)}`
        : `https://central.sonatype.com/search?q=${encodeURIComponent(n)}`;
    },
  },
  {
    id: "cpp",
    label: "C++ (Conan/vcpkg)",
    field: null,
    placeholder: "Enter C/C++ library (e.g. fmt, zlib, conan:spdlog, vcpkg:openssl)...",
    buildUrl: (n) =>
      n.startsWith("vcpkg:")
        ? `https://vcpkg.io/en/package/${encodeURIComponent(n.slice("vcpkg:".length))}`
        : `https://conan.io/center/recipes/${encodeURIComponent(n.replace(/^(conan|wrapdb?):/, ""))}`,
  },
  {
    id: "swift",
    label: "Swift / CocoaPods",
    field: null,
    placeholder: "Enter SPM repo (Alamofire/Alamofire) or CocoaPod (Alamofire)...",
    buildUrl: (n) =>
      n.includes("/") ? `https://swiftpackageindex.com/${n}` : `https://cocoapods.org/pods/${encodeURIComponent(n)}`,
  },
  {
    id: "hackage",
    label: "Hackage",
    field: null,
    placeholder: "Search Haskell Hackage (e.g. aeson, lens, pandoc)...",
    buildUrl: (n) => `https://hackage.haskell.org/package/${encodeURIComponent(n)}`,
  },
  {
    id: "metacpan",
    label: "MetaCPAN",
    field: null,
    placeholder: "Search Perl MetaCPAN (e.g. Mojolicious, Moose, DBI)...",
    buildUrl: (n) => `https://metacpan.org/dist/${encodeURIComponent(n.replace(/::/g, "-"))}`,
  },
  {
    id: "luarocks",
    label: "LuaRocks",
    field: null,
    placeholder: "Enter LuaRocks module (e.g. luasocket, mpeterv/luacheck)...",
    buildUrl: (n) =>
      n.includes("/") ? `https://luarocks.org/modules/${n}` : `https://luarocks.org/modules/luarocks/${encodeURIComponent(n)}`,
  },
  {
    id: "julia",
    label: "Julia",
    field: null,
    placeholder: "Enter Julia package (e.g. DataFrames, Plots, Flux)...",
    buildUrl: (n) => `https://juliahub.com/ui/Packages/General/${encodeURIComponent(n)}`,
  },
];

interface PackageSearchPickerProps {
  onSelectItem: (item: {
    ecosystem: SearchableEcosystem;
    field: PrimarySearchField | null;
    name: string;
    url: string;
  }) => Promise<void> | void;
  actionLabel?: string;
  selectedValues?: Partial<Record<PrimarySearchField, string | null | undefined>>;
  compact?: boolean;
  onlyPrimaryFields?: boolean;
}

type EcosystemCategory = "all" | "popular" | "backend" | "mobile" | "data";

const CATEGORY_MAP: Record<Exclude<EcosystemCategory, "all">, SearchableEcosystem[]> = {
  popular: ["npm", "pypi", "crates", "docker", "vscode", "mcp", "go"],
  backend: ["nuget", "rubygems", "packagist", "jsr", "hex", "maven", "cpp"],
  mobile: ["pubdev", "swift", "homebrew"],
  data: ["anaconda", "cran", "hackage", "metacpan", "luarocks", "julia"],
};

export function PackageSearchPicker({
  onSelectItem,
  actionLabel = "Add",
  selectedValues = {},
  compact = false,
  onlyPrimaryFields = false,
}: PackageSearchPickerProps) {
  const [ecosystem, setEcosystem] = useState<SearchableEcosystem>("npm");
  const [category, setCategory] = useState<EcosystemCategory>("all");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistrySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visibleEcosystems = (
    onlyPrimaryFields
      ? REGISTRY_ECOSYSTEMS.filter((e) => e.field !== null)
      : REGISTRY_ECOSYSTEMS
  ).filter((e) => category === "all" || CATEGORY_MAP[category].includes(e.id));

  const meta = visibleEcosystems.find((e) => e.id === ecosystem) || visibleEcosystems[0];
  const currentAssigned = meta.field ? selectedValues[meta.field] || null : null;

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
        const isDemoPage =
          typeof window !== "undefined" && window.location.search.includes("demo=1");
        const res = await fetch(
          `/api/v1/registries/search?ecosystem=${encodeURIComponent(ecosystem)}&q=${encodeURIComponent(trimmed)}${isDemoPage ? "&demo=1" : ""}`,
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
      {!onlyPrimaryFields && (
        <div className="flex flex-wrap items-center gap-1.5 pb-1 border-b border-zinc-800/80">
          {(
            [
              ["all", "All (23)"],
              ["popular", "Popular"],
              ["backend", "Backend & Systems"],
              ["mobile", "Mobile & CLI"],
              ["data", "Data & Specialty"],
            ] as const
          ).map(([catId, label]) => (
            <button
              key={catId}
              type="button"
              onClick={() => {
                setCategory(catId);
                if (catId !== "all" && !CATEGORY_MAP[catId].includes(ecosystem)) {
                  setEcosystem(CATEGORY_MAP[catId][0]);
                }
              }}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border transition ${
                category === catId
                  ? "bg-indigo-600/25 border-indigo-500/50 text-indigo-200"
                  : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {visibleEcosystems.map((eco) => (
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
