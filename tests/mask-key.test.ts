import test from "node:test";
import assert from "node:assert/strict";
import { maskApiKey, displaySnippetKey } from "../src/lib/security/mask-key";

test("maskApiKey hides the secret middle while preserving prefix and last 4 characters", () => {
  const masked = maskApiKey("dp_live_5202c43929c2bc29ea271c57");
  assert.equal(masked, "dp_live_••••••••1c57");
  assert.ok(!masked.includes("5202c43929c2bc29ea27"));

  assert.equal(maskApiKey(null), "dp_live_your_api_key");
  assert.equal(maskApiKey("revoked_123456"), "revoked_key");
});

test("displaySnippetKey returns masked by default and full key only when revealed", () => {
  const raw = "dp_live_5202c43929c2bc29ea271c57";
  assert.equal(displaySnippetKey(raw, false), "dp_live_••••••••1c57");
  assert.equal(displaySnippetKey(raw, true), raw);
});
