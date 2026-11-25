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
    new Error("Offline crash for bob@example.com")
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
  assert.ok(!crashCall.body.message.includes("bob@example.com"));
  assert.ok(crashCall.body.breadcrumbs[0].message.includes("[REDACTED_EMAIL]"));
  assert.ok(crashCall.body.breadcrumbs[0].message.includes("[REDACTED_TOKEN]"));
  assert.strictEqual(crashCall.body.breadcrumbs[0].data.password, "[REDACTED]");

  const vitalCall = calls.find(
    (c) => String(c.url).endsWith("/api/v1/analytics") && c.body.metricName === "web_vital_lcp"
  );
  assert.ok(vitalCall);
  assert.strictEqual(vitalCall.body.metricValue, 1420);
  assert.strictEqual(vitalCall.body.properties.rating, "good");

  // Oversize payloads are refused and never sent or queued as a truncated (invalid) JSON body.
  const queuedBefore = client.getPendingQueueSize();
  const oversizeSent = await client.trackWebVital("LCP", 1, "/" + "x".repeat(60000));
  assert.strictEqual(oversizeSent, false);
  assert.strictEqual(client.getPendingQueueSize(), queuedBefore);
  assert.ok(calls.every((c) => typeof c.body === "object"));

  // Flag evaluation sends the key in the Authorization header, never in the URL.
  let flagUrl = "";
  let flagAuth = "";
  globalThis.fetch = async (url, init) => {
    flagUrl = String(url);
    flagAuth = init?.headers?.Authorization || "";
    return new Response(JSON.stringify({ flags: { beta: true }, variants: {} }), { status: 200 });
  };
  assert.strictEqual(await client.flag("beta", { userId: "u1" }), true);
  assert.ok(!flagUrl.includes("apiKey"));
  assert.ok(!flagUrl.includes("dp_live_test_123"));
  assert.strictEqual(flagAuth, "Bearer dp_live_test_123");

  globalThis.fetch = origFetch;
  console.log("@ritualdev/devpulse SDK tests PASSED");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
