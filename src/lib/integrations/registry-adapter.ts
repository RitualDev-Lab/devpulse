import type { DepsDevAdvisorySummary, DepsDevSystem } from "./deps-dev";

export type RegistryProviderId =
  | "npm"
  | "pypi"
  | "crates"
  | "go"
  | "docker"
  | "vscode"
  | "mcp"
  | "nuget"
  | "rubygems"
  | "packagist"
  | "pubdev"
  | "jsr"
  | "hex"
  | "anaconda"
  | "cran"
  | "homebrew"
  | "maven"
  | "cpp"
  | "swift"
  | "hackage"
  | "metacpan"
  | "luarocks"
  | "julia";

export type PrimaryProjectPackageField =
  | "npmPackage"
  | "pypiPackage"
  | "rustCrate"
  | "goModule"
  | "dockerImage"
  | "vscodeExtension"
  | "mcpServerName";

export interface RegistryAdapterMeta {
  id: RegistryProviderId;
  label: string;
  ecosystemLabel: string;
  projectField: PrimaryProjectPackageField | null;
  depsDevSystem: DepsDevSystem | null;
  countsTowardDownloadBadge: boolean;
  buildUrl: (identifier: string) => string;
}

export const REGISTRY_ADAPTERS: Record<RegistryProviderId, RegistryAdapterMeta> = {
  npm: {
    id: "npm",
    label: "npm",
    ecosystemLabel: "JavaScript / TypeScript",
    projectField: "npmPackage",
    depsDevSystem: "NPM",
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://www.npmjs.com/package/${encodeURIComponent(id).replace(/%2F/gi, "/")}`,
  },
  pypi: {
    id: "pypi",
    label: "PyPI",
    ecosystemLabel: "Python",
    projectField: "pypiPackage",
    depsDevSystem: "PYPI",
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://pypi.org/project/${encodeURIComponent(id)}/`,
  },
  crates: {
    id: "crates",
    label: "Crates.io",
    ecosystemLabel: "Rust",
    projectField: "rustCrate",
    depsDevSystem: "CARGO",
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://crates.io/crates/${encodeURIComponent(id)}`,
  },
  go: {
    id: "go",
    label: "Go Modules",
    ecosystemLabel: "Go",
    projectField: "goModule",
    depsDevSystem: "GO",
    countsTowardDownloadBadge: false,
    buildUrl: (id) => `https://pkg.go.dev/${id}`,
  },
  docker: {
    id: "docker",
    label: "Docker Hub",
    ecosystemLabel: "Containers",
    projectField: "dockerImage",
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) =>
      id.startsWith("library/")
        ? `https://hub.docker.com/_/${id.slice("library/".length)}`
        : `https://hub.docker.com/r/${id}`,
  },
  vscode: {
    id: "vscode",
    label: "VS Code",
    ecosystemLabel: "Editor Extension",
    projectField: "vscodeExtension",
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(id)}`,
  },
  mcp: {
    id: "mcp",
    label: "MCP Registry",
    ecosystemLabel: "Model Context Protocol",
    projectField: "mcpServerName",
    depsDevSystem: null,
    countsTowardDownloadBadge: false,
    buildUrl: (id) => `https://smithery.ai/server/${id}`,
  },
  nuget: {
    id: "nuget",
    label: "NuGet",
    ecosystemLabel: "C# / .NET / F#",
    projectField: null,
    depsDevSystem: "NUGET",
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://www.nuget.org/packages/${encodeURIComponent(id)}`,
  },
  rubygems: {
    id: "rubygems",
    label: "RubyGems",
    ecosystemLabel: "Ruby / Bundler",
    projectField: null,
    depsDevSystem: "RUBYGEMS",
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://rubygems.org/gems/${encodeURIComponent(id)}`,
  },
  packagist: {
    id: "packagist",
    label: "Packagist",
    ecosystemLabel: "PHP / Composer",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://packagist.org/packages/${id}`,
  },
  pubdev: {
    id: "pubdev",
    label: "pub.dev",
    ecosystemLabel: "Dart / Flutter",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://pub.dev/packages/${encodeURIComponent(id)}`,
  },
  jsr: {
    id: "jsr",
    label: "JSR",
    ecosystemLabel: "Deno / Bun / TS",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: false,
    buildUrl: (id) => `https://jsr.io/${id.startsWith("@") ? id : `@${id}`}`,
  },
  hex: {
    id: "hex",
    label: "Hex.pm",
    ecosystemLabel: "Elixir / Erlang",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://hex.pm/packages/${encodeURIComponent(id)}`,
  },
  anaconda: {
    id: "anaconda",
    label: "Anaconda",
    ecosystemLabel: "Conda / ML",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) =>
      id.includes("/")
        ? `https://anaconda.org/${id}`
        : `https://anaconda.org/conda-forge/${encodeURIComponent(id)}`,
  },
  cran: {
    id: "cran",
    label: "CRAN",
    ecosystemLabel: "R Language",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://cran.r-project.org/package=${encodeURIComponent(id)}`,
  },
  homebrew: {
    id: "homebrew",
    label: "Homebrew",
    ecosystemLabel: "CLI / macOS & Linux",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) =>
      id.startsWith("cask/")
        ? `https://formulae.brew.sh/cask/${encodeURIComponent(id.slice("cask/".length))}`
        : `https://formulae.brew.sh/formula/${encodeURIComponent(id)}`,
  },
  maven: {
    id: "maven",
    label: "Maven Central",
    ecosystemLabel: "Java / Kotlin / Scala",
    projectField: null,
    depsDevSystem: "MAVEN",
    countsTowardDownloadBadge: false,
    buildUrl: (id) => {
      const [g, a] = id.includes(":") ? id.split(":") : id.split("/");
      return g && a
        ? `https://central.sonatype.com/artifact/${encodeURIComponent(g)}/${encodeURIComponent(a)}`
        : `https://central.sonatype.com/search?q=${encodeURIComponent(id)}`;
    },
  },
  cpp: {
    id: "cpp",
    label: "Conan / vcpkg",
    ecosystemLabel: "C / C++",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: false,
    buildUrl: (id) =>
      id.startsWith("vcpkg:")
        ? `https://vcpkg.io/en/package/${encodeURIComponent(id.slice("vcpkg:".length))}`
        : `https://conan.io/center/recipes/${encodeURIComponent(id.replace(/^(conan|wrapdb?):/, ""))}`,
  },
  swift: {
    id: "swift",
    label: "Swift / CocoaPods",
    ecosystemLabel: "Swift / Objective-C",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: false,
    buildUrl: (id) =>
      id.includes("/")
        ? `https://swiftpackageindex.com/${id}`
        : `https://cocoapods.org/pods/${encodeURIComponent(id)}`,
  },
  hackage: {
    id: "hackage",
    label: "Hackage",
    ecosystemLabel: "Haskell",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) => `https://hackage.haskell.org/package/${encodeURIComponent(id)}`,
  },
  metacpan: {
    id: "metacpan",
    label: "MetaCPAN",
    ecosystemLabel: "Perl",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: false,
    buildUrl: (id) => `https://metacpan.org/dist/${encodeURIComponent(id.replace(/::/g, "-"))}`,
  },
  luarocks: {
    id: "luarocks",
    label: "LuaRocks",
    ecosystemLabel: "Lua",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: true,
    buildUrl: (id) =>
      id.includes("/")
        ? `https://luarocks.org/modules/${id}`
        : `https://luarocks.org/modules/luarocks/${encodeURIComponent(id)}`,
  },
  julia: {
    id: "julia",
    label: "Julia Registry",
    ecosystemLabel: "Julia (Pkg.jl)",
    projectField: null,
    depsDevSystem: null,
    countsTowardDownloadBadge: false,
    buildUrl: (id) => `https://juliahub.com/ui/Packages/General/${encodeURIComponent(id.replace(/\.jl$/i, ""))}`,
  },
};

export interface ExtraPackageSnapshot {
  connectorId: string;
  provider: RegistryProviderId;
  label: string;
  identifier: string;
  latestVersion?: string | null;
  metricLabel: string;
  metricValue: number | null;
  secondaryLabel?: string | null;
  secondaryValue?: string | null;
  dailyHistory?: Array<{ date: string; downloads: number }>;
  url: string;
  security?: DepsDevAdvisorySummary | null;
}

const PROVIDER_ALIASES: Record<string, RegistryProviderId> = {
  npm: "npm",
  pypi: "pypi",
  crates: "crates",
  "crates.io": "crates",
  rust: "crates",
  go: "go",
  golang: "go",
  docker: "docker",
  vscode: "vscode",
  "vs code": "vscode",
  "open-vsx": "vscode",
  mcp: "mcp",
  nuget: "nuget",
  paket: "nuget",
  dotnet: "nuget",
  rubygems: "rubygems",
  ruby: "rubygems",
  bundler: "rubygems",
  packagist: "packagist",
  composer: "packagist",
  php: "packagist",
  pubdev: "pubdev",
  "pub.dev": "pubdev",
  dart: "pubdev",
  flutter: "pubdev",
  pub: "pubdev",
  jsr: "jsr",
  deno: "jsr",
  hex: "hex",
  "hex.pm": "hex",
  elixir: "hex",
  mix: "hex",
  anaconda: "anaconda",
  conda: "anaconda",
  "conda-forge": "anaconda",
  cran: "cran",
  r: "cran",
  homebrew: "homebrew",
  brew: "homebrew",
  maven: "maven",
  gradle: "maven",
  sbt: "maven",
  ivy: "maven",
  java: "maven",
  kotlin: "maven",
  scala: "maven",
  jvm: "maven",
  cpp: "cpp",
  "c++": "cpp",
  conan: "cpp",
  vcpkg: "cpp",
  meson: "cpp",
  wrapdb: "cpp",
  swift: "swift",
  spm: "swift",
  cocoapods: "swift",
  hackage: "hackage",
  haskell: "hackage",
  cabal: "hackage",
  metacpan: "metacpan",
  cpan: "metacpan",
  perl: "metacpan",
  luarocks: "luarocks",
  lua: "luarocks",
  julia: "julia",
  juliahub: "julia",
};

export function normalizeRegistryProvider(raw?: string | null): RegistryProviderId | null {
  const s = (raw || "").trim().toLowerCase();
  return PROVIDER_ALIASES[s] || null;
}

export function securitySummaryKey(system: DepsDevSystem, packageName: string): string {
  return `${system}:${packageName.trim().toLowerCase()}`;
}

export function formatRelativeSyncAge(iso?: string | null, nowMs = Date.now()): string {
  if (!iso) return "Not synced yet";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "Synced";
  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 45) return "Synced just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Synced ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `Synced ${diffHr}h ago`;
  return `Synced ${Math.floor(diffHr / 24)}d ago`;
}
