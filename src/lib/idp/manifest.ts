/**
 * Opt-In `devpulse.yaml` IDP Manifest Parser & Production Readiness Scorecard Evaluator
 * Lightweight alternative to complex IDP stacks with graceful stale-cache fallback under API limits.
 */

export interface DevPulseServiceManifest {
  service: string;
  tier: "tier-1" | "tier-2" | "tier-3";
  owner: string;
  ecosystems: string[];
  gates: {
    minOpenSsfScore: number;
    maxCriticalCves: number;
    minCrashFreeRate: number;
    requireSlsaProvenance: boolean;
  };
}

export interface IdpScorecardEvaluation {
  service: string;
  tier: string;
  owner: string;
  grade: "Gold" | "Silver" | "Needs Remediation";
  passedGates: number;
  totalGates: number;
  staleFallbackUsed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

export function parseDevPulseManifestYaml(yamlText: string): DevPulseServiceManifest {
  const lines = yamlText.split(/\r?\n/);
  const values: Record<string, string> = {};
  const ecosystems: string[] = [];
  let inEcosystems = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "ecosystems:") {
      inEcosystems = true;
      continue;
    }
    if (inEcosystems && trimmed.startsWith("- ")) {
      ecosystems.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    inEcosystems = false;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const k = trimmed.slice(0, colonIdx).trim();
      const v = trimmed.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      values[k] = v;
    }
  }

  const rawTier = values.tier;
  const tier =
    rawTier === "tier-1" || rawTier === "tier-2" || rawTier === "tier-3" ? rawTier : "tier-1";

  return {
    service: values.service || "devpulse",
    tier,
    owner: values.owner || "platform-security@ritualdev.in",
    ecosystems,
    gates: {
      minOpenSsfScore: Number(values.minOpenSsfScore || 7.0),
      maxCriticalCves: Number(values.maxCriticalCves || 0),
      minCrashFreeRate: Number(values.minCrashFreeRate || 99.0),
      requireSlsaProvenance: values.requireSlsaProvenance !== "false",
    },
  };
}

export function evaluateIdpScorecard(input: {
  manifest: DevPulseServiceManifest;
  openSsfScore?: number | null;
  criticalCves?: number | null;
  crashFreeRate?: number | null;
  hasSlsaProvenance?: boolean;
  lastKnownGrade?: IdpScorecardEvaluation["grade"] | null;
  upstreamRateLimited?: boolean;
}): IdpScorecardEvaluation {
  const { manifest } = input;
  const checks = [
    {
      name: "OpenSSF Scorecard",
      passed: (input.openSsfScore ?? 0) >= manifest.gates.minOpenSsfScore,
      detail: `${(input.openSsfScore ?? 0).toFixed(1)} >= ${manifest.gates.minOpenSsfScore.toFixed(1)}`,
    },
    {
      name: "Zero Critical CVEs",
      passed: (input.criticalCves ?? 0) <= manifest.gates.maxCriticalCves,
      detail: `${input.criticalCves ?? 0} critical <= ${manifest.gates.maxCriticalCves}`,
    },
    {
      name: "Crash-Free Sessions",
      passed: (input.crashFreeRate ?? 100) >= manifest.gates.minCrashFreeRate,
      detail: `${(input.crashFreeRate ?? 100).toFixed(1)}% >= ${manifest.gates.minCrashFreeRate.toFixed(1)}%`,
    },
    {
      name: "SLSA L3 Provenance",
      passed: !manifest.gates.requireSlsaProvenance || Boolean(input.hasSlsaProvenance),
      detail: input.hasSlsaProvenance ? "Attested via OIDC" : "Missing attestation",
    },
  ];

  const passedGates = checks.filter((c) => c.passed).length;
  let grade: IdpScorecardEvaluation["grade"] =
    passedGates === checks.length ? "Gold" : passedGates >= 3 ? "Silver" : "Needs Remediation";

  const staleFallbackUsed = Boolean(input.upstreamRateLimited && input.lastKnownGrade);
  if (staleFallbackUsed && input.lastKnownGrade) {
    grade = input.lastKnownGrade;
  }

  return {
    service: manifest.service,
    tier: manifest.tier,
    owner: manifest.owner,
    grade,
    passedGates,
    totalGates: checks.length,
    staleFallbackUsed,
    checks,
  };
}
