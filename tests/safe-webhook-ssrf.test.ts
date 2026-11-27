import test from "node:test";
import assert from "node:assert/strict";
import { validateResolvedPublicUrl } from "../src/lib/security/ssrf";
import {
  safeWebhookPost,
  _resetWebhookCircuitsForTest,
  _expireWebhookCircuitForTest,
} from "../src/lib/security/safe-http";

test("validateResolvedPublicUrl blocks DNS rebinding to private or loopback IPs", async () => {
  const blocked = await validateResolvedPublicUrl("https://rebind.attacker.example/hook", {
    resolver: async () => ["127.0.0.1"],
  });
  assert.equal(blocked.valid, false);
  assert.match(blocked.reason || "", /blocked private\/internal IP/i);

  const blockedMeta = await validateResolvedPublicUrl("https://meta.attacker.example/hook", {
    resolver: async () => ["169.254.169.254"],
  });
  assert.equal(blockedMeta.valid, false);

  const ok = await validateResolvedPublicUrl("https://discord.com/api/webhooks/1/2", {
    resolver: async () => ["162.159.136.232"],
  });
  assert.equal(ok.valid, true);
});

test("safeWebhookPost enforces redirect error, timeout abort, and per-host circuit breaker", async () => {
  _resetWebhookCircuitsForTest();
  const originalFetch = globalThis.fetch;
  let seenRedirect: RequestRedirect | undefined;
  let hasSignal = false;
  let fetchCalls = 0;

  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls++;
    seenRedirect = init?.redirect;
    hasSignal = Boolean(init?.signal);
    return new Response("upstream error", { status: 503 });
  }) as typeof fetch;

  try {
    // 3 consecutive failing calls trip circuit breaker on the host
    for (let i = 0; i < 3; i++) {
      const r = await safeWebhookPost({
        url: "https://hooks.slow-destination.example/ingest",
        body: { ok: false },
        maxRetries: 0,
        dnsResolver: async () => ["93.184.216.34"],
      });
      assert.equal(r.ok, false);
    }

    assert.equal(seenRedirect, "error");
    assert.equal(hasSignal, true);
    assert.equal(fetchCalls, 3);

    // 4th call should short-circuit immediately without hitting fetch()
    const tripped = await safeWebhookPost({
      url: "https://hooks.slow-destination.example/ingest",
      body: { ok: false },
      maxRetries: 0,
      dnsResolver: async () => ["93.184.216.34"],
    });
    assert.equal(tripped.ok, false);
    assert.equal(tripped.circuitOpen, true);
    assert.equal(fetchCalls, 3);

    // After cooldown expires, circuit recovers and closes on healthy 200 response
    _expireWebhookCircuitForTest("hooks.slow-destination.example");
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const recovered = await safeWebhookPost({
      url: "https://hooks.slow-destination.example/ingest",
      body: { ok: true },
      maxRetries: 0,
      dnsResolver: async () => ["93.184.216.34"],
    });
    assert.equal(recovered.ok, true);
    assert.equal(fetchCalls, 4);

    // Timeout / AbortError handling
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    const timedOut = await safeWebhookPost({
      url: "https://timeout.destination.example/ingest",
      body: { ok: true },
      maxRetries: 0,
      dnsResolver: async () => ["93.184.216.34"],
    });
    assert.equal(timedOut.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    _resetWebhookCircuitsForTest();
  }
});
