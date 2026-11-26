import test from "node:test";
import assert from "node:assert/strict";
import {
  REGISTRY_ADAPTERS,
  normalizeRegistryProvider,
  securitySummaryKey,
  formatRelativeSyncAge,
} from "../src/lib/integrations/registry-adapter";
import { fetchDepsDevSummary } from "../src/lib/integrations/deps-dev";

test("registry adapter normalizes providers, security keys, and relative sync ages", () => {
  assert.equal(normalizeRegistryProvider("Crates.io"), "crates");
  assert.equal(normalizeRegistryProvider("golang"), "go");
  assert.equal(normalizeRegistryProvider("PYPI"), "pypi");
  assert.equal(normalizeRegistryProvider("unknown"), null);

  assert.equal(REGISTRY_ADAPTERS.npm.depsDevSystem, "NPM");
  assert.equal(REGISTRY_ADAPTERS.pypi.buildUrl("fastapi"), "https://pypi.org/project/fastapi/");
  assert.equal(securitySummaryKey("NPM", "@RitualDev/DevPulse"), "NPM:@ritualdev/devpulse");

  const now = Date.UTC(2026, 10, 26, 12, 0, 0);
  assert.equal(formatRelativeSyncAge(new Date(now - 20_000).toISOString(), now), "Synced just now");
  assert.equal(formatRelativeSyncAge(new Date(now - 180_000).toISOString(), now), "Synced 3m ago");
  assert.equal(formatRelativeSyncAge(new Date(now - 7_200_000).toISOString(), now), "Synced 2h ago");
  assert.equal(formatRelativeSyncAge(null, now), "Not synced yet");
});

test("fetchDepsDevSummary extracts OSV advisory count, licenses, and OpenSSF scorecard", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/packages/express")) {
      return new Response(
        JSON.stringify({
          versions: [{ versionKey: { version: "4.21.0" }, isDefault: true }],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/versions/4.21.0")) {
      return new Response(
        JSON.stringify({
          advisoryKeys: [{ id: "GHSA-1234" }],
          licenses: ["MIT"],
          links: [{ label: "SOURCE_REPO", url: "https://github.com/expressjs/express" }],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/projects/github.com%2Fexpressjs%2Fexpress")) {
      return new Response(
        JSON.stringify({ scorecard: { overallScore: 7.4 } }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 404 });
  };

  const summary = await fetchDepsDevSummary("NPM", "express");
  assert.ok(summary);
  assert.equal(summary.defaultVersion, "4.21.0");
  assert.equal(summary.advisoryCount, 1);
  assert.deepEqual(summary.licenses, ["MIT"]);
  assert.equal(summary.scorecardOverall, 7.4);
});
