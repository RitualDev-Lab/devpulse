import { db } from "@/db";
import { crashIssues } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { computeCrashFingerprint } from "./impact";

const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15-minute cooldown between repeat alerts on same issue
const ALERT_MILESTONES = new Set([10, 50, 250, 1000, 5000]);

export interface CrashIssueUpsertResult {
  issueId: string;
  fingerprint: string;
  topFrame: string;
  occurrenceCount: number;
  shouldAlert: boolean;
  isRegression: boolean;
}

/**
 * Fingerprints an incoming crash (`projectId + errorName + normalized top frame`),
 * atomically upserts its grouped `crash_issues` record (`occurrenceCount`, `firstSeenAt`, `lastSeenAt`),
 * and evaluates the anti-storm alert cooldown gate so crash loops never trigger alert storms.
 */
export async function recordCrashIssueOccurrence(params: {
  projectId: string;
  errorName: string;
  stackTrace?: string | null;
  explicitRegression?: boolean;
}): Promise<CrashIssueUpsertResult> {
  const { fingerprint, topFrame } = await computeCrashFingerprint(
    params.projectId,
    params.errorName,
    params.stackTrace
  );
  const issueId = `iss_${params.projectId}_${fingerprint}`;
  const nowIso = new Date().toISOString();

  const [existing] = await db
    .select()
    .from(crashIssues)
    .where(and(eq(crashIssues.projectId, params.projectId), eq(crashIssues.fingerprint, fingerprint)))
    .limit(1)
    .catch(() => []);

  if (!existing) {
    await db
      .insert(crashIssues)
      .values({
        id: issueId,
        projectId: params.projectId,
        fingerprint,
        errorName: params.errorName.slice(0, 255),
        topFrame,
        occurrenceCount: 1,
        status: "unresolved",
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        lastAlertedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: crashIssues.id,
        set: {
          occurrenceCount: sql`${crashIssues.occurrenceCount} + 1`,
          lastSeenAt: nowIso,
        },
      })
      .catch(() => {});

    return {
      issueId,
      fingerprint,
      topFrame,
      occurrenceCount: 1,
      shouldAlert: true,
      isRegression: Boolean(params.explicitRegression),
    };
  }

  const nextCount = Number(existing.occurrenceCount || 1) + 1;
  const regressed = Boolean(params.explicitRegression || existing.status === "resolved");
  const lastAlertMs = existing.lastAlertedAt ? Date.parse(existing.lastAlertedAt) : 0;
  const cooldownExpired = !lastAlertMs || Date.now() - lastAlertMs >= ALERT_COOLDOWN_MS;

  const isMilestone = ALERT_MILESTONES.has(nextCount) || (nextCount > 5000 && nextCount % 5000 === 0);
  const shouldAlert =
    existing.status !== "ignored" && (regressed || (isMilestone && cooldownExpired));

  await db
    .update(crashIssues)
    .set({
      occurrenceCount: sql`${crashIssues.occurrenceCount} + 1`,
      lastSeenAt: nowIso,
      ...(regressed ? { status: "unresolved" } : {}),
      ...(shouldAlert ? { lastAlertedAt: nowIso } : {}),
    })
    .where(eq(crashIssues.id, existing.id))
    .catch(() => {});

  return {
    issueId: existing.id,
    fingerprint,
    topFrame,
    occurrenceCount: nextCount,
    shouldAlert,
    isRegression: regressed,
  };
}
