/**
 * Behavioral Supply-Chain Watchdog
 * Detects install-script hazards, typosquatting lookalikes, and low-provenance risks
 * across packages monitored by DevPulse.
 */

export type WatchdogSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface WatchdogFinding {
  id: string;
  packageName: string;
  ecosystem: string;
  category: "install_script" | "typosquat" | "provenance" | "license";
  severity: WatchdogSeverity;
  title: string;
  detail: string;
  recommendation: string;
}

export interface WatchdogInputPackage {
  ecosystem: string;
  packageName: string;
  version?: string | null;
  license?: string | null;
  scorecardOverall?: number | null;
  sourceRepo?: string | null;
  scripts?: Record<string, string> | null;
  recentMaintainerChange?: boolean;
}

const POPULAR_ANCHORS: Record<string, string[]> = {
  npm: [
    "react",
    "next",
    "express",
    "lodash",
    "axios",
    "zod",
    "typescript",
    "tailwindcss",
    "lucide-react",
    "@ritualdev/pulse",
  ],
  pypi: ["requests", "fastapi", "pydantic", "numpy", "pandas", "pytest", "devpulse-sdk"],
  crates: ["serde", "tokio", "reqwest", "clap", "axum", "devpulse-rs"],
  go: ["github.com/gin-gonic/gin", "github.com/stretchr/testify", "github.com/ritualdev-lab/devpulse-go"],
};

const DANGEROUS_SCRIPT_PATTERNS: Array<{ re: RegExp; reason: string; severity: WatchdogSeverity }> = [
  { re: /\b(curl|wget|Invoke-WebRequest|iwr)\b[^;\n]*\|\s*(sh|bash|zsh|pwsh|powershell)/i, reason: "Pipes remote payload directly into shell", severity: "CRITICAL" },
  { re: /\b(powershell|pwsh)\b.*-(enc|encodedcommand)\b/i, reason: "Obfuscated PowerShell encoded command execution", severity: "CRITICAL" },
  { re: /\b(eval|Function)\s*\(\s*Buffer\.from\(/i, reason: "Dynamic base64 code evaluation during install", severity: "CRITICAL" },
  { re: /process\.env\.(NPM_TOKEN|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|STRIPE_SECRET_KEY)/i, reason: "Accesses sensitive credentials during lifecycle hook", severity: "HIGH" },
];

export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}

export function analyzeSupplyChainBehavior(packages: WatchdogInputPackage[]): WatchdogFinding[] {
  const findings: WatchdogFinding[] = [];

  for (const pkg of packages) {
    const eco = pkg.ecosystem.toLowerCase();
    const pkgLower = pkg.packageName.toLowerCase().trim();

    // 1. Install-script lifecycle inspection
    if (pkg.scripts) {
      for (const [hook, cmd] of Object.entries(pkg.scripts)) {
        if (!/^(pre|post)?install$/i.test(hook) || typeof cmd !== "string") continue;
        let matchedDanger = false;
        for (const rule of DANGEROUS_SCRIPT_PATTERNS) {
          if (rule.re.test(cmd)) {
            matchedDanger = true;
            findings.push({
              id: `script:${eco}:${pkg.packageName}:${hook}`,
              packageName: pkg.packageName,
              ecosystem: eco,
              category: "install_script",
              severity: rule.severity,
              title: `Suspicious ${hook} hook in ${pkg.packageName}`,
              detail: `${rule.reason}: "${cmd.slice(0, 120)}"`,
              recommendation: "Audit script source in tarball and install with --ignore-scripts until verified.",
            });
          }
        }
        if (!matchedDanger && cmd.trim().length > 0) {
          findings.push({
            id: `script-notice:${eco}:${pkg.packageName}:${hook}`,
            packageName: pkg.packageName,
            ecosystem: eco,
            category: "install_script",
            severity: "LOW",
            title: `Lifecycle script (${hook}) present on ${pkg.packageName}`,
            detail: `Executes "${cmd.slice(0, 100)}" on package install.`,
            recommendation: "Verify native addon build scripts match release provenance.",
          });
        }
      }
    }

    // 2. Typosquat / brand confusion check
    const anchors = POPULAR_ANCHORS[eco] || [];
    for (const anchor of anchors) {
      if (pkgLower === anchor) break;
      const dist = damerauLevenshtein(pkgLower.replace(/^@[^/]+\//, ""), anchor.replace(/^@[^/]+\//, ""));
      if (dist > 0 && dist <= 2 && Math.abs(pkgLower.length - anchor.length) <= 2) {
        findings.push({
          id: `typosquat:${eco}:${pkg.packageName}:${anchor}`,
          packageName: pkg.packageName,
          ecosystem: eco,
          category: "typosquat",
          severity: "HIGH",
          title: `Potential typosquat near "${anchor}"`,
          detail: `Package "${pkg.packageName}" has edit distance ${dist} from popular package "${anchor}".`,
          recommendation: `Confirm publisher identity & exact spelling before granting registry or CI trust.`,
        });
        break;
      }
    }

    // 3. Provenance & Maintainer velocity alerts
    if (pkg.recentMaintainerChange) {
      findings.push({
        id: `maintainer:${eco}:${pkg.packageName}`,
        packageName: pkg.packageName,
        ecosystem: eco,
        category: "provenance",
        severity: "HIGH",
        title: `Recent maintainer change detected on ${pkg.packageName}`,
        detail: "Newly added publisher key detected compared to previous minor releases.",
        recommendation: "Pin exact version hash and verify SLSA / Sigstore provenance attestation.",
      });
    } else if (pkg.scorecardOverall !== null && pkg.scorecardOverall !== undefined && pkg.scorecardOverall < 4.5) {
      findings.push({
        id: `scorecard:${eco}:${pkg.packageName}`,
        packageName: pkg.packageName,
        ecosystem: eco,
        category: "provenance",
        severity: "MEDIUM",
        title: `Low OpenSSF Scorecard (${pkg.scorecardOverall.toFixed(1)}/10)`,
        detail: `${pkg.packageName} lacks hardened branch protection or signed release workflows.`,
        recommendation: "Enable Dependabot SHA pinning and binary provenance checks in CI.",
      });
    }
  }

  const order: Record<WatchdogSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
