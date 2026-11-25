import { db } from "@/db";
import { uptimeChecks, uptimeIncidents, uptimeMonitors } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { loadPortalData } from "@/lib/domains/portal-loader";
import { build90DayStatusHistory } from "@/lib/monitors/sla";

export async function loadPortalStatusHistory(
  hostKey: string,
  requestedProjectSlug?: string
) {
  const portal = await loadPortalData(hostKey, requestedProjectSlug);
  if (!portal) return null;

  const active = portal.activeProject;
  if (!active) {
    return {
      portal,
      history: build90DayStatusHistory([], [], []),
      incidents: [],
    };
  }

  const [monitors, checks, incidents] = await Promise.all([
    db.select().from(uptimeMonitors).where(eq(uptimeMonitors.projectId, active.id)).limit(25),
    db
      .select()
      .from(uptimeChecks)
      .where(eq(uptimeChecks.projectId, active.id))
      .orderBy(desc(uptimeChecks.checkedAt))
      .limit(2000),
    db
      .select()
      .from(uptimeIncidents)
      .where(
        and(eq(uptimeIncidents.projectId, active.id), eq(uptimeIncidents.isPublic, true))
      )
      .orderBy(desc(uptimeIncidents.startedAt))
      .limit(60),
  ]);

  const cutoffIso = new Date(Date.now() - 90 * 86400_000).toISOString();
  const recent90Checks = checks.filter((c) => c.checkedAt >= cutoffIso);
  const recent90Incidents = incidents.filter((inc) => inc.startedAt >= cutoffIso);

  const history = build90DayStatusHistory(monitors, recent90Checks, recent90Incidents);

  return {
    portal,
    history,
    incidents: recent90Incidents,
  };
}
