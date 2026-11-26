import { NextRequest, NextResponse } from "next/server";
import { processHeartbeatPing } from "@/lib/monitors/heartbeat";

export const dynamic = "force-dynamic";

async function handlePing(
  req: NextRequest,
  context: { params: Promise<{ monitorKey: string }> }
) {
  try {
    const { monitorKey } = await context.params;
    const cleanKey = (monitorKey || "").trim();
    if (!cleanKey) {
      return NextResponse.json({ error: "Missing monitorKey" }, { status: 400 });
    }

    let stateParam = (req.nextUrl.searchParams.get("state") || "finish").toLowerCase();
    let durationMs: number | null = null;
    let message: string | null = req.nextUrl.searchParams.get("message");

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body.state === "string") stateParam = body.state.toLowerCase();
      if (typeof body.durationMs === "number") durationMs = body.durationMs;
      if (typeof body.message === "string") message = body.message;
    }

    const normalizedState =
      stateParam === "start" || stateParam === "fail" ? stateParam : "finish";

    const result = await processHeartbeatPing({
      monitorKey: cleanKey,
      state: normalizedState,
      durationMs,
      message,
    });

    if (!result) {
      return NextResponse.json({ error: "Heartbeat monitor not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      monitorKey: cleanKey,
      state: result.state,
      lastDurationMs: result.lastDurationMs,
      nextDueAt: result.nextDueAt,
    });
  } catch (err) {
    console.error("Heartbeat ping error:", err);
    return NextResponse.json({ error: "Heartbeat ping failed" }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ monitorKey: string }> }
) {
  return handlePing(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ monitorKey: string }> }
) {
  return handlePing(req, context);
}
