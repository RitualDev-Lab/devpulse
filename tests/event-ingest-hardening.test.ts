import test from "node:test";
import assert from "node:assert/strict";
import {
  getMaxEventBytes,
  readBoundedRequestText,
  reserveAtomicEventQuotaSlot,
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

test("readBoundedRequestText cancels oversized chunked streams without reading full payload", async () => {
  let chunksServed = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksServed++;
      controller.enqueue(new Uint8Array(2048));
      if (chunksServed >= 20) controller.close();
    },
  });

  const req = new Request("https://devpulse.ritualdev.in/api/v1/event", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);

  const res = await readBoundedRequestText(req, 4096);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 413);
  }
  assert.equal(chunksServed < 20, true);
});

test("reserveAtomicEventQuotaSlot enforces exact ceiling under concurrent requests", async () => {
  let used = 0;
  const limit = 3;

  const atomicConditionalIncrement = async () => {
    if (used < limit) {
      used += 1;
      return true;
    }
    return false;
  };

  const results = await Promise.all(
    Array.from({ length: 10 }, () => reserveAtomicEventQuotaSlot(atomicConditionalIncrement))
  );

  const allowedCount = results.filter((r) => r.allowed).length;
  const blockedCount = results.filter((r) => !r.allowed).length;

  assert.equal(allowedCount, 3);
  assert.equal(blockedCount, 7);
  assert.equal(used, 3);
});
