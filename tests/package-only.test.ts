import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectorInput, parseMultipleConnectorInputs } from "../src/lib/integrations/url-parser";
import { buildEcosystemWidgets } from "../src/lib/dashboard/ecosystem-widgets";

test("parses PyPI-only, npm-only, Crates-only, Docker-only, Go, VS Code/Open-VSX, and MCP URLs with zero Git repo", () => {
  const pypi = parseConnectorInput("https://pypi.org/project/fastapi/");
  assert.equal(pypi.kind, "pypi");
  assert.equal(pypi.field, "pypiPackage");
  assert.equal(pypi.value, "fastapi");

  const scopedNpm = parseConnectorInput("@ritualdev/devpulse");
  assert.equal(scopedNpm.kind, "npm");
  assert.equal(scopedNpm.field, "npmPackage");
  assert.equal(scopedNpm.value, "@ritualdev/devpulse");

  const crates = parseConnectorInput("https://crates.io/crates/serde");
  assert.equal(crates.kind, "crates");
  assert.equal(crates.field, "rustCrate");
  assert.equal(crates.value, "serde");

  const docker = parseConnectorInput("https://hub.docker.com/_/nginx");
  assert.equal(docker.kind, "docker");
  assert.equal(docker.field, "dockerImage");
  assert.equal(docker.value, "library/nginx");

  const openVsx = parseConnectorInput("https://open-vsx.org/extension/ritualdev/pulse-tools");
  assert.equal(openVsx.kind, "vscode");
  assert.equal(openVsx.field, "vscodeExtension");
  assert.equal(openVsx.value, "ritualdev.pulse-tools");

  const smithery = parseConnectorInput("https://smithery.ai/server/@ritualdev-lab/devpulse-mcp");
  assert.equal(smithery.kind, "mcp");
  assert.equal(smithery.field, "mcpServerName");
  assert.equal(smithery.value, "@ritualdev-lab/devpulse-mcp");

  const multi = parseMultipleConnectorInputs(
    "https://pypi.org/project/httpx/\nhttps://hub.docker.com/r/myorg/worker"
  );
  assert.equal(multi.length, 2);
  assert.equal(multi[0].field, "pypiPackage");
  assert.equal(multi[1].field, "dockerImage");
});

test("buildEcosystemWidgets omits GitHub and unrelated preset package cards for single-ecosystem workspaces", () => {
  const pypiWidgets = buildEcosystemWidgets({ pypiPackage: "fastapi" }, "package");
  const pypiIds = pypiWidgets.map((w) => w.id);
  assert.ok(pypiIds.includes("pypi_downloads"));
  assert.ok(pypiIds.includes("telemetry_setup"));
  assert.ok(pypiIds.includes("bug_report_badge"));
  assert.ok(!pypiIds.includes("github_stats"));
  assert.ok(!pypiIds.includes("npm_downloads"));

  const goWidgets = buildEcosystemWidgets({ goModule: "github.com/gin-gonic/gin" }, "package");
  assert.ok(goWidgets.some((w) => w.id === "go_module"));
  assert.ok(!goWidgets.some((w) => w.id === "github_stats"));

  const dockerWidgets = buildEcosystemWidgets({ dockerImage: "myorg/api-server" }, "desktop");
  assert.ok(dockerWidgets.some((w) => w.id === "docker_container"));
  assert.ok(!dockerWidgets.some((w) => w.id === "rust_crates"));
  assert.ok(!dockerWidgets.some((w) => w.id === "github_stats"));
});
