import test from "node:test";
import assert from "node:assert/strict";
import { normalizePep503PackageName, fetchPyPiStats } from "../src/lib/integrations/pypi";
import { tenantCacheKey } from "../src/lib/integrations/cached";
import { formatMetricNumber } from "../src/lib/charts/formatters";

test("normalizePep503PackageName normalizes dots, underscores, and mixed casing", () => {
  assert.equal(normalizePep503PackageName("My.Cool_Package--Name"), "my-cool-package-name");
});

test("fetchPyPiStats guards null author and requires_dist metadata cleanly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith("/recent")) {
      return new Response(JSON.stringify({ data: { last_day: 5, last_week: 30, last_month: 120 } }), { status: 200 });
    }
    if (u.includes("/overall")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (u.endsWith("/json")) {
      return new Response(
        JSON.stringify({
          info: { version: "1.0.0", author: null, author_email: "dev@ritualdev.in", requires_dist: null },
          releases: { "1.0.0": [] },
        }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const res = await fetchPyPiStats("Demo.Pkg_Name");
    assert.equal(res?.author, "dev@ritualdev.in");
    assert.deepEqual(res?.requiresDist, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tenantCacheKey enforces mandatory tenant prefix and formatMetricNumber handles undefined", () => {
  assert.equal(tenantCacheKey("org_123", "npm:@ritualdev/pulse"), "tenant:org_123:npm:@ritualdev/pulse");
  assert.throws(() => tenantCacheKey("", "npm:zod"));
  assert.equal(formatMetricNumber(undefined), "—");
  assert.equal(formatMetricNumber(null), "—");
  assert.equal(formatMetricNumber(1420), "1,420");
});
