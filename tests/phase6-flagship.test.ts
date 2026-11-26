import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHeartbeatDue, parseHeartbeatMetadata } from "../src/lib/monitors/heartbeat-eval";
import { aggregateWebVitals, computePercentile, rateWebVital } from "../src/lib/analytics/rum-vitals";
import { DevPulseClient } from "../packages/devpulse-js/src/index";

test("Cron Heartbeat evaluates overdue schedules and max runtime timeouts accurately", () => {
  const now = Date.UTC(2026, 10, 27, 10, 0, 0);
  const okMeta = parseHeartbeatMetadata(
    JSON.stringify({
      intervalMinutes: 60,
      graceMinutes: 5,
      state: "up",
      nextDueAt: new Date(now + 120_000).toISOString(),
    })
  );
  assert.equal(evaluateHeartbeatDue(okMeta, now).overdue, false);

  const missedMeta = parseHeartbeatMetadata(
    JSON.stringify({
      intervalMinutes: 60,
      graceMinutes: 5,
      state: "up",
      nextDueAt: new Date(now - 6 * 60_000).toISOString(),
    })
  );
  assert.equal(evaluateHeartbeatDue(missedMeta, now).overdue, true);

  const stalledMeta = parseHeartbeatMetadata(
    JSON.stringify({
      intervalMinutes: 60,
      graceMinutes: 5,
      maxDurationSeconds: 120,
      state: "running",
      startedAt: new Date(now - 180_000).toISOString(),
    })
  );
  const stalled = evaluateHeartbeatDue(stalledMeta, now);
  assert.equal(stalled.overdue, true);
  assert.ok(stalled.reason?.includes("Exceeded max runtime"));
});

test("RUM Core Web Vitals aggregator computes p50/p75/p95 and cohort breakdowns", () => {
  assert.equal(computePercentile([100, 200, 300, 400], 50), 200);
  assert.equal(computePercentile([100, 200, 300, 400], 75), 300);
  assert.equal(rateWebVital("LCP", 2100), "good");
  assert.equal(rateWebVital("INP", 350), "needs_improvement");
  assert.equal(rateWebVital("CLS", 0.31), "poor");

  const summary = aggregateWebVitals([
    { metric: "LCP", value: 1800, route: "/pricing", country: "US", browser: "chrome", release: "v2.0" },
    { metric: "LCP", value: 2400, route: "/pricing", country: "US", browser: "chrome", release: "v2.0" },
    { metric: "INP", value: 110, route: "/pricing", country: "IN", browser: "firefox", release: "v2.1" },
    { metric: "CLS", value: 0.04, route: "/docs", country: "DE", browser: "safari", release: "v2.1" },
    { metric: "TTFB", value: 420, route: "/docs", country: "DE", browser: "safari", release: "v2.1" },
  ]);

  assert.equal(summary.sampleCount, 5);
  assert.equal(summary.metrics.LCP?.p75, 2400);
  assert.equal(summary.metrics.LCP?.rating, "good");
  assert.equal(summary.metrics.INP?.p50, 110);
  assert.equal(summary.metrics.CLS?.p75, 0.04);
  assert.equal(summary.byRoute[0].key, "/pricing");
  assert.equal(summary.byRelease[0].key, "v2.1");
});

test("@ritualdev/devpulse records PII-scrubbed Session Replay timeline frames", () => {
  const client = new DevPulseClient({ apiKey: "dp_live_replay_test", autoCapture: false, captureWebVitals: false });
  client.recordReplayFrame("click", "Clicked <button> Pay Bearer tokensecret123", "email alice@acme.dev");
  client.recordReplayFrame("network", "POST /api/checkout", "500 Internal Error");

  const timeline = client.getReplayTimeline();
  assert.equal(timeline.length, 2);
  assert.ok(!timeline[0].label.includes("tokensecret123"));
  assert.ok(!String(timeline[0].detail || "").includes("alice@acme.dev"));
  assert.ok(timeline[0].offsetMs <= 0);
});
