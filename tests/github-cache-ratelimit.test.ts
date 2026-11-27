import test from "node:test";
import assert from "node:assert/strict";
import { fetchGitHubRepoStats, _clearGitHubClientCacheForTest } from "../src/lib/integrations/github";

test("fetchGitHubRepoStats sends If-None-Match ETag and reuses cached repo metadata on 304", async () => {
  _clearGitHubClientCacheForTest();
  const originalFetch = globalThis.fetch;
  let seenIfNoneMatch: string | null = null;
  let callCount = 0;

  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const str = String(url);
    const hdrs = (init?.headers || {}) as Record<string, string>;
    if (str.endsWith("/repos/ritualdev-lab/devpulse")) {
      callCount++;
      seenIfNoneMatch = hdrs["If-None-Match"] || null;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            full_name: "ritualdev-lab/devpulse",
            stargazers_count: 120,
            forks_count: 14,
            open_issues_count: 2,
          }),
          { status: 200, headers: { ETag: '"etag-v1"' } }
        );
      }
      return new Response(null, { status: 304 });
    }
    return new Response("[]", { status: 200 });
  }) as typeof fetch;

  try {
    const first = await fetchGitHubRepoStats("ritualdev-lab/devpulse");
    assert.equal(first?.stars, 120);
    const second = await fetchGitHubRepoStats("ritualdev-lab/devpulse");
    assert.equal(seenIfNoneMatch, '"etag-v1"');
    assert.equal(second?.stars, 120);
  } finally {
    globalThis.fetch = originalFetch;
    _clearGitHubClientCacheForTest();
  }
});
