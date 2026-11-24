import { NextRequest, NextResponse } from "next/server";
import { syncAllProjects } from "@/lib/sync/sync-metrics";

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
    const completedAt = new Date().toISOString();

    return NextResponse.json({
      success: true,
      startedAt,
      completedAt,
      projectsSynced: results.length,
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
