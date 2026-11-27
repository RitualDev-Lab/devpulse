import test from "node:test";
import assert from "node:assert/strict";
import {
  getMaxEventBytes,
  toSafeIsoTimestamp,
  validateEventIngestPayload,
} from "../src/lib/validation/event-ingest";

test("toSafeIsoTimestamp rejects NaN, Infinity, and out-of-range epochs without throwing RangeError", () => {
  const fixedNow = Date.UTC(2026, 10, 27, 15, 0, 0);
  assert.equal(toSafeIsoTimestamp(Number.NaN, fixedNow).ok, false);
  assert.equal(toSafeIsoTimestamp(Number.POSITIVE_INFINITY, fixedNow).ok, false);
  assert.equal(toSafeIsoTimestamp(-9e18, fixedNow).ok, false);
  assert.equal(toSafeIsoTimestamp(1e20, fixedNow).ok, false);
  assert.equal(toSafeIsoTimestamp("not-a-valid-date", fixedNow).ok, false);

  const valid = toSafeIsoTimestamp(fixedNow - 60_000, fixedNow);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.iso, new Date(fixedNow - 60_000).toISOString());
  }
});

test("validateEventIngestPayload rejects malformed replay timestamps and bounds huge fields cleanly", () => {
  const fixedNow = Date.UTC(2026, 10, 27, 15, 0, 0);
  const bad = validateEventIngestPayload(
    {
      errorName: "TypeError",
      replayTimeline: [{ t: 9e18, kind: "click", label: "Submit" }],
    },
    fixedNow
  );
  assert.equal(bad.ok, false);

  const good = validateEventIngestPayload(
    {
      stackTrace: "x".repeat(100_000),
      replayTimeline: [{ t: fixedNow - 1000, kind: "click", label: "Retry", offsetMs: 120 }],
      affectedUsersCount: 5,
    },
    fixedNow
  );
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.rawStack.length, 64_000);
    assert.equal(good.value.replayFrames.length, 1);
    assert.equal(good.value.affectedUsersCount, 5);
  }

  assert.equal(getMaxEventBytes({ DEVPULSE_MAX_EVENT_BYTES: "32768" }), 32768);
});
