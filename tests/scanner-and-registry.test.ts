import test from "node:test";
import assert from "node:assert/strict";
import { fetchNpmStats } from "../src/lib/integrations/npm";
import { fetchPyPiStats } from "../src/lib/integrations/pypi";
import { scanGitHubRepository } from "../src/lib/scanner/github-scanner";

function mockJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("fetchNpmStats returns null for unpublished/404 packages instead of fabricating MIT/0 deps", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => mockJsonResponse(404, { error: "Not found" });

  const stats = await fetchNpmStats("@ritualdev-lab/poly-web");
  assert.equal(stats, null);
});

test("fetchPyPiStats returns null when PyPI and pypistats both return 404", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => mockJsonResponse(404, { message: "Not Found" });

  const stats = await fetchPyPiStats("nonexistent-devpulse-pkg-xyz");
  assert.equal(stats, null);
});

test("scanGitHubRepository skips private package.json and unpublished registry manifests", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const encodeContent = (obj: unknown) =>
    Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj), "utf8").toString("base64");

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://api.github.com/repos/RitualDev-Lab/poly-web") {
      return mockJsonResponse(200, {
        name: "poly-web",
        description: "Web app",
        stargazers_count: 1,
        forks_count: 0,
        language: "TypeScript",
        default_branch: "main",
      });
    }
    if (url === "https://api.github.com/repos/RitualDev-Lab/poly-web/contents") {
      return mockJsonResponse(200, [
        { name: "package.json", path: "package.json", type: "file" },
        { name: "Dockerfile", path: "Dockerfile", type: "file" },
      ]);
    }
    if (url === "https://api.github.com/repos/RitualDev-Lab/poly-web/contents/package.json") {
      return mockJsonResponse(200, {
        encoding: "base64",
        content: encodeContent({ name: "@ritualdev-lab/poly-web", private: true, version: "1.0.0" }),
      });
    }
    if (url === "https://hub.docker.com/v2/repositories/ritualdev-lab/poly-web") {
      return mockJsonResponse(404, { message: "not found" });
    }
    return mockJsonResponse(404, {});
  };

  const scanned = await scanGitHubRepository("RitualDev-Lab/poly-web");
  assert.equal(scanned.detectedEcosystems.npmPackage, undefined);
  assert.equal(scanned.detectedEcosystems.dockerImage, undefined);
});

test("scanGitHubRepository skips public-looking package.json when npm registry returns 404, and links when published", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const encodeContent = (obj: unknown) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
  let published = false;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.github.com/repos/Acme/lib") {
      return mockJsonResponse(200, { name: "lib", default_branch: "main" });
    }
    if (url === "https://api.github.com/repos/Acme/lib/contents") {
      return mockJsonResponse(200, [{ name: "package.json", path: "package.json", type: "file" }]);
    }
    if (url === "https://api.github.com/repos/Acme/lib/contents/package.json") {
      return mockJsonResponse(200, {
        encoding: "base64",
        content: encodeContent({ name: "@acme/lib", version: "1.0.0" }),
      });
    }
    if (url === "https://registry.npmjs.org/@acme/lib") {
      return published ? mockJsonResponse(200, { name: "@acme/lib" }) : mockJsonResponse(404, {});
    }
    return mockJsonResponse(404, {});
  };

  const unpublishedScan = await scanGitHubRepository("Acme/lib");
  assert.equal(unpublishedScan.detectedEcosystems.npmPackage, undefined);

  published = true;
  const publishedScan = await scanGitHubRepository("Acme/lib");
  assert.equal(publishedScan.detectedEcosystems.npmPackage, "@acme/lib");
});
