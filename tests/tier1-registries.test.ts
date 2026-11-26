import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectorInput } from "../src/lib/integrations/url-parser";
import { normalizeRegistryProvider, REGISTRY_ADAPTERS } from "../src/lib/integrations/registry-adapter";
import { fetchNuGetStats } from "../src/lib/integrations/nuget";
import { fetchRubyGemStats } from "../src/lib/integrations/rubygems";
import { fetchPackagistStats } from "../src/lib/integrations/packagist";
import { fetchPubDevStats } from "../src/lib/integrations/pubdev";
import { fetchJsrStats } from "../src/lib/integrations/jsr";
import { fetchHexStats } from "../src/lib/integrations/hex";
import { fetchAnacondaStats } from "../src/lib/integrations/anaconda";
import { fetchCranStats } from "../src/lib/integrations/cran";
import { fetchHomebrewStats } from "../src/lib/integrations/homebrew";

test("normalizeRegistryProvider resolves all Tier-1 ecosystems and aliases", () => {
  assert.equal(normalizeRegistryProvider("nuget"), "nuget");
  assert.equal(normalizeRegistryProvider("paket"), "nuget");
  assert.equal(normalizeRegistryProvider("rubygems"), "rubygems");
  assert.equal(normalizeRegistryProvider("bundler"), "rubygems");
  assert.equal(normalizeRegistryProvider("composer"), "packagist");
  assert.equal(normalizeRegistryProvider("flutter"), "pubdev");
  assert.equal(normalizeRegistryProvider("deno"), "jsr");
  assert.equal(normalizeRegistryProvider("elixir"), "hex");
  assert.equal(normalizeRegistryProvider("conda-forge"), "anaconda");
  assert.equal(normalizeRegistryProvider("R"), "cran");
  assert.equal(normalizeRegistryProvider("brew"), "homebrew");
  assert.equal(REGISTRY_ADAPTERS.nuget.depsDevSystem, "NUGET");
  assert.equal(REGISTRY_ADAPTERS.rubygems.depsDevSystem, "RUBYGEMS");
});

test("parseConnectorInput detects Tier-1 registry URLs cleanly", () => {
  const nuget = parseConnectorInput("https://www.nuget.org/packages/Newtonsoft.Json");
  assert.equal(nuget.kind, "nuget");
  assert.equal(nuget.value, "Newtonsoft.Json");

  const gem = parseConnectorInput("https://rubygems.org/gems/sidekiq");
  assert.equal(gem.kind, "rubygems");
  assert.equal(gem.value, "sidekiq");

  const composer = parseConnectorInput("https://packagist.org/packages/laravel/framework");
  assert.equal(composer.kind, "packagist");
  assert.equal(composer.value, "laravel/framework");

  const pub = parseConnectorInput("https://pub.dev/packages/riverpod");
  assert.equal(pub.kind, "pubdev");
  assert.equal(pub.value, "riverpod");

  const jsr = parseConnectorInput("https://jsr.io/@hono/hono");
  assert.equal(jsr.kind, "jsr");
  assert.equal(jsr.value, "@hono/hono");

  const hex = parseConnectorInput("https://hex.pm/packages/phoenix");
  assert.equal(hex.kind, "hex");
  assert.equal(hex.value, "phoenix");

  const conda = parseConnectorInput("https://anaconda.org/conda-forge/polars");
  assert.equal(conda.kind, "anaconda");
  assert.equal(conda.value, "conda-forge/polars");

  const cran = parseConnectorInput("https://cran.r-project.org/package=ggplot2");
  assert.equal(cran.kind, "cran");
  assert.equal(cran.value, "ggplot2");

  const brew = parseConnectorInput("https://formulae.brew.sh/formula/ripgrep");
  assert.equal(brew.kind, "homebrew");
  assert.equal(brew.value, "ripgrep");
});

test("Tier-1 registry clients parse public API payloads and fail gracefully", async () => {
  const originalFetch = globalThis.fetch;

  const mockJson = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("azuresearch-usnc.nuget.org")) {
      return mockJson({
        data: [{ id: "Serilog", version: "4.2.0", totalDownloads: 950000000, verified: true, owners: ["serilog"], versions: [1, 2] }],
      });
    }
    if (url.includes("rubygems.org/api/v1/gems/puma.json")) {
      return mockJson({ name: "puma", version: "6.5.0", downloads: 420000000, version_downloads: 1200000, licenses: ["BSD-3-Clause"] });
    }
    if (url.includes("reverse_dependencies.json")) {
      return mockJson(["rails", "sinatra"]);
    }
    if (url.includes("packagist.org/packages/laravel/framework.json")) {
      return mockJson({ package: { name: "laravel/framework", downloads: { total: 350000000, monthly: 8000000, daily: 260000 }, dependents: 45000, favers: 32000, versions: { "v11.1.0": {} } } });
    }
    if (url.includes("pub.dev/api/packages/dio/score")) {
      return mockJson({ grantedPoints: 160, maxPoints: 160, likeCount: 6400, popularityScore: 0.99, downloadCount30Days: 2100000, tags: ["sdk:flutter"] });
    }
    if (url.includes("pub.dev/api/packages/dio")) {
      return mockJson({ name: "dio", latest: { version: "5.7.0", pubspec: { description: "HTTP client" } } });
    }
    if (url.includes("api.jsr.io/scopes/std/packages/path")) {
      return mockJson({ scope: "std", name: "path", latestVersion: "1.0.8", score: 100, versionCount: 15, dependencyCount: 0, runtimeCompat: { deno: true, node: true } });
    }
    if (url.includes("hex.pm/api/packages/phoenix")) {
      return mockJson({ name: "phoenix", latest_stable_version: "1.7.14", downloads: { all: 32000000, recent: 900000, week: 220000, day: 31000 }, releases: [{ version: "1.7.14" }], meta: { licenses: ["MIT"] } });
    }
    if (url.includes("api.anaconda.org/package/conda-forge/numpy")) {
      return mockJson({ name: "numpy", latest_version: "2.1.3", files: [{ ndownloads: 500000, attrs: { subdir: "linux-64" } }, { ndownloads: 250000, attrs: { subdir: "osx-arm64" } }] });
    }
    if (url.includes("crandb.r-pkg.org/ggplot2")) {
      return mockJson({ Package: "ggplot2", Version: "3.5.1", Title: "Grammar of Graphics" });
    }
    if (url.includes("cranlogs.r-pkg.org/downloads/daily/last-month/ggplot2")) {
      return mockJson([{ downloads: [{ day: "2026-11-25", downloads: 80000 }, { day: "2026-11-26", downloads: 85000 }] }]);
    }
    if (url.includes("formulae.brew.sh/api/formula/ripgrep.json")) {
      return mockJson({ name: "ripgrep", versions: { stable: "14.1.1" }, analytics: { install: { "30d": { ripgrep: 120000 }, "90d": { ripgrep: 340000 }, "365d": { ripgrep: 1400000 } } } });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const [nuget, gem, pkg, pub, jsr, hex, conda, cran, brew] = await Promise.all([
      fetchNuGetStats("Serilog"),
      fetchRubyGemStats("puma"),
      fetchPackagistStats("laravel/framework"),
      fetchPubDevStats("dio"),
      fetchJsrStats("@std/path"),
      fetchHexStats("phoenix"),
      fetchAnacondaStats("numpy"),
      fetchCranStats("ggplot2"),
      fetchHomebrewStats("ripgrep"),
    ]);

    assert.equal(nuget?.verified, true);
    assert.equal(nuget?.totalDownloads, 950000000);
    assert.equal(gem?.reverseDependencies, 2);
    assert.equal(pkg?.monthlyDownloads, 8000000);
    assert.equal(pub?.downloadCount30Days, 2100000);
    assert.equal(jsr?.score, 100);
    assert.equal(hex?.allDownloads, 32000000);
    assert.equal(conda?.totalDownloads, 750000);
    assert.equal(cran?.downloadsLastMonth, 165000);
    assert.equal(cran?.dailyHistory.length, 2);
    assert.equal(brew?.installs30d, 120000);
    assert.equal(await fetchHomebrewStats("missing-formula-404"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
