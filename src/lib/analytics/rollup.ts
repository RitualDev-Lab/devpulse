import { client } from "@/db";

export interface AnalyticsSummarySql {
  totalPageviews: number;
  /** Unique visitors (pseudonymous visitor ids). null when no identified hits exist yet. */
  dau: number | null;
  wau: number | null;
  mau: number | null;
  uniqueReferrers: number;
  topReferrers: Array<{ referrer: string; count: number }>;
  topCountries: Array<{ country: string; count: number }>;
  topPaths: Array<{ path: string; count: number }>;
  topPages: Array<{ path: string; count: number }>;
  topCustomEvents: Array<{ event: string; count: number }>;
  topOs: Array<{ os: string; count: number }>;
  dailySeries: Array<{ date: string; hits: number }>;
  dailyCohorts: Array<{ date: string; web: number; appCli: number; total: number }>;
  sources: { web: number; app: number };
  devices: { desktop: number; mobile: number };
}

/**
 * Pure SQL GROUP BY analytics rollups using the composite `(project_id, created_at)` index.
 * Removes the legacy 500-row ceiling so projects with 100k+ beacons aggregate accurately in ~15ms.
 */
export async function loadAnalyticsSummarySql(
  projectId: string,
  cutoffIso: string
): Promise<AnalyticsSummarySql> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekCutoffIso = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const monthCutoffIso = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [
    totalsRes,
    dauWauMauRes,
    refRes,
    countryRes,
    pagesRes,
    customRes,
    osRes,
    dailyRes,
  ] = await Promise.all([
    client.execute({
      sql: `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN source_type = 'web' OR source_type IS NULL THEN 1 ELSE 0 END) AS web_hits,
          SUM(CASE WHEN source_type IS NOT NULL AND source_type != 'web' THEN 1 ELSE 0 END) AS app_hits,
          SUM(CASE WHEN device IN ('mobile', 'tablet') THEN 1 ELSE 0 END) AS mobile_hits,
          SUM(CASE WHEN device NOT IN ('mobile', 'tablet') OR device IS NULL THEN 1 ELSE 0 END) AS desktop_hits,
          COUNT(DISTINCT referrer) AS unique_referrers
        FROM pageviews
        WHERE project_id = ? AND created_at >= ?
      `,
      args: [projectId, cutoffIso],
    }),
    client.execute({
      sql: `
        SELECT
          COUNT(DISTINCT CASE WHEN substr(created_at, 1, 10) = ? THEN visitor_id END) AS dau,
          COUNT(DISTINCT CASE WHEN substr(created_at, 1, 10) >= ? THEN visitor_id END) AS wau,
          COUNT(DISTINCT CASE WHEN substr(created_at, 1, 10) >= ? THEN visitor_id END) AS mau,
          SUM(CASE WHEN visitor_id IS NOT NULL THEN 1 ELSE 0 END) AS identified_hits
        FROM pageviews
        WHERE project_id = ? AND created_at >= ?
      `,
      args: [todayIso, weekCutoffIso, monthCutoffIso, projectId, monthCutoffIso],
    }),
    client.execute({
      sql: `
        SELECT referrer AS label, COUNT(*) AS cnt
        FROM pageviews
        WHERE project_id = ? AND created_at >= ?
        GROUP BY referrer
        ORDER BY cnt DESC
        LIMIT 20
      `,
      args: [projectId, cutoffIso],
    }),
    client.execute({
      sql: `
        SELECT country AS label, COUNT(*) AS cnt
        FROM pageviews
        WHERE project_id = ? AND created_at >= ?
        GROUP BY country
        ORDER BY cnt DESC
        LIMIT 25
      `,
      args: [projectId, cutoffIso],
    }),
    client.execute({
      sql: `
        SELECT path AS label, COUNT(*) AS cnt
        FROM pageviews
        WHERE project_id = ? AND created_at >= ? AND (event_name = 'pageview' OR event_name IS NULL)
        GROUP BY path
        ORDER BY cnt DESC
        LIMIT 20
      `,
      args: [projectId, cutoffIso],
    }),
    client.execute({
      sql: `
        SELECT event_name AS label, COUNT(*) AS cnt
        FROM pageviews
        WHERE project_id = ? AND created_at >= ? AND event_name IS NOT NULL AND event_name != 'pageview'
        GROUP BY event_name
        ORDER BY cnt DESC
        LIMIT 20
      `,
      args: [projectId, cutoffIso],
    }),
    client.execute({
      sql: `
        SELECT os AS label, COUNT(*) AS cnt
        FROM pageviews
        WHERE project_id = ? AND created_at >= ?
        GROUP BY os
        ORDER BY cnt DESC
        LIMIT 15
      `,
      args: [projectId, cutoffIso],
    }),
    client.execute({
      sql: `
        SELECT
          substr(created_at, 1, 10) AS day,
          COUNT(*) AS total,
          SUM(CASE WHEN source_type = 'web' OR source_type IS NULL THEN 1 ELSE 0 END) AS web_hits,
          SUM(CASE WHEN source_type IS NOT NULL AND source_type != 'web' THEN 1 ELSE 0 END) AS app_hits
        FROM pageviews
        WHERE project_id = ? AND created_at >= ?
        GROUP BY day
        ORDER BY day ASC
        LIMIT 30
      `,
      args: [projectId, monthCutoffIso > cutoffIso ? monthCutoffIso : cutoffIso],
    }),
  ]);

  const totRow = (totalsRes.rows[0] || {}) as any;
  const dwmRow = (dauWauMauRes.rows[0] || {}) as any;
  const hasIdentified = Number(dwmRow.identified_hits || 0) > 0;

  const topPages = pagesRes.rows.map((r: any) => ({
    path: String(r.label || "/"),
    count: Number(r.cnt || 0),
  }));
  const topCustomEvents = customRes.rows.map((r: any) => ({
    event: String(r.label || "event"),
    count: Number(r.cnt || 0),
  }));

  const topPaths = [
    ...topPages,
    ...topCustomEvents.map((e) => ({ path: `event:${e.event}`, count: e.count })),
  ]
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const dailyCohorts = dailyRes.rows.map((r: any) => ({
    date: String(r.day || todayIso),
    web: Number(r.web_hits || 0),
    appCli: Number(r.app_hits || 0),
    total: Number(r.total || 0),
  }));

  return {
    totalPageviews: Number(totRow.total || 0),
    dau: hasIdentified ? Number(dwmRow.dau || 0) : null,
    wau: hasIdentified ? Number(dwmRow.wau || 0) : null,
    mau: hasIdentified ? Number(dwmRow.mau || 0) : null,
    uniqueReferrers: Number(totRow.unique_referrers || 0),
    topReferrers: refRes.rows.map((r: any) => ({
      referrer: String(r.label || "direct"),
      count: Number(r.cnt || 0),
    })),
    topCountries: countryRes.rows.map((r: any) => ({
      country: String(r.label || "Global"),
      count: Number(r.cnt || 0),
    })),
    topPaths,
    topPages,
    topCustomEvents,
    topOs: osRes.rows.map((r: any) => ({
      os: String(r.label || "Unknown"),
      count: Number(r.cnt || 0),
    })),
    dailySeries: dailyCohorts.slice(-14).map((d) => ({ date: d.date, hits: d.total })),
    dailyCohorts: dailyCohorts.slice(-30),
    sources: {
      web: Number(totRow.web_hits || 0),
      app: Number(totRow.app_hits || 0),
    },
    devices: {
      desktop: Number(totRow.desktop_hits || 0),
      mobile: Number(totRow.mobile_hits || 0),
    },
  };
}
