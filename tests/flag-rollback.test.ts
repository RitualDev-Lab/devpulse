import test from "node:test";
import assert from "node:assert/strict";
import { assessCrashRollback, summarizeFlagCrashSamples } from "../src/lib/flags/rollback-statistics";
import { buildFlagUserHash } from "../src/lib/flags/user-hash";

test("flag crash samples count distinct matched users once per assigned variant", () => {
  const exposures = [
    { userHash: "a", variant: "control" },
    { userHash: "a", variant: "control" },
    { userHash: "b", variant: "control" },
    { userHash: "c", variant: "treatment" },
    { userHash: "c", variant: "treatment" },
    { userHash: "d", variant: "treatment" },
    { userHash: null, variant: "treatment" },
  ];
  const crashes = [
    { userHash: "a", variant: "control" },
    { userHash: "a", variant: "control" },
    { userHash: "c", variant: "treatment" },
    { userHash: "c", variant: "treatment" },
    { userHash: "not-exposed", variant: "treatment" },
    { userHash: null, variant: "treatment" },
  ];

  assert.deepEqual(summarizeFlagCrashSamples(exposures, crashes, "treatment"), {
    control: { exposedUsers: 2, crashedUsers: 1 },
    treatment: { exposedUsers: 2, crashedUsers: 1 },
  });
  assert.deepEqual(summarizeFlagCrashSamples(
    [...exposures, { userHash: "e", variant: "alternative" }],
    [...crashes, { userHash: "e", variant: "alternative" }],
    "treatment",
  ), {
    control: { exposedUsers: 2, crashedUsers: 1 },
    treatment: { exposedUsers: 2, crashedUsers: 1 },
  });
});

test("flag rollback requires adequate samples and a significant treatment risk increase", () => {
  const insufficient = assessCrashRollback({
    control: { exposedUsers: 49, crashedUsers: 0 },
    treatment: { exposedUsers: 50, crashedUsers: 10 },
    thresholdPercent: 5,
  });
  assert.equal(insufficient.shouldRollback, false);
  assert.match(insufficient.reason, /insufficient distinct users/);

  const noSignal = assessCrashRollback({
    control: { exposedUsers: 100, crashedUsers: 5 },
    treatment: { exposedUsers: 100, crashedUsers: 10 },
    thresholdPercent: 5,
  });
  assert.equal(noSignal.shouldRollback, false);

  const rollback = assessCrashRollback({
    control: { exposedUsers: 500, crashedUsers: 1 },
    treatment: { exposedUsers: 500, crashedUsers: 60 },
    thresholdPercent: 5,
  });
  assert.equal(rollback.shouldRollback, true);
  assert.ok((rollback.riskDifferenceLowerBoundPercent ?? 0) > 0);
});

test("flag rollback fails closed for invalid samples and thresholds", () => {
  assert.equal(assessCrashRollback({
    control: { exposedUsers: 100, crashedUsers: 101 },
    treatment: { exposedUsers: 100, crashedUsers: 10 },
    thresholdPercent: 5,
  }).shouldRollback, false);
  assert.equal(assessCrashRollback({
    control: { exposedUsers: 100, crashedUsers: 1 },
    treatment: { exposedUsers: 100, crashedUsers: 20 },
    thresholdPercent: Number.NaN,
  }).shouldRollback, false);
});

test("flag user hashes are stable, scoped, and absent for anonymous users", async () => {
  const base = { secret: "test-secret", projectId: "project-a", flagKey: "checkout", userId: "user-1" };
  const hash = await buildFlagUserHash(base);
  assert.ok(hash);
  assert.equal(hash, await buildFlagUserHash(base));
  assert.notEqual(hash, await buildFlagUserHash({ ...base, projectId: "project-b" }));
  assert.notEqual(hash, await buildFlagUserHash({ ...base, flagKey: "other-flag" }));
  assert.equal(await buildFlagUserHash({ ...base, userId: "anonymous" }), null);
  assert.equal(await buildFlagUserHash({ ...base, secret: "" }), null);
});
