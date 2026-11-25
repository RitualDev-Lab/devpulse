import { NextRequest, NextResponse } from "next/server";
import { syncAllProjects } from "@/lib/sync/sync-metrics";
import { runDueUptimeChecks } from "@/lib/monitors/checker";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendProjectDigest } from "@/lib/alerts/digest";
import { processPendingEscalations } from "@/lib/alerts/smart-engine";
import { runDueSyntheticTests } from "@/lib/synthetics/yaml-runner";
import { refreshAllProjectSnapshots } from "@/lib/dashboard/snapshots";
import { pruneExpiredRateLimits } from "@/lib/security/rate-limit";
import { pruneExpiredPendingUploads } from "@/lib/storage/quota";
import { apiError } from "@/lib/security/api-error";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleSync(req);
}

export async function POST(req: NextRequest) {
  return handleSync(req);
}

async function handleSync(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET?.trim();

    // Fail closed if CRON_SECRET is not configured
    if (!cronSecret) {
      return NextResponse.json(
        { error: "Cron endpoint disabled: CRON_SECRET is not configured." },
        { status: 503 }
      );
    }

    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!token || token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized cron trigger" }, { status: 401 });
    }

    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") || 0));
    const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 20)));

    const startedAt = new Date().toISOString();
    const [
      results,
      snapshotSummary,
      uptimeSummary,
      escalationSummary,
      syntheticsSummary,
      prunedRateLimits,
      prunedPendingUploads,
    ] = await Promise.all([
      syncAllProjects({ offset, limit }),
      refreshAllProjectSnapshots(limit).catch(() => ({ refreshed: 0, projectIds: [] })),
      runDueUptimeChecks().catch((e) => {
        console.error("Uptime check failed:", e);
        return { checked: 0, error: "Uptime check failed" };
      }),
      processPendingEscalations().catch(() => ({ escalated: 0 })),
      runDueSyntheticTests().catch(() => ({ totalActive: 0, executed: 0 })),
      pruneExpiredRateLimits(),
      pruneExpiredPendingUploads(),
    ]);

    // Dispatch weekly maintainer digest for projects opted into digestEnabled (>7 days since lastDigestSentAt)
    let digestsSent = 0;
    try {
      const digestProjects = await db
        .select({ id: projects.id, lastDigestSentAt: projects.lastDigestSentAt })
        .from(projects)
        .where(eq(projects.digestEnabled, true))
        .limit(20);

      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const p of digestProjects) {
        const lastSentMs = p.lastDigestSentAt ? new Date(p.lastDigestSentAt).getTime() : 0;
        if (lastSentMs < sevenDaysAgoMs) {
          const res = await sendProjectDigest(p.id).catch(() => ({ sent: false }));
          if (res.sent) digestsSent++;
        }
      }
    } catch {
      // Non-fatal digest loop guard
    }

    const completedAt = new Date().toISOString();

    return NextResponse.json({
      success: true,
      startedAt,
      completedAt,
      cursor: { offset, limit },
      projectsSynced: results.length,
      snapshotSummary,
      uptimeSummary,
      escalationSummary,
      syntheticsSummary,
      maintenance: {
        prunedRateLimits,
        prunedPendingUploads,
      },
      digestsSent,
      details: results,
    });
  } catch (err: any) {
    console.error("Cron sync error:", err);
    return apiError(err, "Internal Server Error during metrics sync", 500);
  }
}
