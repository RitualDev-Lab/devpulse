import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyGitHubSignature } from "../src/lib/security/github-webhook";

const secret = "gh-test-secret";
const body = JSON.stringify({ action: "published", repository: { full_name: "acme/app" } });
const goodSig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("accepts a matching signature", async () => {
  assert.equal(await verifyGitHubSignature(body, goodSig, secret), true);
});

test("rejects a missing signature header", async () => {
  assert.equal(await verifyGitHubSignature(body, null, secret), false);
});

test("rejects a signature without the sha256= prefix", async () => {
  const bare = goodSig.slice("sha256=".length);
  assert.equal(await verifyGitHubSignature(body, bare, secret), false);
});

test("rejects a signature made with a different secret", async () => {
  const wrong = `sha256=${createHmac("sha256", "other").update(body).digest("hex")}`;
  assert.equal(await verifyGitHubSignature(body, wrong, secret), false);
});

test("rejects a body altered after signing", async () => {
  assert.equal(await verifyGitHubSignature(body.replace("acme", "evil"), goodSig, secret), false);
});

test("fails closed when no secret is configured", async () => {
  assert.equal(await verifyGitHubSignature(body, goodSig, ""), false);
});
