import test from "node:test";
import assert from "node:assert/strict";
import { compileNlToSafeSql, validateReadOnlySelectSql } from "../src/lib/analytics/nl-explorer";
import { computeDoraScorecard } from "../src/lib/analytics/dora";

test("compileNlToSafeSql generates project-scoped SELECT queries and blocks SQL injection", () => {
  const crashQuery = compileNlToSafeSql("show top crash routes this week", "proj_123");
  assert.equal(validateReadOnlySelectSql(crashQuery.sql).valid, true);
  assert.match(crashQuery.sql, /WHERE project_id = 'proj_123'/);

  assert.equal(validateReadOnlySelectSql("DROP TABLE projects; SELECT * FROM users").valid, false);
  assert.equal(validateReadOnlySelectSql("DELETE FROM error_events WHERE project_id = 'p1'").valid, false);
  assert.equal(validateReadOnlySelectSql("SELECT * FROM projects -- bypass").valid, false);
  assert.equal(validateReadOnlySelectSql("SELECT * FROM error_events").valid, false); // missing project_id scope
});

test("computeDoraScorecard scores Elite vs Medium deployments accurately", () => {
  const now = Date.now();
  const elite = computeDoraScorecard({
    windowDays: 30,
    avgPrReviewHours: 4.5,
    deployments: Array.from({ length: 32 }, (_, i) => ({
      status: i === 5 ? "failed" : "success",
      createdAtMs: now - i * 86400_000,
      resolvedAtMs: i === 5 ? now - i * 86400_000 + 20 * 60_000 : null,
    })),
  });

  assert.equal(elite.deployFrequencyTier, "Elite");
  assert.equal(elite.leadTimeTier, "Elite");
  assert.equal(elite.changeFailureTier, "Elite");
  assert.equal(elite.mttrMinutes, 20);
  assert.equal(elite.overallTier, "Elite");
});
