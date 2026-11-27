import test from "node:test";
import assert from "node:assert/strict";
import { scrubTelemetryText, scrubTelemetryValue, scrubBreadcrumbs } from "../src/lib/security/ingest-scrub";

test("scrubTelemetryText redacts bearer tokens, JWTs, API keys, URL secrets, and emails", () => {
  const bearerCanary = "Bearer super_secret_oauth_token_12345";
  const jwtCanary = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.s3cr3tS1gnatur3";
  const ghpCanary = "ghp_1234567890abcdefghijklmnop";
  const stripeCanary = "sk_live_9876543210abcdefghij";
  const emailCanary = "alice.maintainer@ritualdev.in";
  const queryCanary = "https://devpulse.ritualdev.in/cb?api_key=very_secret_key&foo=bar";

  const payload = [bearerCanary, jwtCanary, ghpCanary, stripeCanary, emailCanary, queryCanary].join(" | ");
  const scrubbed = scrubTelemetryText(payload);

  assert.equal(scrubbed.includes("super_secret_oauth_token_12345"), false);
  assert.equal(scrubbed.includes(jwtCanary), false);
  assert.equal(scrubbed.includes(ghpCanary), false);
  assert.equal(scrubbed.includes(stripeCanary), false);
  assert.equal(scrubbed.includes(emailCanary), false);
  assert.equal(scrubbed.includes("very_secret_key"), false);
  assert.match(scrubbed, /\[REDACTED_TOKEN\]/);
  assert.match(scrubbed, /\[REDACTED_JWT\]/);
  assert.match(scrubbed, /\[REDACTED_EMAIL\]/);
});

test("scrubTelemetryValue and scrubBreadcrumbs redact sensitive keys recursively", () => {
  const breadcrumbs = scrubBreadcrumbs([
    {
      type: "http",
      data: {
        url: "/api/login?password=canary_password_99",
        authorization: "Bearer leaked_header_value_999",
        userEmail: "bob@example.com",
      },
    },
  ]);

  const serialized = JSON.stringify(scrubTelemetryValue({ secret: "canary_top_secret", breadcrumbs }));
  assert.equal(serialized.includes("canary_password_99"), false);
  assert.equal(serialized.includes("leaked_header_value_999"), false);
  assert.equal(serialized.includes("bob@example.com"), false);
  assert.equal(serialized.includes("canary_top_secret"), false);
});
