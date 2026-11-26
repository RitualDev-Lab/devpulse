import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectorInput } from "../src/lib/integrations/url-parser";
import { fetchMavenStats } from "../src/lib/integrations/maven";
import { fetchCppPackageStats } from "../src/lib/integrations/cpp";
import { fetchSwiftStats } from "../src/lib/integrations/swift";
import { fetchHackageStats } from "../src/lib/integrations/hackage";
import { fetchMetaCpanStats } from "../src/lib/integrations/metacpan";
import { fetchLuaRocksStats } from "../src/lib/integrations/luarocks";
import { fetchJuliaStats } from "../src/lib/integrations/julia";
import { scanRepositoryManifests } from "../src/lib/scanner/manifest-scanner";

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const textRes = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain" } });

test("parseConnectorInput parses Tier-2 registry URLs cleanly", () => {
  assert.equal(parseConnectorInput("https://central.sonatype.com/artifact/com.google.guava/guava").value, "com.google.guava:guava");
  assert.equal(parseConnectorInput("https://conan.io/center/recipes/fmt").value, "conan:fmt");
  assert.equal(parseConnectorInput("https://vcpkg.io/en/package/zlib").value, "vcpkg:zlib");
  assert.equal(parseConnectorInput("https://swiftpackageindex.com/Alamofire/Alamofire").value, "Alamofire/Alamofire");
  assert.equal(parseConnectorInput("https://cocoapods.org/pods/SDWebImage").value, "SDWebImage");
  assert.equal(parseConnectorInput("https://hackage.haskell.org/package/aeson").value, "aeson");
  assert.equal(parseConnectorInput("https://metacpan.org/dist/Mojolicious").value, "Mojolicious");
  assert.equal(parseConnectorInput("https://luarocks.org/modules/luarocks/luasocket").value, "luarocks/luasocket");
  assert.equal(parseConnectorInput("https://juliahub.com/ui/Packages/General/DataFrames").value, "DataFrames");
});

test("Tier-2 registry clients extract metadata, versions, and platforms", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("search.maven.org")) {
      return jsonRes({ response: { docs: [{ g: "com.google.guava", a: "guava", latestVersion: "33.3.1-jre", versionCount: 120, p: "jar" }] } });
    }
    if (url.includes("conan-center-index")) {
      return textRes("versions:\n  \"11.0.2\":\n    folder: all\n  \"10.2.1\":\n    folder: all\n");
    }
    if (url.includes("swiftpackageindex.com") && url.includes("swift-versions")) {
      return jsonRes({ message: "6.0 | 5.10" });
    }
    if (url.includes("swiftpackageindex.com") && url.includes("platforms")) {
      return jsonRes({ message: "iOS | macOS | Linux" });
    }
    if (url.includes("hackage.haskell.org/package/aeson/preferred")) {
      return jsonRes({ "normal-version": ["2.2.3.0", "2.2.2.0"] });
    }
    if (url.includes("hackage.haskell.org/package/aeson")) {
      return textRes("<table><tr><th>Downloads</th><td>18,450 recent</td></tr></table>");
    }
    if (url.includes("fastapi.metacpan.org/v1/release/Mojolicious")) {
      return jsonRes({ distribution: "Mojolicious", version: "9.38", abstract: "Web framework", license: ["artistic_2"] });
    }
    if (url.includes("fastapi.metacpan.org/v1/favorite")) {
      return jsonRes({ hits: { total: { value: 142 } } });
    }
    if (url.includes("luarocks.org/modules")) {
      return textRes('<span class="version">3.1.0-1</span><div>920,100 downloads</div>');
    }
    if (url.includes("JuliaRegistries/General/master/D/DataFrames/Package.toml")) {
      return textRes('name = "DataFrames"\nuuid = "a93c6f00-e57d-5684-b7b6-d8193f3e46c0"');
    }
    if (url.includes("JuliaRegistries/General/master/D/DataFrames/Versions.toml")) {
      return textRes('["1.6.1"]\n["1.7.0"]');
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const [maven, cpp, swift, hackage, cpan, lua, julia] = await Promise.all([
    fetchMavenStats("com.google.guava:guava"),
    fetchCppPackageStats("conan:fmt"),
    fetchSwiftStats("Alamofire/Alamofire"),
    fetchHackageStats("aeson"),
    fetchMetaCpanStats("Mojolicious"),
    fetchLuaRocksStats("luasocket"),
    fetchJuliaStats("DataFrames"),
  ]);

  assert.equal(maven?.latestVersion, "33.3.1-jre");
  assert.equal(cpp?.versionCount, 2);
  assert.deepEqual(swift?.platforms, ["iOS", "macOS", "Linux"]);
  assert.equal(hackage?.recentDownloads, 18450);
  assert.equal(cpan?.favorites, 142);
  assert.equal(lua?.downloads, 920100);
  assert.equal(julia?.latestVersion, "1.7.0");
});

test("scanRepositoryManifests links verified manifests and strictly skips private/unpublished apps", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const enc = (str: string) => Buffer.from(str, "utf8").toString("base64");

  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/Polyglot/suite") {
      return jsonRes({ name: "suite", stargazers_count: 10, forks_count: 2, default_branch: "main" });
    }
    if (url === "https://api.github.com/repos/Polyglot/suite/contents") {
      return jsonRes([
        { name: "composer.json", type: "file" },
        { name: "pubspec.yaml", type: "file" },
        { name: "pom.xml", type: "file" },
        { name: "MyApp.csproj", type: "file" },
        { name: "DESCRIPTION", type: "file" },
      ]);
    }
    if (url.endsWith("/contents/composer.json")) {
      // Private/project Laravel web app -> MUST be skipped
      return jsonRes({ encoding: "base64", content: enc(JSON.stringify({ name: "laravel/laravel", type: "project" })) });
    }
    if (url.endsWith("/contents/pubspec.yaml")) {
      // Flutter private app with publish_to: none -> MUST be skipped
      return jsonRes({ encoding: "base64", content: enc("name: my_private_app\npublish_to: none\n") });
    }
    if (url.endsWith("/contents/MyApp.csproj")) {
      // Non-packable ASP.NET app -> MUST be skipped
      return jsonRes({ encoding: "base64", content: enc("<Project><PropertyGroup><IsPackable>false</IsPackable></PropertyGroup></Project>") });
    }
    if (url.endsWith("/contents/pom.xml")) {
      return jsonRes({ encoding: "base64", content: enc("<project><groupId>com.acme</groupId><artifactId>sdk</artifactId></project>") });
    }
    if (url.endsWith("/contents/DESCRIPTION")) {
      return jsonRes({ encoding: "base64", content: enc("Package: tidydata\nVersion: 1.0.0\n") });
    }
    if (url.includes("search.maven.org")) {
      return jsonRes({ response: { docs: [{ g: "com.acme", a: "sdk", latestVersion: "1.2.0", versionCount: 5, p: "jar" }] } });
    }
    if (url === "https://crandb.r-pkg.org/tidydata") {
      return jsonRes({ Package: "tidydata", Version: "1.0.0" });
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const res = await scanRepositoryManifests("Polyglot/suite");
  const providers = (res.detectedConnectors || []).map((c) => c.provider).sort();
  assert.deepEqual(providers, ["cran", "maven"]);
});
