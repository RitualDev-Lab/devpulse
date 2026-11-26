import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getGoSnippet,
  getDotnetSnippet,
  getJvmSnippet,
  getPhpSnippet,
  getSwiftSnippet,
  getCppSnippet,
  getRubySnippet,
} from "../src/lib/sdk-generator";

test("all Phase 5 Batch A & Batch B SDK generators embed provided API key", () => {
  const key = "dp_live_phase5_key";
  assert.ok(getGoSnippet(key).includes(key));
  assert.ok(getDotnetSnippet(key).includes(key));
  assert.ok(getJvmSnippet(key).includes(key));
  assert.ok(getPhpSnippet(key).includes(key));
  assert.ok(getSwiftSnippet(key).includes(key));
  assert.ok(getCppSnippet(key).includes(key));
  assert.ok(getRubySnippet(key).includes(key));
});

test("all 7 new multi-language SDK package directories exist with valid entrypoints", () => {
  const root = path.resolve(process.cwd(), "packages");
  const expectedFiles = [
    "devpulse-go/go.mod",
    "devpulse-go/devpulse.go",
    "DevPulse.Sdk/DevPulse.Sdk.csproj",
    "DevPulse.Sdk/DevPulseClient.cs",
    "devpulse-jvm/pom.xml",
    "devpulse-jvm/src/main/java/in/ritualdev/devpulse/DevPulseClient.java",
    "devpulse-php/composer.json",
    "devpulse-php/src/Client.php",
    "DevPulseSwift/Package.swift",
    "DevPulseSwift/Sources/DevPulseSwift/DevPulseSwift.swift",
    "devpulse-cpp/vcpkg.json",
    "devpulse-cpp/include/devpulse.hpp",
    "devpulse-rb/devpulse-rb.gemspec",
    "devpulse-rb/lib/devpulse.rb",
  ];
  for (const rel of expectedFiles) {
    assert.ok(fs.existsSync(path.join(root, rel)), `Expected SDK file to exist: ${rel}`);
  }
});
