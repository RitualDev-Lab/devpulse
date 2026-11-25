import assert from "node:assert/strict";
import { db } from "../src/db";
import { featureRequests, featureVotes, statusSubscribers } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { getEffectiveEntitlements } from "../src/lib/billing/plans";
import { fetchGa4Report } from "../src/lib/integrations/ga4";
import { scrubTelemetryText } from "../src/lib/security/ingest-scrub";
import { verifyAuditChain } from "../src/lib/security/audit";
import { symbolicateStackTrace } from "../src/lib/telemetry/symbolicator";

async function main() {
  const freeEntitlements = getEffectiveEntitlements({ storageTier: "free" });
  const proEntitlements = getEffectiveEntitlements({ storageTier: "pro" });
  assert.equal(freeEntitlements.maxProjects, 5);
  assert.equal(proEntitlements.maxProjects, 25);

  const scrubbed = scrubTelemetryText(
    "Bearer my_secret_token_99 AKIA1234567890ABCDEF dev@ritualdev.in ?token=abc123"
  );
  assert.ok(!scrubbed.includes("my_secret_token_99"));
  assert.ok(!scrubbed.includes("AKIA1234567890ABCDEF"));
  assert.ok(!scrubbed.includes("dev@ritualdev.in"));
  assert.ok(!scrubbed.includes("abc123"));

  const validEmpty = await verifyAuditChain([]);
  assert.equal(validEmpty.valid, true);

  const debugSym = symbolicateStackTrace(
    "Error: boom\n  at fn (https://cdn.example.com/chunk-999.js:1:1)\n//# debugId=11111111-2222-3333-4444-555555555555",
    [
      {
        filePath: "arbitrary/name.map",
        content: JSON.stringify({
          version: 3,
          debugId: "11111111-2222-3333-4444-555555555555",
          sources: ["src/checkout.ts"],
          names: ["submitOrder"],
          mappings: "AAAA",
        }),
      },
    ]
  );
  assert.equal(debugSym.symbolicatedCount, 1);
  assert.equal(debugSym.frames[1].originalFile, "src/checkout.ts");

  await assert.rejects(
    () => fetchGa4Report({ propertyId: "invalid-id", credential: "tok" }),
    /Property ID must be numeric/
  );

  const projectId = "prj_ritual_core";
  const subId = `ssub_test_${Date.now()}`;
  const unsubToken = `tok_${Date.now()}`;

  // 1. Verify status_subscribers roundtrip & unsubscribe toggle
  await db.insert(statusSubscribers).values({
    id: subId,
    projectId,
    email: "verify-status@ritualdev.in",
    isActive: true,
    unsubscribeToken: unsubToken,
  });

  const [subRow] = await db
    .select()
    .from(statusSubscribers)
    .where(eq(statusSubscribers.id, subId))
    .limit(1);
  assert.equal(subRow.email, "verify-status@ritualdev.in");
  assert.equal(subRow.isActive, true);

  await db
    .update(statusSubscribers)
    .set({ isActive: false })
    .where(eq(statusSubscribers.unsubscribeToken, unsubToken));

  const [unsubRow] = await db
    .select()
    .from(statusSubscribers)
    .where(eq(statusSubscribers.id, subId))
    .limit(1);
  assert.equal(unsubRow.isActive, false);

  await db.delete(statusSubscribers).where(eq(statusSubscribers.id, subId));

  // 2. Verify feature_requests & feature_votes roundtrip
  const featId = `feat_test_${Date.now()}`;
  const voteId = `fv_test_${Date.now()}`;

  await db.insert(featureRequests).values({
    id: featId,
    projectId,
    title: "Add Rust devpulse-rs panic hook crate",
    description: "Native std::panic capture with zero-dependency PII scrubbing.",
    category: "sdk",
    status: "planned",
    targetVersion: "v1.4.0",
    voteCount: 1,
    authorName: "@ritualdev",
  });

  await db.insert(featureVotes).values({
    id: voteId,
    featureId: featId,
    voterHash: "verify_hash_123",
  });

  const [featRow] = await db
    .select()
    .from(featureRequests)
    .where(eq(featureRequests.id, featId))
    .limit(1);
  assert.equal(featRow.targetVersion, "v1.4.0");
  assert.equal(featRow.voteCount, 1);

  await db.delete(featureRequests).where(eq(featureRequests.id, featId));

  console.log("Sprint 4 DB roundtrip verification PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("Sprint 4 verification failed:", err);
  process.exit(1);
});
