import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sanitizeCustomCss, scopeCustomCss } from "../src/lib/styling/themes";
import {
  parseIncomingHost,
  isValidSubdomainSlug,
  isValidCustomHostname,
} from "../src/lib/domains/host-routing";
import { verifyDodoWebhookSignature } from "../src/lib/billing/dodo";
import { getPlanLimits, formatBytes } from "../src/lib/billing/plans";
import { escapeGoModulePath } from "../src/lib/integrations/go";
import { signS3Request } from "../src/lib/storage/r2";

test("sanitizeCustomCss strips dangerous tags and imports", () => {
  const dirty = `@import url("https://evil.com"); </style><script>alert(1)</script>.card { color: red; background: expression(alert(1)); }`;
  const clean = sanitizeCustomCss(dirty);
  assert.equal(clean.includes("</style>"), false);
  assert.equal(clean.includes("<script>"), false);
  assert.equal(clean.includes("@import"), false);
  assert.equal(clean.includes("expression("), false);
  assert.ok(clean.includes("color: red"));
});

test("scopeCustomCss prefixes selectors under .devpulse-dashboard", () => {
  const scoped = scopeCustomCss(".dashboard-card > div { border-radius: 20px; } body { color: #fff; }");
  assert.ok(scoped.includes(".devpulse-dashboard .dashboard-card > div"));
  assert.ok(scoped.includes(".devpulse-dashboard {"));
});

test("parseIncomingHost handles primary, wildcard subdomain, and custom domains", () => {
  assert.deepEqual(parseIncomingHost("devpulse.ritualdev.in"), { kind: "primary" });
  assert.deepEqual(parseIncomingHost("localhost:3000"), { kind: "primary" });
  assert.deepEqual(parseIncomingHost("preview-123.devpulse.pages.dev"), { kind: "primary" });
  assert.deepEqual(parseIncomingHost("alex.devpulse.ritualdev.in"), {
    kind: "subdomain",
    subdomain: "alex",
  });
  assert.deepEqual(parseIncomingHost("cname.devpulse.ritualdev.in"), { kind: "primary" });
  assert.deepEqual(parseIncomingHost("stats.mytool.dev:443"), {
    kind: "custom",
    hostname: "stats.mytool.dev",
  });
});

test("subdomain and custom hostname validation rejects reserved or invalid values", () => {
  assert.equal(isValidSubdomainSlug("ritual-core"), true);
  assert.equal(isValidSubdomainSlug("www"), false);
  assert.equal(isValidSubdomainSlug("ab"), false);
  assert.equal(isValidCustomHostname("stats.mytool.dev"), true);
  assert.equal(isValidCustomHostname("bad.devpulse.ritualdev.in"), false);
  assert.equal(isValidCustomHostname("localhost"), false);
});

test("verifyDodoWebhookSignature validates HMAC-SHA256 Standard Webhooks payloads", async () => {
  const rawSecretBytes = Buffer.from("super-secret-signing-key-32bytes!");
  const secret = `whsec_${rawSecretBytes.toString("base64")}`;
  const webhookId = "msg_test_123";
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type: "subscription.active", data: { metadata: { user_id: "u1", sku: "pro" } } });

  const hmac = crypto
    .createHmac("sha256", rawSecretBytes)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest("base64");

  const valid = await verifyDodoWebhookSignature({
    rawBody,
    webhookId,
    webhookTimestamp,
    webhookSignature: `v1,${hmac}`,
    secret,
  });
  assert.equal(valid, true);

  const tampered = await verifyDodoWebhookSignature({
    rawBody: rawBody + " ",
    webhookId,
    webhookTimestamp,
    webhookSignature: `v1,${hmac}`,
    secret,
  });
  assert.equal(tampered, false);
});

test("getPlanLimits computes quotas and extra custom domain add-on slots", () => {
  const free = getPlanLimits("free");
  assert.equal(free.maxProjects, 1);
  assert.equal(free.maxCustomDomains, 0);
  assert.equal(free.storageLimitBytes, 100 * 1024 * 1024);
  assert.equal(free.whiteLabel, false);

  const proWithAddon = getPlanLimits("pro", 2);
  assert.equal(proWithAddon.maxProjects, 5);
  assert.equal(proWithAddon.maxCustomDomains, 3);
  assert.equal(proWithAddon.storageLimitBytes, 5 * 1024 * 1024 * 1024);
  assert.equal(proWithAddon.whiteLabel, true);
  assert.equal(formatBytes(proWithAddon.storageLimitBytes), "5.0 GB");
});

test("escapeGoModulePath encodes uppercase characters per proxy.golang.org spec", () => {
  assert.equal(escapeGoModulePath("github.com/Azure/azure-sdk"), "github.com/!azure/azure-sdk");
});

test("signS3Request produces valid AWS4-HMAC-SHA256 authorization headers", async () => {
  const headers = await signS3Request({
    method: "PUT",
    url: "https://acct.r2.cloudflarestorage.com/devpulse-storage/crashes/p1/e1/crash.log",
    region: "auto",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret-key-example",
    body: "Error: Boom",
    contentType: "text/plain",
  });
  assert.ok(headers.Authorization.startsWith("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/"));
  assert.ok(headers["x-amz-content-sha256"].length === 64);
  assert.ok(headers["x-amz-date"].endsWith("Z"));
});
