import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dailyMetrics } from "@/db/schema";
import { computeDailyDeltas } from "@/lib/metrics/daily-delta";

const BATCH_SIZE = 100;

/**
 * Recompute and persist day-over-day deltas for one project's daily metrics.
 * Only rows whose stored delta changed are written, in batched statements, so
 * steady-state syncs touch just the newest rows. Returns the rows updated.
 */
export async function refreshDailyDeltas(projectId: string): Promise<number> {
  const rows = await db
    .select({
      id: dailyMetrics.id,
      source: dailyMetrics.source,
      metricType: dailyMetrics.metricType,
      date: dailyMetrics.date,
      value: dailyMetrics.value,
      delta: dailyMetrics.delta,
    })
    .from(dailyMetrics)
    .where(eq(dailyMetrics.projectId, projectId));

  const deltas = computeDailyDeltas(rows);
  const changed = rows.filter((r) => (deltas.get(r.id) ?? null) !== (r.delta ?? null));

  for (let i = 0; i < changed.length; i += BATCH_SIZE) {
    const chunk = changed.slice(i, i + BATCH_SIZE);
    await db.batch(
      chunk.map((r) =>
        db
          .update(dailyMetrics)
          .set({ delta: deltas.get(r.id) ?? null })
          .where(eq(dailyMetrics.id, r.id))
      ) as [any, ...any[]]
    );
  }
  return changed.length;
}
