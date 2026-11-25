import test from "node:test";
import assert from "node:assert/strict";
import {
  attachSessionShare,
  computeDailyDeltas,
  computeSessionShare,
  type DailyPoint,
} from "../src/lib/metrics/daily-delta";

const point = (id: string, date: string, value: number, metricType = "stars", source = "github"): DailyPoint => ({
  id,
  source,
  metricType,
  date,
  value,
});

test("first day of a series has no delta; later days diff against the previous day", () => {
  const deltas = computeDailyDeltas([
    point("a", "2026-01-01", 10),
    point("b", "2026-01-02", 13),
    point("c", "2026-01-03", 11),
  ]);
  assert.equal(deltas.get("a"), null);
  assert.equal(deltas.get("b"), 3);
  assert.equal(deltas.get("c"), -2);
});

test("out-of-order input is sorted by date before diffing", () => {
  const deltas = computeDailyDeltas([
    point("c", "2026-01-03", 15),
    point("a", "2026-01-01", 10),
    point("b", "2026-01-02", 12),
  ]);
  assert.equal(deltas.get("a"), null);
  assert.equal(deltas.get("b"), 2);
  assert.equal(deltas.get("c"), 3);
});

test("gaps diff against the previous recorded day, not the calendar day", () => {
  const deltas = computeDailyDeltas([
    point("a", "2026-01-01", 100),
    point("b", "2026-01-05", 130),
  ]);
  assert.equal(deltas.get("b"), 30);
});

test("series are independent per source and metric type", () => {
  const deltas = computeDailyDeltas([
    point("stars", "2026-01-01", 50, "stars", "github"),
    point("views", "2026-01-01", 900, "pageviews", "web"),
    point("stars2", "2026-01-02", 55, "stars", "github"),
    point("views2", "2026-01-02", 950, "pageviews", "web"),
  ]);
  assert.equal(deltas.get("stars2"), 5);
  assert.equal(deltas.get("views2"), 50);
});

test("duplicate rows for one date share the same delta", () => {
  const deltas = computeDailyDeltas([
    point("d1-a", "2026-01-01", 10),
    point("d2-a", "2026-01-02", 14),
    point("d2-b", "2026-01-02", 14),
  ]);
  assert.equal(deltas.get("d2-a"), 4);
  assert.equal(deltas.get("d2-b"), 4);
});

test("session share sums to 100 across releases and is null without sessions", () => {
  const share = computeSessionShare([
    { id: "r1", totalSessions: 300 },
    { id: "r2", totalSessions: 100 },
    { id: "r3", totalSessions: 0 },
  ]);
  assert.equal(share.get("r1"), 75);
  assert.equal(share.get("r2"), 25);
  assert.equal(share.get("r3"), 0);

  const none = computeSessionShare([
    { id: "r1", totalSessions: 0 },
    { id: "r2", totalSessions: 0 },
  ]);
  assert.equal(none.get("r1"), null);
  assert.equal(none.get("r2"), null);
});

test("attachSessionShare keeps row fields and adds the share", () => {
  const rows = attachSessionShare([
    { id: "r1", totalSessions: 1, tag: "v1" },
    { id: "r2", totalSessions: 3, tag: "v2" },
  ]);
  assert.deepEqual(rows[1], { id: "r2", totalSessions: 3, tag: "v2", sessionSharePct: 75 });
});
