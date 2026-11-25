import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ALLOWED_STATUSES = new Set(["unresolved", "resolved", "ignored"]);

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const status = String(body?.status || "");

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid error status" }, { status: 400 });
    }

    // Look up event + verify user owns parent project
    const [existing] = await db
      .select({
        eventId: errorEvents.id,
        projectId: errorEvents.projectId,
        ownerId: projects.userId,
      })
      .from(errorEvents)
      .innerJoin(projects, eq(errorEvents.projectId, projects.id))
      .where(and(eq(errorEvents.id, id), eq(projects.userId, user.id)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Error event not found" }, { status: 404 });
    }

    await db
      .update(errorEvents)
      .set({ status: status as "unresolved" | "resolved" | "ignored" })
      .where(eq(errorEvents.id, id));

    return NextResponse.json({ success: true, id, status });
  } catch (err: unknown) {
    console.error("Failed to update error status:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update status" },
      { status: 500 }
    );
  }
}
