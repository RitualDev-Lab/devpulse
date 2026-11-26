/**
 * Universal Connector Link Parser
 * Lets users paste ANY ecosystem or payment URL (GitHub, npm, PyPI, Crates.io, Go, Docker Hub,
 * VS Code Marketplace, Lemon Squeezy, Polar.sh, Paddle, Gumroad, Stripe, Dodo, Uptime /health)
 * without memorizing slug conventions.
 */

export type DetectedConnectorKind =
  | "github"
  | "npm"
  | "pypi"
  | "crates"
  | "go"
  | "docker"
  | "vscode"
  | "mcp"
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
