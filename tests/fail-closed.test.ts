import test, { afterEach, before } from "node:test";
import assert from "node:assert/strict";

// Point the DB client at a closed local port so storage calls fail for real.
process.env.TURSO_DATABASE_URL = "http://127.0.0.1:9";
process.env.TURSO_AUTH_TOKEN = "test-token";

type RateLimitModule = typeof import("../src/lib/security/rate-limit");
let mod: RateLimitModule;

before(async () => {
  mod = await import("../src/lib/security/rate-limit");
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TURNSTILE_SECRET_KEY;
});

test("rate limiter denies requests when counter storage is unavailable", async () => {
  const result = await mod.checkRateLimit({ key: "test:fail-closed", limit: 100, windowSeconds: 60 });
  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
  assert.ok(result.retryAfterSeconds >= 1);
});

test("Turnstile fails closed when no secret is configured", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  const result = await mod.verifyTurnstileToken("any-token", "203.0.113.5");
  assert.equal(result.ok, false);
});

test("Turnstile rejects a missing token when a secret is configured", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  const result = await mod.verifyTurnstileToken("   ", "203.0.113.5");
  assert.equal(result.ok, false);
});

test("Turnstile rejects a token Cloudflare reports as invalid", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const result = await mod.verifyTurnstileToken("bad-token", "203.0.113.5");
  assert.equal(result.ok, false);
});

test("Turnstile does not leak internal error text when the verify service fails", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  globalThis.fetch = (async () => {
    throw new Error("internal socket detail 10.0.0.7:443");
  }) as typeof fetch;
  const result = await mod.verifyTurnstileToken("token", "203.0.113.5");
  assert.equal(result.ok, false);
  assert.equal(result.error?.includes("10.0.0.7"), false);
});

test("Turnstile accepts a token Cloudflare reports as valid", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: true }), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const result = await mod.verifyTurnstileToken("good-token", "203.0.113.5");
  assert.equal(result.ok, true);
});
