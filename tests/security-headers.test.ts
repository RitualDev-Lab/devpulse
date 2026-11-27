import test from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { applySecurityHeaders } from "../src/lib/security/headers";

test("applySecurityHeaders enforces OWASP 2026 baseline headers and scopes no-store + CSP framing", () => {
  const apiRes = applySecurityHeaders(NextResponse.next(), "/api/v1/event");
  assert.equal(apiRes.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(apiRes.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(apiRes.headers.get("X-XSS-Protection"), "0");
  assert.match(apiRes.headers.get("Strict-Transport-Security") || "", /max-age=31536000/);
  assert.match(apiRes.headers.get("Content-Security-Policy-Report-Only") || "", /frame-ancestors 'none'/);
  assert.match(apiRes.headers.get("Cache-Control") || "", /no-store/);

  const embedRes = applySecurityHeaders(NextResponse.next(), "/embed/demo");
  assert.match(embedRes.headers.get("Content-Security-Policy-Report-Only") || "", /frame-ancestors \*/);
});
