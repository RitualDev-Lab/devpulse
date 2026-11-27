import test from "node:test";
import assert from "node:assert/strict";
import { fetchNpmDownloadsBulk } from "../src/lib/integrations/npm";

test("fetchNpmDownloadsBulk partitions scoped packages individually and batches unscoped packages", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const str = String(url);
    requestedUrls.push(str);
    if (str.includes("@ritualdev/pulse")) {
      return new Response(JSON.stringify({ downloads: 420 }), { status: 200 });
    }
    if (str.includes("zod,lucide-react")) {
      return new Response(
        JSON.stringify({
          zod: { downloads: 12000 },
          "lucide-react": { downloads: 9500 },
        }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await fetchNpmDownloadsBulk(["@ritualdev/pulse", "zod", "lucide-react"]);
    assert.equal(result["@ritualdev/pulse"], 420);
    assert.equal(result["zod"], 12000);
    assert.equal(result["lucide-react"], 9500);
    // Scoped package must never be combined with unscoped batch comma query
    assert.equal(
      requestedUrls.some((u) => u.includes("@ritualdev/pulse") && u.includes(",")),
      false
    );
    assert.equal(
      requestedUrls.some((u) => u.endsWith("/zod,lucide-react")),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
