import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("HomePage uses loadPublicShowcasePreview and contains zero fake Live Edge or ritualdev-lab/core claims", () => {
  const homeSrc = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
  assert.equal(homeSrc.includes("Live Cloudflare Edge Synced"), false);
  assert.equal(homeSrc.includes("ritualdev-lab/core"), false);
  assert.equal(homeSrc.includes("1,420"), false);
  assert.equal(homeSrc.includes("$2,840"), false);
  assert.equal(homeSrc.includes("loadPublicShowcasePreview"), true);
});
