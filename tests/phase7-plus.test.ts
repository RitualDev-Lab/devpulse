import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectSbomReport, isSpdxApprovedLicense, normalizeOsvSeverity } from "../src/lib/security/sbom";
import { isWindowActiveAt, parseMaintenanceMetadata } from "../src/lib/monitors/maintenance-eval";
import { buildPrIntelligenceComment, PR_BOT_MARKER } from "../src/lib/integrations/pr-bot";
import { aggregateMcpMetrics, computePercentile } from "../src/lib/integrations/mcp-analytics";
import { detectLogErrorSpike, extractJsonFieldsFromLog } from "../src/lib/logs/spike-detector";
import { getPlanQuotas } from "../src/lib/billing/plans";

test("SBOM builder normalizes packages, SPDX compliance, and OSV severity", async () => {
  assert.equal(isSpdxApprovedLicense("MIT"), true);
  assert.equal(isSpdxApprovedLicense("MIT OR Apache-2.0"), true);
  assert.equal(isSpdxApprovedLicense("PROPRIETARY"), false);
  assert.equal(normalizeOsvSeverity({ severity: [{ score: "9.8" }] }), "CRITICAL");
  assert.equal(normalizeOsvSeverity({ database_specific: { severity: "moderate" } }), "MEDIUM");

  const report = await buildProjectSbomReport({
    project: { npmPackage: "@ritualdev/pulse", pypiPackage: "devpulse-sdk" },
    npmStats: { latestVersion: "1.4.2", license: "MIT" },
    pypiStats: { latestVersion: "1.1.0", license: "Apache-2.0" },
    packageSecurity: {
      "npm:@ritualdev/pulse": {
        system: "NPM",
        packageName: "@ritualdev/pulse",
        defaultVersion: "1.4.2",
        advisoryCount: 0,
        licenses: ["MIT"],
        scorecardOverall: 8.5,
        sourceRepo: "github.com/RitualDev-Lab/devpulse",
      },
    },
    skipRemoteOsv: true,
  });

  assert.equal(report.totalPackages, 2);
  assert.equal(report.spdxApprovedCount, 2);
  assert.equal(report.packages[0].scorecardOverall, 8.5);
});

test("Maintenance window parser evaluates active window boundaries accurately", () => {
  const meta = parseMaintenanceMetadata(
    JSON.stringify({
      startsAt: "2026-11-27T01:00:00.000Z",
      endsAt: "2026-11-27T02:00:00.000Z",
      suppressAlerts: true,
    })
  );
  assert.ok(meta);
  assert.equal(isWindowActiveAt(meta, Date.parse("2026-11-27T01:30:00.000Z")), true);
  assert.equal(isWindowActiveAt(meta, Date.parse("2026-11-27T02:30:00.000Z")), false);
});

test("PR Intelligence comment formats Web Vitals, CVEs, and open crashes with bot marker", () => {
  const md = buildPrIntelligenceComment({
    projectName: "RitualDev Pulse",
    projectSlug: "devpulse",
    prNumber: 42,
    branch: "feat/sbom",
    previewUrl: "https://pr-42.pages.dev",
    webVitalsDelta: { lcpMs: 1450, inpMs: 85, cls: 0.04 },
    vulnerabilities: [{ packageName: "zod", ecosystem: "npm", severity: "HIGH", id: "GHSA-123" }],
    touchedCrashes: [{ errorName: "TypeError", count: 7, topFrame: "at checkout.ts:12" }],
  });

  assert.ok(md.startsWith(PR_BOT_MARKER));
  assert.match(md, /LCP p75:.*1450 ms/);
  assert.match(md, /GHSA-123/);
  assert.match(md, /`TypeError` \(7 occurrences\)/);
});

test("MCP analytics aggregates p50/p95 latency, denial counts, and estimated token spend", () => {
  assert.equal(computePercentile([10, 20, 30, 40, 100], 95), 100);
  const agg = aggregateMcpMetrics([
    { toolName: "query_logs", outcome: "allowed", durationMs: 100, createdAt: "2026-11-26 10:00:00" },
    { toolName: "query_logs", outcome: "denied", durationMs: 0, createdAt: "2026-11-26 11:00:00" },
    { toolName: "inspect_crashes", outcome: "error", durationMs: 300, createdAt: "2026-11-26 12:00:00" },
  ]);

  assert.equal(agg.totalCalls, 3);
  assert.equal(agg.deniedCount, 1);
  assert.equal(agg.errorCount, 1);
  assert.equal(agg.p95DurationMs, 300);
  assert.ok(agg.estimatedCostUsd > 0);
});

test("Log field extractor and spike anomaly detector identify 3x error surges", () => {
  const fields = extractJsonFieldsFromLog(
    'Payment failed status=502 latency=41ms {"orderId":"ord_9"}',
    '{"env":"production"}'
  );
  assert.equal(fields.env, "production");
  assert.equal(fields.status, "502");
  assert.equal(fields.orderId, "ord_9");

  const now = Date.parse("2026-11-27T05:00:00.000Z");
  const spike = detectLogErrorSpike(
    [
      ...Array.from({ length: 8 }, (_, i) => ({ level: "error", timestampMs: now - i * 60_000 })),
      { level: "error", timestampMs: now - 4 * 3600_000 },
    ],
    now
  );
  assert.equal(spike.isSpike, true);
  assert.equal(spike.currentErrorCount, 8);
});

test("Billing plan quotas scale properly across free, pro, and team tiers", () => {
  assert.equal(getPlanQuotas("free").maxEventsPerMonth, 10_000);
  assert.equal(getPlanQuotas("pro").maxPackages, 30);
  assert.equal(getPlanQuotas("team").maxHeartbeats, null);
});
