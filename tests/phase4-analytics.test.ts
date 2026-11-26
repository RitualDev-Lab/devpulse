import test from "node:test";
import assert from "node:assert/strict";
import { buildFunnelResults, parseFunnelSteps } from "../src/lib/analytics/engagement";
import { summarizeRevenueAtRisk } from "../src/lib/revenue/revenue-risk";
import { parseMcpToolAllowlist } from "../src/lib/integrations/mcp-policy";

const now = new Date("2025-05-20T12:00:00.000Z");

test("event funnels calculate sequential user conversion and sanitize counts", () => {
  assert.deepEqual(buildFunnelResults(["start", "finish"], [10, 4]), [
    { event: "start", users: 10, conversionFromPrevious: null, conversionFromStart: null },
    { event: "finish", users: 4, conversionFromPrevious: 40, conversionFromStart: 40 },
  ]);
  assert.equal(buildFunnelResults(["one"], [-2])[0].users, 0);
  assert.throws(() => buildFunnelResults(["one"], []));
  assert.throws(() => buildFunnelResults(["start", "next"], [2, 3]));
});

test("funnel steps are deduplicated, bounded, and capped at five", () => {
  assert.deepEqual(parseFunnelSteps(" signup, checkout ,signup,pay,confirm,done,ignored "), ["signup", "checkout", "pay", "confirm", "done"]);
  assert.deepEqual(parseFunnelSteps(null), []);
});

test("revenue risk separates currencies, statuses, and the 30-day window", () => {
  const result = summarizeRevenueAtRisk([
    { amountMinor: 1200, currency: "usd", status: "succeeded", createdAt: "2025-05-19T12:00:00.000Z", provider: "stripe" },
    { amountMinor: 250, currency: "USD", status: "processing", createdAt: "2025-05-19T12:00:00.000Z", provider: "stripe" },
    { amountMinor: 300, currency: "EUR", status: "refunded", createdAt: "2025-05-19T12:00:00.000Z", provider: "dodo" },
    { amountMinor: 900, currency: "USD", status: "succeeded", createdAt: "2025-04-01T00:00:00.000Z", provider: "stripe" },
    { amountMinor: 700, currency: "USD", status: "authorized", createdAt: "2025-05-21T00:00:00.000Z", provider: "stripe" },
  ], now);
  assert.deepEqual(result, [
    { currency: "EUR", transactionCount: 1, settledAmountMinor: 0, pendingAmountMinor: 0, failedAmountMinor: 0, refundedAmountMinor: 300, chargebackAmountMinor: 0, exposedAmountMinor: 0, riskScorePercent: 0, providers: ["dodo"], sampleLimited: false },
    { currency: "USD", transactionCount: 2, settledAmountMinor: 1200, pendingAmountMinor: 250, failedAmountMinor: 0, refundedAmountMinor: 0, chargebackAmountMinor: 0, exposedAmountMinor: 250, riskScorePercent: 17, providers: ["stripe"], sampleLimited: false },
  ]);
});

test("unpaid invoices count as exposure, uncollectible ones as failed, and unknown states are ignored", () => {
  const rows = [
    { amountMinor: 1000, currency: "USD", status: "succeeded", createdAt: "2025-05-19T12:00:00.000Z", provider: "stripe" },
    { amountMinor: 500, currency: "USD", status: "past_due", createdAt: "2025-05-19T12:00:00.000Z", provider: "stripe" },
    { amountMinor: 500, currency: "USD", status: "open", createdAt: "2025-05-19T12:00:00.000Z", provider: "stripe" },
    { amountMinor: 400, currency: "USD", status: "uncollectible", createdAt: "2025-05-19T12:00:00.000Z", provider: "stripe" },
    { amountMinor: 300, currency: "USD", status: "mystery_state", createdAt: "2025-05-19T12:00:00.000Z", provider: "stripe" },
  ];
  const [usd] = summarizeRevenueAtRisk(rows, now);
  assert.equal(usd.settledAmountMinor, 1000);
  assert.equal(usd.pendingAmountMinor, 1000);
  assert.equal(usd.failedAmountMinor, 400);
  assert.equal(usd.exposedAmountMinor, 1000);
  assert.equal(usd.riskScorePercent, 50);
});

test("risk output reports when it was computed from a truncated recent sample", () => {
  const row = { amountMinor: 100, currency: "USD", status: "pending", createdAt: "2025-05-19T12:00:00.000Z", provider: "stripe" };
  assert.equal(summarizeRevenueAtRisk([row], now, { sampleLimited: true })[0].sampleLimited, true);
  assert.equal(summarizeRevenueAtRisk([row], now)[0].sampleLimited, false);
});

test("MCP allowlists default open only when no policy exists, invalid policies fail closed", () => {
  assert.equal(parseMcpToolAllowlist(null), null);
  assert.deepEqual(parseMcpToolAllowlist("[\"list_crashes\",\"bad\",\"list_crashes\"]"), ["list_crashes"]);
  assert.deepEqual(parseMcpToolAllowlist("not-json"), []);
});
