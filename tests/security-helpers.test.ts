import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { isPublicDemoProject } from "../src/lib/security/demo-project";
import { apiError } from "../src/lib/security/api-error";

afterEach(() => {
  delete process.env.DEVPULSE_PUBLIC_DEMO_PROJECT;
});

test("demo project is not public unless the operator opts in", () => {
  assert.equal(isPublicDemoProject("prj_ritual_core"), false);
  process.env.DEVPULSE_PUBLIC_DEMO_PROJECT = "true";
  assert.equal(isPublicDemoProject("prj_ritual_core"), true);
  assert.equal(isPublicDemoProject("prj_customer_123"), false);
  assert.equal(isPublicDemoProject(null), false);
});

test("apiError returns a generic message and never echoes the underlying error", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const res = apiError(new Error("connect ECONNREFUSED 10.0.0.7:5432 password=hunter2"), "Internal Server Error", 500);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.deepEqual(body, { error: "Internal Server Error" });
    assert.ok(!JSON.stringify(body).includes("10.0.0.7"));
  } finally {
    console.error = origError;
  }
});

test("ingest scrubber removes emails, sensitive keys, and query secrets", async () => {
  const { scrubTelemetryText, scrubTelemetryValue } = await import("../src/lib/security/ingest-scrub");
  const text = scrubTelemetryText("GET /checkout?email=jane@example.com&token=abc123secret user jane@example.com");
  assert.ok(!text.includes("jane@example.com"));
  assert.ok(!text.includes("abc123secret"));
  const value = scrubTelemetryValue({ "user.email": "jane@example.com", password: "hunter2", "http.route": "/api/pay" }) as Record<string, unknown>;
  assert.equal(value.password, "[REDACTED]");
  assert.ok(!JSON.stringify(value).includes("jane@example.com"));
  assert.equal(value["http.route"], "/api/pay");
});
