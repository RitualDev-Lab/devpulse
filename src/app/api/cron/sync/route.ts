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
    const secretParam = req.nextUrl.searchParams.get("secret");
    const cronSecret = process.env.CRON_SECRET;

    // Optional verification if CRON_SECRET is configured
    if (cronSecret) {
      const token = authHeader?.replace(/^Bearer\s+/i, "") || secretParam;
      if (token !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized cron trigger" }, { status: 401 });
      }
    }

    const startedAt = new Date().toISOString();
    const results = await syncAllProjects();
    const snapshotSummary = await refreshAllProjectSnapshots().catch(() => ({
      refreshed: 0,
      projectIds: [],
    }));
    const uptimeSummary = await runDueUptimeChecks().catch((e) => ({
      checked: 0,
      error: e instanceof Error ? e.message : "Uptime check failed",
    }));

    const escalationSummary = await processPendingEscalations().catch(() => ({
      escalated: 0,
    }));

    const syntheticsSummary = await runDueSyntheticTests().catch(() => ({
      totalActive: 0,
      executed: 0,
    }));

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
      projectsSynced: results.length,
      snapshotSummary,
      uptimeSummary,
      escalationSummary,
      syntheticsSummary,
      digestsSent,
      details: results,
    });
  } catch (err: any) {
    console.error("Cron sync error:", err);
    return NextResponse.json(
      { error: "Internal Server Error during metrics sync", details: err?.message },
      { status: 500 }
    );
  }
}
