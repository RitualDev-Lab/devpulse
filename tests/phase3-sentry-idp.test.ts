import test from "node:test";
import assert from "node:assert/strict";
import { parseSentryEnvelope, extractSentryKeyFromHeaders } from "../src/lib/telemetry/sentry-envelope";
import { parseDevPulseManifestYaml, evaluateIdpScorecard } from "../src/lib/idp/manifest";

test("parseSentryEnvelope parses Sentry v11 exception envelope, scrubs PII, and normalizes frames", () => {
  const envelope = [
    JSON.stringify({ event_id: "evt_abc123", sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      platform: "javascript",
      release: "v1.4.2",
      environment: "production",
      transaction: "/api/checkout",
      timestamp: Date.now() / 1000, // Note: check string/ms safely if seconds vs ms — testing ISO fallback here:
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Token Bearer super_secret_token_999 failed for alice@example.com",
            stacktrace: {
              frames: [{ filename: "src/app.ts", function: "handleCheckout", lineno: 42, colno: 9 }],
            },
          },
        ],
      },
    }),
  ].join("\n");

  const parsed = parseSentryEnvelope(envelope.replace(/"timestamp":[^,]+,/, `"timestamp":"${new Date().toISOString()}",`));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0].errorName, "TypeError");
    assert.equal(parsed.events[0].message.includes("super_secret_token_999"), false);
    assert.equal(parsed.events[0].message.includes("alice@example.com"), false);
    assert.match(parsed.events[0].stackTrace, /handleCheckout \(src\/app\.ts:42:9\)/);
  }

  const hdrs = new Headers({
    "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=dp_live_abc123, sentry_client=sentry.javascript/11.0.0",
  });
  assert.equal(extractSentryKeyFromHeaders(hdrs), "dp_live_abc123");
});

test("parseDevPulseManifestYaml and evaluateIdpScorecard preserve stale fallback on rate limits", () => {
  const manifest = parseDevPulseManifestYaml(`
service: devpulse
tier: tier-1
owner: security@ritualdev.in
minOpenSsfScore: 7.5
maxCriticalCves: 0
ecosystems:
  - npm:@ritualdev/pulse
  - pypi:devpulse-sdk
`);
  assert.equal(manifest.service, "devpulse");
  assert.equal(manifest.ecosystems.length, 2);

  const gold = evaluateIdpScorecard({
    manifest,
    openSsfScore: 8.2,
    criticalCves: 0,
    crashFreeRate: 99.8,
    hasSlsaProvenance: true,
  });
  assert.equal(gold.grade, "Gold");

  const rateLimited = evaluateIdpScorecard({
    manifest,
    openSsfScore: 0,
    upstreamRateLimited: true,
    lastKnownGrade: "Gold",
  });
  assert.equal(rateLimited.staleFallbackUsed, true);
  assert.equal(rateLimited.grade, "Gold");
});
