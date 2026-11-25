import test from "node:test";
import assert from "node:assert/strict";
import { escapeGoModulePath } from "../src/lib/integrations/go";
import { scopeCustomCss } from "../src/lib/layout/css-scoper";
import { rectsCollide, detectPresetKey } from "../src/lib/layout/grid-engine";
import {
  normalizeAndValidateSubdomain,
  isPaidDomainTier,
} from "../src/lib/domains/cloudflare-saas";
import { resolveItemKeyFromProductId } from "../src/lib/billing/dodo";
import { seedDemoData } from "../src/db/seed";

test("escapeGoModulePath escapes uppercase ASCII letters per Go proxy protocol", () => {
  assert.equal(escapeGoModulePath("github.com/Azure/azure-sdk"), "github.com/!azure/azure-sdk");
  assert.equal(escapeGoModulePath("golang.org/x/net"), "golang.org/x/net");
});

test("scopeCustomCss prefixes selectors under .devpulse-workspace and strips style/script tags", () => {
  const dirty = `</style><script>alert(1)</script>@import url("x"); .dashboard-card { color: cyan; } body { color: white; }`;
  const scoped = scopeCustomCss(dirty);
  assert.equal(scoped.includes("</style"), false);
  assert.equal(scoped.includes("<script"), false);
  assert.equal(scoped.includes("@import"), false);
  assert.ok(scoped.includes(".devpulse-workspace .dashboard-card"));
  assert.ok(scoped.includes(".devpulse-workspace { color: white; }"));
});

test("grid-engine collision detection and preset detection work as expected", () => {
  assert.equal(
    rectsCollide({ x: 0, y: 0, w: 6, h: 1 }, { x: 4, y: 0, w: 6, h: 1 }),
    true
  );
  assert.equal(
    rectsCollide({ x: 0, y: 0, w: 4, h: 1 }, { x: 4, y: 0, w: 4, h: 1 }),
    false
  );
  assert.equal(detectPresetKey(12, 2), "4x2");
  assert.equal(detectPresetKey(6, 2), "2x2");
});

test("cloudflare-saas subdomain validation & tier checks", () => {
  assert.deepEqual(normalizeAndValidateSubdomain("RitualCore.devpulse.ritualdev.in").valid, true);
  assert.equal(normalizeAndValidateSubdomain("www").valid, false);
  assert.equal(normalizeAndValidateSubdomain("ab").valid, false);
  assert.equal(isPaidDomainTier("free"), false);
  assert.equal(isPaidDomainTier("pro"), true);
  assert.equal(isPaidDomainTier("team"), true);
});

test("dodo resolveItemKeyFromProductId resolves known DevPulse SKUs", () => {
  assert.equal(resolveItemKeyFromProductId("pdt_0Nsfgf8Ryeyj6XQbwikSQ"), "pro");
  assert.equal(resolveItemKeyFromProductId("pdt_0NsfgfAkiZAe0UAolxkWo"), "team");
  assert.equal(resolveItemKeyFromProductId("pdt_0NsfgfCpABtcsEgbRVYSN"), "extra_domain");
  assert.equal(resolveItemKeyFromProductId("pdt_unknown"), null);
});

test("seedDemoData rejects execution when NODE_ENV is not development", async () => {
  const envRecord = process.env as Record<string, string | undefined>;
  const prevNodeEnv = envRecord.NODE_ENV;
  const prevAllow = envRecord.ALLOW_DEV_SEED;
  envRecord.NODE_ENV = "production";
  delete envRecord.ALLOW_DEV_SEED;
  try {
    await assert.rejects(seedDemoData(), /restricted to development/);
  } finally {
    envRecord.NODE_ENV = prevNodeEnv;
    if (prevAllow !== undefined) envRecord.ALLOW_DEV_SEED = prevAllow;
  }
});
