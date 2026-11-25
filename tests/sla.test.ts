import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMonthlySlaReport,
  monthBounds,
  type CheckRow,
  type IncidentRow,
  type MonitorRow,
} from "../src/lib/monitors/sla";

function monitor(id: string, slaTargetBp = 9990): MonitorRow {
  return { id, name: id, url: `https://${id}.example.com`, slaTargetBp } as unknown as MonitorRow;
}

function check(monitorId: string, status: string, checkedAt: string): CheckRow {
  return { monitorId, status, latencyMs: 100, checkedAt } as unknown as CheckRow;
}

function incident(monitorId: string | null, startedAt: string, durationMinutes: number): IncidentRow {
  return { monitorId, startedAt, durationMinutes } as unknown as IncidentRow;
}

function run(month: string, monitors: MonitorRow[], checks: CheckRow[], incidents: IncidentRow[] = []) {
  return computeMonthlySlaReport({
    projectName: "P",
    projectSlug: "p",
    month,
    monitors,
    checks,
    incidents,
  });
}

test("monthBounds returns inclusive start and exclusive end, and rejects malformed months", () => {
  assert.deepEqual(monthBounds("2026-02"), { start: "2026-02-01", end: "2026-03-01" });
  assert.deepEqual(monthBounds("2026-12"), { start: "2026-12-01", end: "2027-01-01" });
  assert.equal(monthBounds("2026-13"), null);
  assert.equal(monthBounds("26-01"), null);
  assert.equal(monthBounds("2026-1"), null);
});

test("a month with no checks or incidents reports no data, never 100%", () => {
  const report = run("2026-03", [monitor("m1")], []);
  const m = report.monitors[0];
  assert.equal(m.actualUptimePercent, null);
  assert.equal(m.actualUptimeBp, null);
  assert.equal(m.compliant, null);
  assert.equal(m.p95LatencyMs, null);
  assert.equal(m.errorBudgetRemainingMinutes, null);
  assert.equal(report.overallUptimePercent, null);
  assert.equal(report.overallCompliant, null);
  assert.equal(report.monitorsWithoutData, 1);
});

test("checks from other months are excluded from the requested month", () => {
  const report = run("2026-02", [monitor("m1")], [check("m1", "down", "2026-01-31 23:59:00")]);
  assert.equal(report.monitors[0].actualUptimeBp, null);
  assert.equal(report.monitorsWithoutData, 1);
});

test("incident-only month is bounded by the incident, not assumed 100%", () => {
  // 60 minutes down in a 30-day month: 43200 min total.
  const report = run("2026-04", [monitor("m1")], [], [incident("m1", "2026-04-10 12:00:00", 60)]);
  const m = report.monitors[0];
  assert.equal(m.actualUptimeBp, 9986);
  assert.equal(m.compliant, false);
  assert.equal(m.downtimeMinutes, 60);
});

test("error budget uses the real length of the calendar month", () => {
  const incidents = [incident("m1", "2026-02-05 00:00:00", 10), incident("m1", "2026-03-05 00:00:00", 10)];
  const checks = [check("m1", "up", "2026-02-05 00:00:00"), check("m1", "up", "2026-03-05 00:00:00")];
  const feb = run("2026-02", [monitor("m1")], checks.slice(0, 1), incidents.slice(0, 1));
  const mar = run("2026-03", [monitor("m1")], checks.slice(1), incidents.slice(1));
  // 99.9% target: 0.1% of 28 days = 40.32 min allowed; 31 days = 44.64 min.
  assert.equal(feb.monitors[0].errorBudgetRemainingMinutes, 30.3);
  assert.equal(mar.monitors[0].errorBudgetRemainingMinutes, 34.6);
});

test("overall uptime averages only monitors that have data", () => {
  const report = run(
    "2026-05",
    [monitor("measured"), monitor("silent")],
    [check("measured", "up", "2026-05-01 00:00:00"), check("measured", "up", "2026-05-02 00:00:00")]
  );
  assert.equal(report.overallUptimePercent, "100.00");
  assert.equal(report.overallCompliant, true);
  assert.equal(report.monitorsWithoutData, 1);
  assert.equal(report.monitors.find((m) => m.monitorId === "silent")?.compliant, null);
});

test("probe failures produce a measured uptime and p95 from the month", () => {
  const checks = [
    check("m1", "up", "2026-06-01 00:00:00"),
    check("m1", "down", "2026-06-01 00:01:00"),
    check("m1", "up", "2026-06-01 00:02:00"),
    check("m1", "up", "2026-06-01 00:03:00"),
  ];
  const m = run("2026-06", [monitor("m1")], checks).monitors[0];
  assert.equal(m.totalChecks, 4);
  assert.equal(m.downChecks, 1);
  assert.equal(m.actualUptimeBp, 7500);
  assert.equal(m.compliant, false);
  assert.equal(m.p95LatencyMs, 100);
});
