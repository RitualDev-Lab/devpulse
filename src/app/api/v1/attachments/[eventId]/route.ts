import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { fetchCrashAttachment } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { eventId } = await params;

    const [row] = await db
      .select({
        attachmentUrl: errorEvents.attachmentUrl,
        errorName: errorEvents.errorName,
        ownerId: projects.userId,
      })
      .from(errorEvents)
      .innerJoin(projects, eq(errorEvents.projectId, projects.id))
      .where(and(eq(errorEvents.id, eventId), eq(projects.userId, user.id)))
      .limit(1);

    if (!row || !row.attachmentUrl) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const fetched = await fetchCrashAttachment({
      userId: user.id,
      attachmentUrl: row.attachmentUrl,
    });

    if (!fetched.ok || !fetched.body) {
      return NextResponse.json({ error: "Unable to read R2 object" }, { status: 502 });
    }

    return new NextResponse(fetched.body, {
      status: 200,
      headers: {
        "Content-Type": fetched.contentType || "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${eventId}.log"`,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch attachment" },
      { status: 500 }
    );
  }
}
