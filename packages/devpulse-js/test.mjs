import assert from "assert";
import { DevPulseClient } from "./dist/index.mjs";

async function run() {
  const calls = [];
  const origFetch = globalThis.fetch;
  let shouldFail = true;

  globalThis.fetch = async (url, init) => {
    if (shouldFail) {
      throw new Error("Simulated offline mode");
    }
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true }), { status: 201 });
  };

  const client = new DevPulseClient({
    apiKey: "dp_live_test_123",
    release: "v1.2.0",
    commitSha: "abcdef1",
    autoCapture: false,
  }).init();

  client.addBreadcrumb({
    category: "custom",
    level: "info",
    message: "User alice@example.com clicked export with Bearer secret-token-1234",
    data: { password: "super-secret-value", safeField: "ok" },
  });
  const deliveredOffline = await client.captureException(
    new Error("Offline crash for bob@ritualdev.in")
  );
  assert.strictEqual(deliveredOffline, false);
  assert.ok(client.getPendingQueueSize() >= 1);

  await client.trackWebVital("LCP", 1420, "/checkout");

  // Restore connectivity and force immediate retry readiness
  shouldFail = false;
  for (const item of client.queue) item.nextAttemptAt = 0;
  const flushed = await client.flush();
  assert.ok(flushed >= 2);
  assert.strictEqual(client.getPendingQueueSize(), 0);
  const crashCall = calls.find((c) => String(c.url).endsWith("/api/v1/event"));
  assert.ok(crashCall);
  assert.strictEqual(crashCall.body.version, "v1.2.0");
  assert.strictEqual(crashCall.body.commitSha, "abcdef1");
  assert.ok(Array.isArray(crashCall.body.breadcrumbs));
  assert.ok(!crashCall.body.message.includes("bob@ritualdev.in"));
  assert.ok(crashCall.body.breadcrumbs[0].message.includes("[REDACTED_EMAIL]"));
  assert.ok(crashCall.body.breadcrumbs[0].message.includes("[REDACTED_TOKEN]"));
  assert.strictEqual(crashCall.body.breadcrumbs[0].data.password, "[REDACTED]");

  const vitalCall = calls.find(
    (c) => String(c.url).endsWith("/api/v1/analytics") && c.body.metricName === "web_vital_lcp"
  );
  assert.ok(vitalCall);
  assert.strictEqual(vitalCall.body.metricValue, 1420);
  assert.strictEqual(vitalCall.body.properties.rating, "good");

  globalThis.fetch = origFetch;
  console.log("@ritualdev/devpulse SDK tests PASSED");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
