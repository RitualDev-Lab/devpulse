// Pure helpers for day-over-day metric deltas and release session share.
// No database imports: keep this module testable without Turso configured.

export interface DailyPoint {
  id: string;
  source: string;
  metricType: string;
  date: string; // YYYY-MM-DD
  value: number;
}

/**
 * Delta for each daily row: value minus the value on the previous recorded
 * date in the same (source, metricType) series. The first date in a series
 * has no baseline, so its delta is null. Rows that share a date take the same
 * delta, so duplicate writes for one day never produce conflicting deltas.
 */
export function computeDailyDeltas(points: DailyPoint[]): Map<string, number | null> {
  const series = new Map<string, DailyPoint[]>();
  for (const p of points) {
    const key = `${p.source}\u0000${p.metricType}`;
    const bucket = series.get(key);
    if (bucket) bucket.push(p);
    else series.set(key, [p]);
  }

  const out = new Map<string, number | null>();
  for (const rows of series.values()) {
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    let dayDate: string | null = null;
    let dayValue = 0;
    let dayDelta: number | null = null;
    let baseline: number | null = null; // value on the previous distinct date

    for (const row of rows) {
      if (row.date !== dayDate) {
        if (dayDate !== null) baseline = dayValue;
        dayDate = row.date;
        dayValue = row.value;
        dayDelta = baseline === null ? null : row.value - baseline;
      }
      out.set(row.id, dayDelta);
    }
  }
  return out;
}

export interface ReleaseSessions {
  id: string;
  totalSessions: number;
}

/**
 * Share of all recorded SDK sessions attributed to each release, in percent
 * (two decimals). Null when no release has sessions, so no share is invented.
 */
export function computeSessionShare(releases: ReleaseSessions[]): Map<string, number | null> {
  const sessions = releases.map((r) => Math.max(0, Number(r.totalSessions) || 0));
  const total = sessions.reduce((sum, n) => sum + n, 0);
  const out = new Map<string, number | null>();
  releases.forEach((r, i) => {
    out.set(r.id, total > 0 ? Math.round((sessions[i] / total) * 10000) / 100 : null);
  });
  return out;
}

export function attachSessionShare<T extends ReleaseSessions>(
  rows: T[]
): Array<T & { sessionSharePct: number | null }> {
  const share = computeSessionShare(rows);
  return rows.map((r) => ({ ...r, sessionSharePct: share.get(r.id) ?? null }));
}
