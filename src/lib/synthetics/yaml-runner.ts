import { db } from "@/db";
import { projects, syntheticRuns, syntheticTests } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { computeP95Latency, isValidPublicMonitorUrl } from "@/lib/monitors/checker";
import { dispatchCrashAlerts, resolveDecryptedWebhookConfig } from "@/lib/alerts/webhook";
import { decryptSecret } from "@/lib/security/crypto";

export const EDGE_REGIONS = [
  { id: "iad", label: "US-East (Virginia)" },
  { id: "fra", label: "EU-Central (Frankfurt)" },
  { id: "sin", label: "AP-South (Singapore)" },
  { id: "syd", label: "OC-East (Sydney)" },
  { id: "gru", label: "SA-East (Sao Paulo)" },
] as const;

export interface SyntheticStep {
  action: "goto" | "fetch" | "submitForm";
  target: string;
  method: "GET" | "POST" | "HEAD";
  expectStatus: number;
  expectText?: string;
  expectJsonKey?: string;
  maxLatencyMs?: number;
  bodyJson?: string;
}

export interface ParsedSyntheticYaml {
  name: string;
  baseUrl: string;
  steps: SyntheticStep[];
}

export interface SyntheticStepResult {
  stepIndex: number;
  action: string;
  url: string;
  statusCode: number | null;
  latencyMs: number;
  passed: boolean;
  error?: string;
}

export const SAMPLE_SYNTHETIC_YAML = `name: Production Smoke & API E2E
baseUrl: https://devpulse.ritualdev.in
steps:
  - goto: /
    expectStatus: 200
    expectText: DevPulse
    maxLatencyMs: 3000
  - fetch: /api/v1/sla?projectId=prj_ritual_core
    method: GET
    expectStatus: 200
    expectJsonKey: report`;

function unquoteYaml(val: string): string {
  const t = val.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Deterministic zero-dependency parser for declarative Synthetic E2E YAML suites.
 */
export function parseSyntheticYaml(yamlSpec: string): ParsedSyntheticYaml {
  const lines = yamlSpec.split(/\r?\n/);
  let name = "E2E Synthetic Test";
  let baseUrl = "";
  const steps: SyntheticStep[] = [];
  let current: Partial<SyntheticStep> | null = null;

  const flushStep = () => {
    if (current && current.target) {
      steps.push({
        action: current.action || "goto",
        target: current.target,
        method: current.method || (current.action === "submitForm" ? "POST" : "GET"),
        expectStatus: Number(current.expectStatus || 200),
        expectText: current.expectText,
        expectJsonKey: current.expectJsonKey,
        maxLatencyMs: current.maxLatencyMs ? Number(current.maxLatencyMs) : undefined,
        bodyJson: current.bodyJson,
      });
    }
    current = null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ")) {
      flushStep();
      current = {};
      const rest = trimmed.slice(2).trim();
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        const k = rest.slice(0, colonIdx).trim();
        const v = unquoteYaml(rest.slice(colonIdx + 1));
        if (k === "goto" || k === "visit") {
          current.action = "goto";
          current.target = v;
        } else if (k === "fetch") {
          current.action = "fetch";
          current.target = v;
        } else if (k === "submitForm") {
          current.action = "submitForm";
          current.target = v;
          current.method = "POST";
        }
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = unquoteYaml(trimmed.slice(colonIdx + 1));

    if (current) {
      if (key === "goto" || key === "visit") {
        current.action = "goto";
        current.target = val;
      } else if (key === "fetch") {
        current.action = "fetch";
        current.target = val;
      } else if (key === "submitForm") {
        current.action = "submitForm";
        current.target = val;
        current.method = "POST";
      } else if (key === "method") {
        const m = val.toUpperCase();
        if (m === "GET" || m === "POST" || m === "HEAD") current.method = m;
      } else if (key === "expectStatus") {
        current.expectStatus = Number(val) || 200;
      } else if (key === "expectText" || key === "expectContains") {
        current.expectText = val;
      } else if (key === "expectJsonKey") {
        current.expectJsonKey = val;
      } else if (key === "maxLatencyMs") {
        current.maxLatencyMs = Number(val) || undefined;
      } else if (key === "body") {
        current.bodyJson = val;
      }
    } else {
      if (key === "name") name = val;
      if (key === "baseUrl" || key === "base_url") baseUrl = val.replace(/\/+$/, "");
    }
  }
  flushStep();

  if (!baseUrl) {
    throw new Error("YAML spec must include 'baseUrl: https://...'");
  }
  const urlCheck = isValidPublicMonitorUrl(baseUrl);
  if (!urlCheck.valid) {
    throw new Error(urlCheck.reason || "Invalid baseUrl");
  }
  if (steps.length === 0) {
    throw new Error("YAML spec must define at least one step under 'steps:'");
  }

  return { name, baseUrl, steps };
}

function resolveStepUrl(baseUrl: string, target: string): string {
  if (target.startsWith("http://") || target.startsWith("https://")) {
    const check = isValidPublicMonitorUrl(target);
    if (!check.valid) throw new Error(check.reason || "Blocked target URL");
    return target;
  }
  const joined = `${baseUrl}${target.startsWith("/") ? target : `/${target}`}`;
  const check = isValidPublicMonitorUrl(joined);
  if (!check.valid) throw new Error(check.reason || "Blocked target URL");
  return joined;
}

async function executeStepsOnce(parsed: ParsedSyntheticYaml, region: string): Promise<{
  status: "pass" | "fail";
  totalLatencyMs: number;
  stepResults: SyntheticStepResult[];
  errorMessage: string | null;
}> {
  const stepResults: SyntheticStepResult[] = [];
  let totalLatencyMs = 0;
  let overallStatus: "pass" | "fail" = "pass";
  let errorMessage: string | null = null;

  for (let i = 0; i < parsed.steps.length; i++) {
    const step = parsed.steps[i];
    const url = resolveStepUrl(parsed.baseUrl, step.target);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: step.method,
        headers: {
          "User-Agent": `DevPulse-Synthetics/1.0 (region=${region})`,
          "X-DevPulse-Region": region,
          ...(step.bodyJson ? { "Content-Type": "application/json" } : {}),
        },
        body: step.method === "POST" && step.bodyJson ? step.bodyJson : undefined,
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Math.max(1, Date.now() - t0);
      totalLatencyMs += latencyMs;
      const text = await res.text();

      let stepErr: string | undefined;
      if (res.status !== step.expectStatus) {
        stepErr = `Expected HTTP ${step.expectStatus}, received ${res.status}`;
      } else if (step.expectText && !text.includes(step.expectText)) {
        stepErr = `Response missing expected text "${step.expectText}"`;
      } else if (step.expectJsonKey) {
        try {
          const json = JSON.parse(text);
          if (!(step.expectJsonKey in json)) {
            stepErr = `JSON missing key "${step.expectJsonKey}"`;
          }
        } catch {
          stepErr = `Response is not valid JSON for key "${step.expectJsonKey}"`;
        }
      } else if (step.maxLatencyMs && latencyMs > step.maxLatencyMs) {
        stepErr = `Latency ${latencyMs}ms exceeded ${step.maxLatencyMs}ms budget`;
      }

      const passed = !stepErr;
      if (!passed) {
        overallStatus = "fail";
        errorMessage = `Step ${i + 1} (${step.action} ${step.target}): ${stepErr}`;
      }

      stepResults.push({
        stepIndex: i + 1,
        action: step.action,
        url,
        statusCode: res.status,
        latencyMs,
        passed,
        error: stepErr,
      });

      if (!passed) break;
    } catch (err: any) {
      const latencyMs = Math.max(1, Date.now() - t0);
      totalLatencyMs += latencyMs;
      overallStatus = "fail";
      const msg = err?.message || "Request failed";
      errorMessage = `Step ${i + 1} (${step.action} ${step.target}): ${msg}`;
      stepResults.push({
        stepIndex: i + 1,
        action: step.action,
        url,
        statusCode: null,
        latencyMs,
        passed: false,
        error: msg,
      });
      break;
    }
  }

  return { status: overallStatus, totalLatencyMs, stepResults, errorMessage };
}

/**
 * Runs a Synthetic Test across all 5 global edge regions (iad, fra, sin, syd, gru),
 * stores regional latency & step assertions, and triggers failure alerts if needed.
 */
export async function executeSyntheticTestAcrossRegions(testId: string) {
  const [test] = await db
    .select()
    .from(syntheticTests)
    .where(eq(syntheticTests.id, testId))
    .limit(1);
  if (!test) throw new Error("Synthetic test not found");

  const parsed = parseSyntheticYaml(test.yamlSpec);
  let regions: string[] = EDGE_REGIONS.map((r) => r.id);
  try {
    const raw = JSON.parse(test.regionsJson);
    if (Array.isArray(raw) && raw.length > 0) regions = raw.map(String);
  } catch {
    // fallback default 5 regions
  }

  const runsOut: Array<{ region: string; status: "pass" | "fail"; totalLatencyMs: number; errorMessage: string | null }> = [];
  const nowIso = new Date().toISOString();

  for (const region of regions.slice(0, 5)) {
    const res = await executeStepsOnce(parsed, region);
    await db.insert(syntheticRuns).values({
      id: `synr_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
      testId: test.id,
      projectId: test.projectId,
      region,
      status: res.status,
      totalLatencyMs: res.totalLatencyMs,
      stepResultsJson: JSON.stringify(res.stepResults).slice(0, 4000),
      errorMessage: res.errorMessage,
      ranAt: nowIso,
    });
    runsOut.push({
      region,
      status: res.status,
      totalLatencyMs: res.totalLatencyMs,
      errorMessage: res.errorMessage,
    });
  }

  const recentRuns = await db
    .select()
    .from(syntheticRuns)
    .where(eq(syntheticRuns.testId, test.id))
    .orderBy(desc(syntheticRuns.ranAt))
    .limit(50);

  const p95LatencyMs = computeP95Latency(recentRuns.map((r) => r.totalLatencyMs));
  const anyFail = runsOut.some((r) => r.status === "fail");
  const nextStatus = anyFail ? "fail" : "pass";

  await db
    .update(syntheticTests)
    .set({
      lastStatus: nextStatus,
      p95LatencyMs,
      lastRunAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(syntheticTests.id, test.id));

  if (anyFail) {
    const firstFail = runsOut.find((r) => r.status === "fail");
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, test.projectId))
      .limit(1);
    if (proj) {
      const webhookConfig = await resolveDecryptedWebhookConfig(proj);
      await dispatchCrashAlerts(
        webhookConfig,
        {
          eventId: `syn_${test.id}`,
          projectName: proj.name,
          projectSlug: proj.slug,
          errorName: `SyntheticFailure (${firstFail?.region?.toUpperCase()}): ${test.name}`,
          message: firstFail?.errorMessage || "Synthetic assertion failed",
          runtime: "synthetic-edge-runner",
          environment: "production",
          dashboardUrl: `https://devpulse.ritualdev.in/dashboard/uptime?project=${proj.slug}`,
        }
      ).catch(() => {});
    }
  }

  return { testId: test.id, status: nextStatus, p95LatencyMs, runs: runsOut };
}

export async function runDueSyntheticTests() {
  const active = await db
    .select()
    .from(syntheticTests)
    .where(eq(syntheticTests.isActive, true))
    .limit(15);

  const nowMs = Date.now();
  let executed = 0;

  for (const t of active) {
    const lastMs = t.lastRunAt ? Date.parse(t.lastRunAt) : 0;
    const intervalMs = Math.max(1, t.intervalMinutes) * 60_000;
    if (nowMs - lastMs >= intervalMs) {
      await executeSyntheticTestAcrossRegions(t.id).catch(() => {});
      executed++;
    }
  }

  return { totalActive: active.length, executed };
}
