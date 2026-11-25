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

  client.addBreadcrumb({ category: "custom", level: "info", message: "User clicked export" });
  const deliveredOffline = await client.captureException(new Error("Offline crash"));
  assert.strictEqual(deliveredOffline, false);
  assert.ok(client.getPendingQueueSize() >= 1);

  // Restore connectivity and force immediate retry readiness
  shouldFail = false;
  for (const item of client.queue) item.nextAttemptAt = 0;
  const flushed = await client.flush();
  assert.ok(flushed >= 1);
  assert.strictEqual(client.getPendingQueueSize(), 0);
  const crashCall = calls.find((c) => String(c.url).endsWith("/api/v1/event"));
  assert.ok(crashCall);
  assert.strictEqual(crashCall.body.version, "v1.2.0");
  assert.strictEqual(crashCall.body.commitSha, "abcdef1");
  assert.ok(Array.isArray(crashCall.body.breadcrumbs));

  globalThis.fetch = origFetch;
  console.log("@ritualdev/devpulse SDK tests PASSED");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
