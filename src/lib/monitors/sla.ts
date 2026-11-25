import type { uptimeChecks, uptimeIncidents, uptimeMonitors } from "@/db/schema";

export type MonitorRow = typeof uptimeMonitors.$inferSelect;
export type CheckRow = typeof uptimeChecks.$inferSelect;
export type IncidentRow = typeof uptimeIncidents.$inferSelect;

export interface MonitorSlaSummary {
  monitorId: string;
  name: string;
  url: string;
  slaTargetPercent: string;
  slaTargetBp: number;
  actualUptimePercent: string | null;
  actualUptimeBp: number | null;
  /** null when the month has no probe results or incidents for this monitor. */
  compliant: boolean | null;
  totalChecks: number;
  downChecks: number;
  degradedChecks: number;
  p95LatencyMs: number | null;
  downtimeMinutes: number;
  errorBudgetRemainingMinutes: number | null;
}

export interface MonthlySlaReport {
  month: string;
  projectName: string;
  projectSlug: string;
  overallUptimePercent: string | null;
  overallTargetPercent: string;
  overallCompliant: boolean | null;
  /** Monitors with no measurements this month; excluded from the overall uptime average. */
  monitorsWithoutData: number;
  totalDowntimeMinutes: number;
  monitors: MonitorSlaSummary[];
  incidents: IncidentRow[];
}

export interface StatusDayBucket {
  date: string; // YYYY-MM-DD
  status: "operational" | "degraded" | "outage" | "no_data";
  uptimePercent: string;
  totalChecks: number;
  downChecks: number;
  incidentCount: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function computeP95(values: number[]): number {
  const valid = values.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  return Math.round(valid[Math.max(0, Math.ceil(0.95 * valid.length) - 1)]);
}

/** Inclusive start and exclusive end of a YYYY-MM month, as YYYY-MM-DD strings. null when malformed. */
export function monthBounds(month: string): { start: string; end: string } | null {
  const match = /^([0-9]{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  const nextYear = monthNum === 12 ? year + 1 : year;
  const nextMonth = monthNum === 12 ? 1 : monthNum + 1;
  return {
    start: `${month}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

/** Real length of a calendar month in minutes (28-31 days). */
function minutesInCalendarMonth(month: string): number {
  const [year, monthNum] = month.split("-").map(Number);
  // Day 0 of the following month is the last day of this month.
  return new Date(Date.UTC(year, monthNum, 0)).getUTCDate() * 24 * 60;
}

/**
 * Computes monthly SLA compliance metrics, error budget remaining, and incident downtime.
 */
export function computeMonthlySlaReport(params: {
  projectName: string;
  projectSlug: string;
  month: string; // YYYY-MM
  monitors: MonitorRow[];
  checks: CheckRow[];
  incidents: IncidentRow[];
}): MonthlySlaReport {
  const { projectName, projectSlug, month, monitors, checks, incidents } = params;
  const minutesInPeriod = minutesInCalendarMonth(month);

  const monthChecks = checks.filter((c) => c.checkedAt.startsWith(month));
  const monthIncidents = incidents.filter((i) => i.startedAt.startsWith(month));

  const monitorSummaries: MonitorSlaSummary[] = monitors.map((mon) => {
    const slaTargetBp = mon.slaTargetBp || 9990;
    const monChecks = monthChecks.filter((c) => c.monitorId === mon.id);
    const monIncidents = monthIncidents.filter((i) => i.monitorId === mon.id);
    const totalChecks = monChecks.length;

    // Nothing was measured for this monitor in this month: report no data, not 100%.
    if (totalChecks === 0 && monIncidents.length === 0) {
      return {
        monitorId: mon.id,
        name: mon.name,
        url: mon.url,
        slaTargetPercent: (slaTargetBp / 100).toFixed(2),
        slaTargetBp,
        actualUptimePercent: null,
        actualUptimeBp: null,
        compliant: null,
        totalChecks: 0,
        downChecks: 0,
        degradedChecks: 0,
        p95LatencyMs: null,
        downtimeMinutes: 0,
        errorBudgetRemainingMinutes: null,
      };
    }

    const downChecks = monChecks.filter((c) => c.status === "down").length;
    const degradedChecks = monChecks.filter((c) => c.status === "degraded").length;

    const recordedDowntime = monIncidents
      .filter((i) => i.durationMinutes)
      .reduce((s, i) => s + Math.max(0, i.durationMinutes || 0), 0);

    // Probe-based uptime is only defined when probes ran; incidents alone still bound it.
    const checkUptimeBp =
      totalChecks > 0 ? Math.round(((totalChecks - downChecks) / totalChecks) * 10000) : 10000;

    const estimatedDowntimeFromChecks =
      totalChecks > 0 ? Math.round((downChecks / totalChecks) * minutesInPeriod) : 0;
    const downtimeMinutes = Math.max(recordedDowntime, estimatedDowntimeFromChecks);

    const incidentAdjustedBp = Math.max(
      0,
      Math.round(((minutesInPeriod - downtimeMinutes) / minutesInPeriod) * 10000)
    );
    const actualUptimeBp = Math.min(checkUptimeBp, incidentAdjustedBp);

    const allowedDowntime = ((10000 - slaTargetBp) / 10000) * minutesInPeriod;
    const errorBudgetRemainingMinutes = Math.round((allowedDowntime - downtimeMinutes) * 10) / 10;

    return {
      monitorId: mon.id,
      name: mon.name,
      url: mon.url,
      slaTargetPercent: (slaTargetBp / 100).toFixed(2),
      slaTargetBp,
      actualUptimePercent: (actualUptimeBp / 100).toFixed(2),
      actualUptimeBp,
      compliant: actualUptimeBp >= slaTargetBp,
      totalChecks,
      downChecks,
      degradedChecks,
      p95LatencyMs: totalChecks > 0 ? computeP95(monChecks.map((c) => c.latencyMs)) : null,
      downtimeMinutes,
      errorBudgetRemainingMinutes,
    };
  });

  const measured = monitorSummaries.filter((m) => m.actualUptimeBp !== null);
  const avgActualBp =
    measured.length > 0
      ? Math.round(
          measured.reduce((s, m) => s + (m.actualUptimeBp as number), 0) / measured.length
        )
      : null;
  const strictTargetBp =
    monitorSummaries.length > 0
      ? Math.max(...monitorSummaries.map((m) => m.slaTargetBp))
      : 9990;

  const projectOnlyDowntime = projectLevelDowntime(monthIncidents);
  const totalDowntimeMinutes =
    monitorSummaries.reduce((s, m) => s + m.downtimeMinutes, 0) + projectOnlyDowntime;

  return {
    month,
    projectName,
    projectSlug,
    overallUptimePercent: avgActualBp === null ? null : (avgActualBp / 100).toFixed(2),
    overallTargetPercent: (strictTargetBp / 100).toFixed(2),
    overallCompliant:
      avgActualBp === null
        ? null
        : measured.every((m) => m.compliant === true) && avgActualBp >= strictTargetBp,
    monitorsWithoutData: monitorSummaries.length - measured.length,
    totalDowntimeMinutes,
    monitors: monitorSummaries,
    incidents: monthIncidents,
  };
}

/** Downtime from incidents not tied to a monitor (project-level outages). */
function projectLevelDowntime(incidents: IncidentRow[]): number {
  return incidents
    .filter((i) => !i.monitorId)
    .reduce((s, i) => s + Math.max(0, i.durationMinutes || 0), 0);
}

/**
 * Generates printable Monthly SLA Compliance PDF Report HTML.
 */
export function renderSlaReportHtml(report: MonthlySlaReport): string {
  const statusBadge = report.overallCompliant === null
    ? `<span style="background:#27272a;color:#a1a1aa;padding:4px 10px;border-radius:999px;font-weight:700;font-size:12px;">NO DATA</span>`
    : report.overallCompliant
    ? `<span style="background:#064e3b;color:#6ee7b7;padding:4px 10px;border-radius:999px;font-weight:700;font-size:12px;">SLA COMPLIANT</span>`
    : `<span style="background:#7f1d1d;color:#fca5a5;padding:4px 10px;border-radius:999px;font-weight:700;font-size:12px;">SLA BREACHED</span>`;

  const monitorRows = report.monitors
    .map(
      (m) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e4e4e7;"><strong>${escapeHtml(m.name)}</strong><br/><span style="color:#71717a;font-size:11px;">${escapeHtml(m.url)}</span></td>
        <td style="padding:10px;border-bottom:1px solid #e4e4e7;font-family:monospace;">${m.slaTargetPercent}%</td>
        <td style="padding:10px;border-bottom:1px solid #e4e4e7;font-family:monospace;font-weight:700;color:${m.compliant === null ? "#71717a" : m.compliant ? "#047857" : "#dc2626"};">${m.actualUptimePercent === null ? "No data" : m.actualUptimePercent + "%"}</td>
        <td style="padding:10px;border-bottom:1px solid #e4e4e7;font-family:monospace;">${m.p95LatencyMs === null ? "No data" : m.p95LatencyMs + " ms"}</td>
        <td style="padding:10px;border-bottom:1px solid #e4e4e7;font-family:monospace;">${m.downtimeMinutes} min</td>
        <td style="padding:10px;border-bottom:1px solid #e4e4e7;font-family:monospace;color:${m.errorBudgetRemainingMinutes === null ? "#71717a" : m.errorBudgetRemainingMinutes >= 0 ? "#047857" : "#dc2626"};">${m.errorBudgetRemainingMinutes === null ? "No data" : m.errorBudgetRemainingMinutes + " min"}</td>
      </tr>`
    )
    .join("");

  const incidentRows =
    report.incidents.length === 0
      ? `<p style="color:#52525b;font-size:13px;">Zero downtime incidents recorded during ${escapeHtml(report.month)}.</p>`
      : report.incidents
          .map(
            (inc) => `
          <div style="border:1px solid #e4e4e7;border-radius:10px;padding:12px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="font-size:14px;">${escapeHtml(inc.title)}</strong>
              <span style="font-size:11px;font-family:monospace;background:#f4f4f5;padding:2px 8px;border-radius:6px;">${escapeHtml(inc.severity.toUpperCase())} • ${escapeHtml(inc.status.toUpperCase())} • ${inc.durationMinutes} min</span>
            </div>
            <div style="font-size:11px;color:#71717a;margin-top:4px;">Started: ${escapeHtml(inc.startedAt)}${inc.resolvedAt ? ` • Resolved: ${escapeHtml(inc.resolvedAt)}` : ""}</div>
            ${inc.rcaText ? `<div style="margin-top:8px;padding:8px;background:#fafafa;border-left:3px solid #4f46e5;font-size:12px;"><strong>Root Cause Analysis (RCA):</strong> ${escapeHtml(inc.rcaText)}</div>` : ""}
          </div>`
          )
          .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SLA Compliance Report — ${escapeHtml(report.projectName)} (${escapeHtml(report.month)})</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #18181b; margin: 32px auto; max-width: 900px; padding: 0 20px; }
    @media print { .no-print { display: none !important; } body { margin: 12px; } }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #e4e4e7;padding-bottom:16px;margin-bottom:24px;">
    <div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#4f46e5;font-weight:700;">DevPulse Enterprise SLA Compliance Report</div>
      <h1 style="margin:4px 0 4px 0;font-size:24px;">${escapeHtml(report.projectName)}</h1>
      <div style="font-size:13px;color:#52525b;">Reporting Period: <strong>${escapeHtml(report.month)}</strong> • Generated ${new Date().toISOString().slice(0, 10)}</div>
    </div>
    <div style="text-align:right;">
      ${statusBadge}
      <div class="no-print" style="margin-top:12px;">
        <button onclick="window.print()" style="background:#4f46e5;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;">Save / Print SLA PDF</button>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">
    <div style="border:1px solid #e4e4e7;border-radius:10px;padding:12px;"><div style="font-size:11px;color:#71717a;">Actual Uptime</div><div style="font-size:22px;font-weight:800;">${report.overallUptimePercent === null ? "No data" : report.overallUptimePercent + "%"}</div></div>
    <div style="border:1px solid #e4e4e7;border-radius:10px;padding:12px;"><div style="font-size:11px;color:#71717a;">Target SLA</div><div style="font-size:22px;font-weight:800;">${report.overallTargetPercent}%</div></div>
    <div style="border:1px solid #e4e4e7;border-radius:10px;padding:12px;"><div style="font-size:11px;color:#71717a;">Total Downtime</div><div style="font-size:22px;font-weight:800;">${report.totalDowntimeMinutes}m</div></div>
    <div style="border:1px solid #e4e4e7;border-radius:10px;padding:12px;"><div style="font-size:11px;color:#71717a;">Recorded Incidents</div><div style="font-size:22px;font-weight:800;">${report.incidents.length}</div></div>
  </div>

  <h2 style="font-size:16px;margin-bottom:8px;">Endpoint SLA Breakdown</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:28px;">
    <thead>
      <tr style="background:#f4f4f5;text-align:left;font-size:11px;text-transform:uppercase;color:#52525b;">
        <th style="padding:10px;">Monitor</th>
        <th style="padding:10px;">Target</th>
        <th style="padding:10px;">Actual</th>
        <th style="padding:10px;">P95 Latency</th>
        <th style="padding:10px;">Downtime</th>
        <th style="padding:10px;">Error Budget</th>
      </tr>
    </thead>
    <tbody>
      ${monitorRows || `<tr><td colspan="6" style="padding:14px;color:#71717a;">No uptime monitors configured.</td></tr>`}
    </tbody>
  </table>

  <h2 style="font-size:16px;margin-bottom:10px;">Incident Timeline &amp; Root Cause Analysis (RCA)</h2>
  ${incidentRows}
</body>
</html>`;
}

/**
 * Builds 90-day daily uptime status bars for the public status history page.
 */
export function build90DayStatusHistory(
  monitors: MonitorRow[],
  checks: CheckRow[],
  incidents: IncidentRow[]
): {
  days: StatusDayBucket[];
  perMonitor: Array<{
    monitorId: string;
    name: string;
    url: string;
    uptime90dPercent: string;
    p95LatencyMs: number;
    lastStatus: string;
    days: StatusDayBucket[];
  }>;
  overall90dPercent: string;
} {
  const dayDates: string[] = [];
  const today = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    dayDates.push(d.toISOString().slice(0, 10));
  }

  function buildStrip(monChecks: CheckRow[], monIncidents: IncidentRow[]): StatusDayBucket[] {
    return dayDates.map((date) => {
      const dayChecks = monChecks.filter((c) => c.checkedAt.slice(0, 10) === date);
      const dayInc = monIncidents.filter((inc) => inc.startedAt.slice(0, 10) === date);
      const downChecks = dayChecks.filter((c) => c.status === "down").length;
      const degradedChecks = dayChecks.filter((c) => c.status === "degraded").length;
      const totalChecks = dayChecks.length;

      let status: StatusDayBucket["status"] = "no_data";
      let uptimePercent = "100.00";

      if (totalChecks > 0) {
        const upPct = ((totalChecks - downChecks) / totalChecks) * 100;
        uptimePercent = upPct.toFixed(2);
        if (downChecks > 0 && upPct < 99.0) status = "outage";
        else if (downChecks > 0 || degradedChecks > 0) status = "degraded";
        else status = "operational";
      } else if (dayInc.length > 0) {
        status = dayInc.some((i) => i.severity === "critical") ? "outage" : "degraded";
        uptimePercent = "98.50";
      }

      return {
        date,
        status,
        uptimePercent,
        totalChecks,
        downChecks,
        incidentCount: dayInc.length,
      };
    });
  }

  const perMonitor = monitors.map((m) => {
    const monChecks = checks.filter((c) => c.monitorId === m.id);
    const monIncs = incidents.filter((inc) => inc.monitorId === m.id);
    const downCount = monChecks.filter((c) => c.status === "down").length;
    const pct =
      monChecks.length > 0
        ? (((monChecks.length - downCount) / monChecks.length) * 100).toFixed(2)
        : (m.uptimeBasisPoints / 100).toFixed(2);
    return {
      monitorId: m.id,
      name: m.name,
      url: m.url,
      uptime90dPercent: pct,
      p95LatencyMs: m.p95LatencyMs,
      lastStatus: m.lastStatus,
      days: buildStrip(monChecks, monIncs),
    };
  });

  const overallDays = buildStrip(checks, incidents);
  const allDown = checks.filter((c) => c.status === "down").length;
  const overall90dPercent =
    checks.length > 0
      ? (((checks.length - allDown) / checks.length) * 100).toFixed(2)
      : perMonitor.length > 0
      ? (
          perMonitor.reduce((s, m) => s + Number(m.uptime90dPercent), 0) / perMonitor.length
        ).toFixed(2)
      : "100.00";

  return {
    days: overallDays,
    perMonitor,
    overall90dPercent,
  };
}
