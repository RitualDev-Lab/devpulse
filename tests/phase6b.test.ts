import test from "node:test";
import assert from "node:assert/strict";
import {
  getEffectiveEntitlements,
  canUseAlertChannel,
  PLANS,
  ADDONS,
} from "../src/lib/billing/plans";
import {
  buildHostedDodoCheckoutUrl,
  createDodoCheckoutSession,
} from "../src/lib/billing/dodo";

// Test-only Dodo product fixtures. Production IDs are never committed; they come from DODO_PRODUCT_* env.
process.env.DODO_PRODUCT_PRO = "pdt_test_pro";
process.env.DODO_PRODUCT_TEAM = "pdt_test_team";
process.env.DODO_PRODUCT_EXTRA_DOMAIN = "pdt_test_extra_domain";

test("Stage 6B entitlements compute project, custom domain, R2 storage, and alert limits", () => {
  const free = getEffectiveEntitlements({ storageTier: "free" });
  assert.equal(free.maxProjects, 5); // Free plan limit (commit 5fa5e5b)
  assert.equal(free.maxCustomDomains, 0);
  assert.equal(free.allowCustomCss, false);
  assert.equal(free.allowWhiteLabel, false);
  assert.equal(canUseAlertChannel("free", "discord"), false);
  assert.equal(canUseAlertChannel("free", "generic"), true);

  const proWithAddons = getEffectiveEntitlements({
    storageTier: "pro",
    extraCustomDomains: 2,
    extraStorageGb: 25,
  });
  assert.equal(proWithAddons.maxProjects, 25); // Pro plan limit (commit 5fa5e5b)
  assert.equal(proWithAddons.maxCustomDomains, 3);
  assert.equal(proWithAddons.storageLimitBytes, 30 * 1024 * 1024 * 1024);
  assert.equal(proWithAddons.allowWhiteLabel, true);
  assert.equal(canUseAlertChannel("pro", "discord"), true);
  assert.equal(canUseAlertChannel("pro", "pagerduty"), false);

  const team = getEffectiveEntitlements({ storageTier: "team" });
  assert.equal(team.maxProjects, null);
  assert.equal(team.maxCustomDomains, 5);
  assert.equal(team.allowByos, true);
  assert.equal(canUseAlertChannel("team", "pagerduty"), true);
  assert.equal(PLANS.pro.priceMonthlyUsd, 14);
  assert.equal(PLANS.team.priceMonthlyUsd, 49);
  assert.equal(ADDONS.extra_domain.unitPriceUsd, 5);
});

test("buildHostedDodoCheckoutUrl attaches required metadata and redirect URL", () => {
  const url = new URL(
    buildHostedDodoCheckoutUrl({
      itemKey: "pro",
      quantity: 1,
      userId: "usr_test_123",
      userEmail: "dev@example.com",
      returnUrl: "https://app.example.com/dashboard?billing=success&item=pro",
    })
  );

  assert.equal(url.hostname, "checkout.dodopayments.com");
  assert.equal(url.pathname, "/buy/pdt_test_pro");
  assert.equal(url.searchParams.get("metadata_app"), "devpulse");
  assert.equal(url.searchParams.get("metadata_userId"), "usr_test_123");
  assert.equal(url.searchParams.get("metadata_itemKey"), "pro");
  assert.equal(url.searchParams.get("email"), "dev@example.com");
});

test("createDodoCheckoutSession gracefully falls back to hosted link when API key is unset", async () => {
  const prevKey = process.env.DODO_PAYMENTS_API_KEY;
  delete process.env.DODO_PAYMENTS_API_KEY;
  try {
    const res = await createDodoCheckoutSession({
      itemKey: "extra_domain",
      quantity: 1,
      userId: "usr_test_456",
      returnUrl: "https://app.example.com/dashboard?billing=success",
    });
    assert.ok(res.checkoutUrl.includes("pdt_test_extra_domain"));
    assert.ok(res.sessionId.startsWith("hosted_extra_domain_"));
  } finally {
    if (prevKey !== undefined) process.env.DODO_PAYMENTS_API_KEY = prevKey;
  }
});
