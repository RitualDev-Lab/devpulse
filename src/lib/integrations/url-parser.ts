/**
 * Universal Connector Link Parser
 * Lets users paste ANY ecosystem or payment URL (GitHub, npm, PyPI, Crates.io, Go, Docker Hub,
 * VS Code Marketplace, Lemon Squeezy, Polar.sh, Paddle, Gumroad, Stripe, Dodo, Uptime /health)
 * without memorizing slug conventions.
 */

export type DetectedConnectorKind =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "gitea"
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
  | "julia"
  | "payment"
  | "uptime"
  | "unknown";

export interface ParsedConnectorLink {
  raw: string;
  kind: DetectedConnectorKind;
  provider: string;
  field?:
    | "githubRepo"
    | "npmPackage"
    | "pypiPackage"
    | "rustCrate"
    | "goModule"
    | "dockerImage"
    | "vscodeExtension"
    | "mcpServerName";
  value: string;
  label: string;
  normalizedUrl?: string;
}

export function parseConnectorInput(rawInput: string): ParsedConnectorLink {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { raw: rawInput, kind: "unknown", provider: "unknown", value: "", label: "Empty" };
  }

  // Handle shorthand owner/repo (no scheme)
  if (!/^https?:\/\//i.test(trimmed) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return {
      raw: rawInput,
      kind: "github",
      provider: "GitHub",
      field: "githubRepo",
      value: trimmed,
      label: `GitHub (${trimmed})`,
      normalizedUrl: `https://github.com/${trimmed}`,
    };
  }

  // Handle scoped npm package like @ritualdev/devpulse
  if (!/^https?:\/\//i.test(trimmed) && /^@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return {
      raw: rawInput,
      kind: "npm",
      provider: "npm",
      field: "npmPackage",
      value: trimmed,
      label: `npm (${trimmed})`,
      normalizedUrl: `https://www.npmjs.com/package/${trimmed}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { raw: rawInput, kind: "unknown", provider: "custom", value: trimmed, label: trimmed };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  // GitHub
  if (host === "github.com" && pathParts.length >= 2) {
    const repoSlug = `${pathParts[0]}/${pathParts[1].replace(/\.git$/i, "")}`;
    return {
      raw: rawInput,
      kind: "github",
      provider: "GitHub",
      field: "githubRepo",
      value: repoSlug,
      label: `GitHub (${repoSlug})`,
      normalizedUrl: `https://github.com/${repoSlug}`,
    };
  }

  // GitLab (gitlab.com/group/.../repo)
  if ((host === "gitlab.com" || host.startsWith("gitlab.")) && pathParts.length >= 2) {
    const dashIdx = pathParts.indexOf("-");
    const cleanParts = dashIdx >= 2 ? pathParts.slice(0, dashIdx) : pathParts;
    const repoSlug = cleanParts.join("/").replace(/\.git$/i, "");
    return {
      raw: rawInput,
      kind: "gitlab",
      provider: host === "gitlab.com" ? "GitLab" : "GitLab Self-Hosted",
      value: repoSlug,
      label: `GitLab (${repoSlug})`,
      normalizedUrl: `${parsed.origin}/${repoSlug}`,
    };
  }

  // Bitbucket (bitbucket.org/workspace/repo)
  if (host === "bitbucket.org" && pathParts.length >= 2) {
    const repoSlug = `${pathParts[0]}/${pathParts[1].replace(/\.git$/i, "")}`;
    return {
      raw: rawInput,
      kind: "bitbucket",
      provider: "Bitbucket",
      value: repoSlug,
      label: `Bitbucket (${repoSlug})`,
      normalizedUrl: `https://bitbucket.org/${repoSlug}`,
    };
  }

  // Codeberg / Gitea / Forgejo
  if ((host === "codeberg.org" || host.includes("gitea") || host.includes("forgejo")) && pathParts.length >= 2) {
    const repoSlug = `${pathParts[0]}/${pathParts[1].replace(/\.git$/i, "")}`;
    return {
      raw: rawInput,
      kind: "gitea",
      provider: host === "codeberg.org" ? "Codeberg" : "Gitea / Forgejo",
      value: repoSlug,
      label: `${host === "codeberg.org" ? "Codeberg" : "Gitea"} (${repoSlug})`,
      normalizedUrl: `${parsed.origin}/${repoSlug}`,
    };
  }

  // npmjs.com/package/@scope/name or /package/name
  if (host === "npmjs.com" || host === "npmjs.org") {
    const pkgIdx = pathParts[0] === "package" ? 1 : 0;
    const slice = pathParts.slice(pkgIdx);
    const pkgName =
      slice[0]?.startsWith("@") && slice[1]
        ? `${slice[0]}/${slice[1]}`
        : slice[0] || "";
    if (pkgName) {
      return {
        raw: rawInput,
        kind: "npm",
        provider: "npm",
        field: "npmPackage",
        value: pkgName,
        label: `npm (${pkgName})`,
        normalizedUrl: `https://www.npmjs.com/package/${pkgName}`,
      };
    }
  }

  // pypi.org/project/<name>
  if (host === "pypi.org" && pathParts[0] === "project" && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "pypi",
      provider: "PyPI",
      field: "pypiPackage",
      value: pathParts[1],
      label: `PyPI (${pathParts[1]})`,
      normalizedUrl: `https://pypi.org/project/${pathParts[1]}/`,
    };
  }

  // crates.io/crates/<name>
  if (host === "crates.io" && pathParts[0] === "crates" && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "crates",
      provider: "Crates.io",
      field: "rustCrate",
      value: pathParts[1],
      label: `Crates.io (${pathParts[1]})`,
      normalizedUrl: `https://crates.io/crates/${pathParts[1]}`,
    };
  }

  // pkg.go.dev/<module>
  if (host === "pkg.go.dev" && pathParts.length >= 1) {
    const mod = pathParts.join("/");
    return {
      raw: rawInput,
      kind: "go",
      provider: "Go Modules",
      field: "goModule",
      value: mod,
      label: `Go (${mod})`,
      normalizedUrl: `https://pkg.go.dev/${mod}`,
    };
  }

  // hub.docker.com/r/<owner>/<image> or /_/<image>
  if (host === "hub.docker.com") {
    let image = "";
    if (pathParts[0] === "r" && pathParts[1] && pathParts[2]) {
      image = `${pathParts[1]}/${pathParts[2]}`;
    } else if (pathParts[0] === "_" && pathParts[1]) {
      image = `library/${pathParts[1]}`;
    }
    if (image) {
      return {
        raw: rawInput,
        kind: "docker",
        provider: "Docker Hub",
        field: "dockerImage",
        value: image,
        label: `Docker (${image})`,
        normalizedUrl: parsed.toString(),
      };
    }
  }

  // marketplace.visualstudio.com/items?itemName=pub.ext
  if (host === "marketplace.visualstudio.com") {
    const itemName = parsed.searchParams.get("itemName");
    if (itemName) {
      return {
        raw: rawInput,
        kind: "vscode",
        provider: "VS Code",
        field: "vscodeExtension",
        value: itemName,
        label: `VS Code (${itemName})`,
        normalizedUrl: parsed.toString(),
      };
    }
  }

  // open-vsx.org/extension/<publisher>/<name>
  if (host === "open-vsx.org" && pathParts[0] === "extension" && pathParts[1] && pathParts[2]) {
    const extId = `${pathParts[1]}.${pathParts[2]}`;
    return {
      raw: rawInput,
      kind: "vscode",
      provider: "Open-VSX",
      field: "vscodeExtension",
      value: extId,
      label: `VS Code (${extId})`,
      normalizedUrl: parsed.toString(),
    };
  }

  // smithery.ai/server/<name> or glama.ai/mcp/servers/<slug>
  if (host === "smithery.ai" && pathParts[0] === "server" && pathParts.length >= 2) {
    const serverSlug = pathParts.slice(1).join("/");
    return {
      raw: rawInput,
      kind: "mcp",
      provider: "Smithery MCP",
      field: "mcpServerName",
      value: serverSlug,
      label: `MCP (${serverSlug})`,
      normalizedUrl: parsed.toString(),
    };
  }
  if (host === "glama.ai" && pathParts[0] === "mcp" && pathParts[1] === "servers" && pathParts[2]) {
    const serverSlug = pathParts.slice(2).join("/");
    return {
      raw: rawInput,
      kind: "mcp",
      provider: "Glama MCP",
      field: "mcpServerName",
      value: serverSlug,
      label: `MCP (${serverSlug})`,
      normalizedUrl: parsed.toString(),
    };
  }

  // NuGet (nuget.org/packages/<id>)
  if (host === "nuget.org" && pathParts[0] === "packages" && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "nuget",
      provider: "NuGet",
      value: pathParts[1],
      label: `NuGet (${pathParts[1]})`,
      normalizedUrl: `https://www.nuget.org/packages/${pathParts[1]}`,
    };
  }

  // RubyGems (rubygems.org/gems/<name>)
  if (host === "rubygems.org" && pathParts[0] === "gems" && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "rubygems",
      provider: "RubyGems",
      value: pathParts[1],
      label: `RubyGems (${pathParts[1]})`,
      normalizedUrl: `https://rubygems.org/gems/${pathParts[1]}`,
    };
  }

  // Packagist (packagist.org/packages/<vendor>/<name>)
  if (host === "packagist.org" && pathParts[0] === "packages" && pathParts[1] && pathParts[2]) {
    const pkgSlug = `${pathParts[1]}/${pathParts[2]}`;
    return {
      raw: rawInput,
      kind: "packagist",
      provider: "Packagist",
      value: pkgSlug,
      label: `Packagist (${pkgSlug})`,
      normalizedUrl: `https://packagist.org/packages/${pkgSlug}`,
    };
  }

  // pub.dev (pub.dev/packages/<name>)
  if (host === "pub.dev" && pathParts[0] === "packages" && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "pubdev",
      provider: "pub.dev",
      value: pathParts[1],
      label: `pub.dev (${pathParts[1]})`,
      normalizedUrl: `https://pub.dev/packages/${pathParts[1]}`,
    };
  }

  // JSR (jsr.io/@scope/name)
  if (host === "jsr.io" && pathParts[0]?.startsWith("@") && pathParts[1]) {
    const pkgSlug = `${pathParts[0]}/${pathParts[1]}`;
    return {
      raw: rawInput,
      kind: "jsr",
      provider: "JSR",
      value: pkgSlug,
      label: `JSR (${pkgSlug})`,
      normalizedUrl: `https://jsr.io/${pkgSlug}`,
    };
  }

  // Hex.pm (hex.pm/packages/<name>)
  if (host === "hex.pm" && pathParts[0] === "packages" && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "hex",
      provider: "Hex.pm",
      value: pathParts[1],
      label: `Hex.pm (${pathParts[1]})`,
      normalizedUrl: `https://hex.pm/packages/${pathParts[1]}`,
    };
  }

  // Anaconda (anaconda.org/<channel>/<name>)
  if (host === "anaconda.org" && pathParts[0] && pathParts[1]) {
    const pkgSlug = `${pathParts[0]}/${pathParts[1]}`;
    return {
      raw: rawInput,
      kind: "anaconda",
      provider: "Anaconda",
      value: pkgSlug,
      label: `Anaconda (${pkgSlug})`,
      normalizedUrl: `https://anaconda.org/${pkgSlug}`,
    };
  }

  // CRAN (cran.r-project.org/package=<name> or /web/packages/<name>)
  if (host === "cran.r-project.org") {
    const queryPkg = parsed.searchParams.get("package");
    const webPkg = pathParts[0] === "web" && pathParts[1] === "packages" ? pathParts[2] : null;
    const eqMatch = pathParts[0]?.startsWith("package=") ? pathParts[0].slice("package=".length) : null;
    const pkgName = queryPkg || webPkg || eqMatch;
    if (pkgName) {
      return {
        raw: rawInput,
        kind: "cran",
        provider: "CRAN",
        value: pkgName,
        label: `CRAN (${pkgName})`,
        normalizedUrl: `https://cran.r-project.org/package=${pkgName}`,
      };
    }
  }

  // Homebrew (formulae.brew.sh/formula/<name> or /cask/<name>)
  if (host === "formulae.brew.sh" && (pathParts[0] === "formula" || pathParts[0] === "cask") && pathParts[1]) {
    const val = pathParts[0] === "cask" ? `cask/${pathParts[1]}` : pathParts[1];
    return {
      raw: rawInput,
      kind: "homebrew",
      provider: "Homebrew",
      value: val,
      label: `Homebrew (${val})`,
      normalizedUrl: `https://formulae.brew.sh/${pathParts[0]}/${pathParts[1]}`,
    };
  }

  // Maven Central (central.sonatype.com/artifact/<group>/<artifact> or mvnrepository.com/artifact/<g>/<a>)
  if ((host === "central.sonatype.com" || host === "mvnrepository.com") && pathParts[0] === "artifact" && pathParts[1] && pathParts[2]) {
    const coord = `${pathParts[1]}:${pathParts[2]}`;
    return {
      raw: rawInput,
      kind: "maven",
      provider: "Maven Central",
      value: coord,
      label: `Maven (${coord})`,
      normalizedUrl: `https://central.sonatype.com/artifact/${pathParts[1]}/${pathParts[2]}`,
    };
  }

  // Conan Center / vcpkg
  if (host === "conan.io" && pathParts[0] === "center" && pathParts[1] === "recipes" && pathParts[2]) {
    return {
      raw: rawInput,
      kind: "cpp",
      provider: "Conan Center",
      value: `conan:${pathParts[2]}`,
      label: `Conan (${pathParts[2]})`,
      normalizedUrl: `https://conan.io/center/recipes/${pathParts[2]}`,
    };
  }
  if (host === "vcpkg.io" && pathParts[1] === "package" && pathParts[2]) {
    return {
      raw: rawInput,
      kind: "cpp",
      provider: "vcpkg",
      value: `vcpkg:${pathParts[2]}`,
      label: `vcpkg (${pathParts[2]})`,
      normalizedUrl: `https://vcpkg.io/en/package/${pathParts[2]}`,
    };
  }

  // Swift Package Index / CocoaPods
  if (host === "swiftpackageindex.com" && pathParts[0] && pathParts[1]) {
    const slug = `${pathParts[0]}/${pathParts[1]}`;
    return {
      raw: rawInput,
      kind: "swift",
      provider: "Swift Package Index",
      value: slug,
      label: `Swift (${slug})`,
      normalizedUrl: `https://swiftpackageindex.com/${slug}`,
    };
  }
  if (host === "cocoapods.org" && pathParts[0] === "pods" && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "swift",
      provider: "CocoaPods",
      value: pathParts[1],
      label: `CocoaPods (${pathParts[1]})`,
      normalizedUrl: `https://cocoapods.org/pods/${pathParts[1]}`,
    };
  }

  // Hackage
  if (host === "hackage.haskell.org" && pathParts[0] === "package" && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "hackage",
      provider: "Hackage",
      value: pathParts[1],
      label: `Hackage (${pathParts[1]})`,
      normalizedUrl: `https://hackage.haskell.org/package/${pathParts[1]}`,
    };
  }

  // MetaCPAN
  if (host === "metacpan.org" && (pathParts[0] === "dist" || pathParts[0] === "pod") && pathParts[1]) {
    return {
      raw: rawInput,
      kind: "metacpan",
      provider: "MetaCPAN",
      value: pathParts[1],
      label: `MetaCPAN (${pathParts[1]})`,
      normalizedUrl: parsed.toString(),
    };
  }

  // LuaRocks
  if (host === "luarocks.org" && pathParts[0] === "modules" && pathParts[1] && pathParts[2]) {
    const mod = `${pathParts[1]}/${pathParts[2]}`;
    return {
      raw: rawInput,
      kind: "luarocks",
      provider: "LuaRocks",
      value: mod,
      label: `LuaRocks (${mod})`,
      normalizedUrl: `https://luarocks.org/modules/${mod}`,
    };
  }

  // JuliaHub
  if (host === "juliahub.com" && pathParts[0] === "ui" && pathParts[1] === "Packages" && pathParts[3]) {
    return {
      raw: rawInput,
      kind: "julia",
      provider: "Julia Registry",
      value: pathParts[3],
      label: `Julia (${pathParts[3]})`,
      normalizedUrl: parsed.toString(),
    };
  }

  // Payment provider links
  const paymentProviders: Array<{ match: string; provider: string; label: string }> = [
    { match: "lemonsqueezy.com", provider: "lemonsqueezy", label: "Lemon Squeezy" },
    { match: "polar.sh", provider: "polar", label: "Polar.sh" },
    { match: "gumroad.com", provider: "gumroad", label: "Gumroad" },
    { match: "paddle.com", provider: "paddle", label: "Paddle" },
    { match: "stripe.com", provider: "stripe", label: "Stripe" },
    { match: "dodopayments.com", provider: "dodo", label: "Dodo Payments" },
    { match: "razorpay.com", provider: "razorpay", label: "Razorpay" },
  ];
  for (const pp of paymentProviders) {
    if (host === pp.match || host.endsWith(`.${pp.match}`)) {
      return {
        raw: rawInput,
        kind: "payment",
        provider: pp.provider,
        value: parsed.toString(),
        label: pp.label,
        normalizedUrl: parsed.toString(),
      };
    }
  }

  // Fallback: looks like an app /health or web endpoint URL
  if (/^https?:\/\//i.test(trimmed)) {
    return {
      raw: rawInput,
      kind: "uptime",
      provider: "HTTP /health",
      value: parsed.toString(),
      label: `Endpoint (${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname})`,
      normalizedUrl: parsed.toString(),
    };
  }

  return { raw: rawInput, kind: "unknown", provider: "custom", value: trimmed, label: trimmed };
}

export function parseMultipleConnectorInputs(blob: string): ParsedConnectorLink[] {
  return blob
    .split(/[\r\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => parseConnectorInput(entry))
    .filter((item) => item.value.length > 0);
}
