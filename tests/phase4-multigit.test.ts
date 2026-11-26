import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectorInput } from "../src/lib/integrations/url-parser";
import {
  defaultGitBaseUrl,
  fetchGitRepoStats,
  gitProviderLabel,
  normalizeGitProvider,
  resolveProjectGitConfig,
} from "../src/lib/integrations/git-provider";
import { scanGitProviderManifests } from "../src/lib/scanner/manifest-scanner";

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("URL parser & GitProviderAdapter normalize GitLab, Bitbucket, Codeberg/Gitea URLs", () => {
  const gl = parseConnectorInput("https://gitlab.com/my-org/subteam/api-service");
  assert.equal(gl.kind, "gitlab");
  assert.equal(gl.value, "my-org/subteam/api-service");

  const bb = parseConnectorInput("https://bitbucket.org/acme-ws/core-lib");
  assert.equal(bb.kind, "bitbucket");
  assert.equal(bb.value, "acme-ws/core-lib");

  const cb = parseConnectorInput("https://codeberg.org/forge/zig-cli");
  assert.equal(cb.kind, "gitea");
  assert.equal(cb.value, "forge/zig-cli");

  assert.equal(normalizeGitProvider("Codeberg"), "gitea");
  assert.equal(defaultGitBaseUrl("gitlab", "https://gitlab.corp.dev/"), "https://gitlab.corp.dev");
  assert.equal(gitProviderLabel("gitea", "https://codeberg.org"), "Codeberg");

  const resolved = resolveProjectGitConfig({
    githubRepo: "legacy/repo",
    connectors: [
      { category: "git", provider: "gitlab", identifier: "group/app", targetUrl: "https://gitlab.corp.dev" },
    ],
  });
  assert.equal(resolved?.provider, "gitlab");
  assert.equal(resolved?.baseUrl, "https://gitlab.corp.dev");
  assert.equal(resolved?.repoSlug, "group/app");
});

test("fetchGitRepoStats & scanGitProviderManifests support GitLab, Bitbucket, and Codeberg", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.endsWith("/api/v4/projects/group%2Ftool")) {
      return jsonRes({ id: 42, path_with_namespace: "group/tool", star_count: 180, forks_count: 19, open_issues_count: 5, default_branch: "main", web_url: "https://gitlab.example.com/group/tool" });
    }
    if (url.includes("/merge_requests")) return jsonRes([{ id: 1, iid: 9, title: "Add telemetry", state: "opened", created_at: "2026-11-20T00:00:00Z", author: { username: "dev" }, web_url: "https://gitlab.example.com/mr/9" }]);
    if (url.includes("/issues?")) return jsonRes([]);
    if (url.includes("/releases?per_page=1")) return jsonRes([{ tag_name: "v2.1.0", released_at: "2026-11-21T00:00:00Z" }]);
    if (url.includes("/pipelines?per_page=1")) return jsonRes([{ status: "success", ref: "main" }]);
    if (url.includes("/repository/tree")) return jsonRes([{ name: "Cargo.toml", type: "file" }]);
    if (url.includes("/repository/files/Cargo.toml/raw")) return new Response('[package]\nname = "serde"\n', { status: 200 });
    if (url === "https://crates.io/api/v1/crates/serde") return jsonRes({ crate: { name: "serde" } });

    if (url === "https://api.bitbucket.org/2.0/repositories/ws/api") {
      return jsonRes({ uuid: "{bb-1}", full_name: "ws/api", mainbranch: { name: "main" }, links: { html: { href: "https://bitbucket.org/ws/api" } } });
    }
    if (url.includes("api.bitbucket.org/2.0/repositories/ws/api/pullrequests")) {
      return jsonRes({ size: 3, values: [{ id: 3, title: "Fix cache", state: "OPEN", created_on: "2026-11-24T00:00:00Z", author: { nickname: "alice" }, links: { html: { href: "https://bitbucket.org/ws/api/pull-requests/3" } } }] });
    }
    if (url.includes("api.bitbucket.org/2.0/repositories/ws/api/pipelines")) {
      return jsonRes({ values: [{ state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } }, target: { ref_name: "main" } }] });
    }

    if (url === "https://codeberg.org/api/v1/repos/alice/zig-app") {
      return jsonRes({ id: 77, full_name: "alice/zig-app", stars_count: 55, forks_count: 4, open_issues_count: 2, open_pr_counter: 1, default_branch: "main", html_url: "https://codeberg.org/alice/zig-app" });
    }
    if (url.includes("codeberg.org/api/v1/repos/alice/zig-app/pulls")) return jsonRes([]);
    if (url.includes("codeberg.org/api/v1/repos/alice/zig-app/issues")) return jsonRes([]);

    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const glStats = await fetchGitRepoStats({ provider: "gitlab", baseUrl: "https://gitlab.example.com", repoSlug: "group/tool" });
  assert.equal(glStats?.provider, "gitlab");
  assert.equal(glStats?.stars, 180);
  assert.equal(glStats?.openPrCount, 1);
  assert.equal(glStats?.pipelineStatus?.status, "success");

  const scanned = await scanGitProviderManifests({ provider: "gitlab", baseUrl: "https://gitlab.example.com", repoSlug: "group/tool" });
  assert.equal(scanned.detectedEcosystems.rustCrate, "serde");

  const bbStats = await fetchGitRepoStats({ provider: "bitbucket", baseUrl: "https://bitbucket.org", repoSlug: "ws/api" });
  assert.equal(bbStats?.openPrCount, 3);
  assert.equal(bbStats?.pipelineStatus?.status, "successful");

  const cbStats = await fetchGitRepoStats({ provider: "gitea", baseUrl: "https://codeberg.org", repoSlug: "alice/zig-app" });
  assert.equal(cbStats?.stars, 55);
  assert.equal(cbStats?.openPrCount, 1);
});
