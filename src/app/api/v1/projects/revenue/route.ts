import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      stripeApiKey,
      dodoPaymentsApiKey,
      dodoPaymentsEnvironment,
      githubSponsorsUsername,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const [ownedProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!ownedProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await db
      .update(projects)
      .set({
        stripeApiKey: stripeApiKey ? stripeApiKey.trim() : null,
        dodoPaymentsApiKey: dodoPaymentsApiKey ? dodoPaymentsApiKey.trim() : null,
        dodoPaymentsEnvironment: dodoPaymentsEnvironment || "live",
        githubSponsorsUsername: githubSponsorsUsername ? githubSponsorsUsername.trim() : null,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));

    return NextResponse.json({
      success: true,
      message: "Revenue and payment provider credentials saved successfully.",
    });
  } catch (err: any) {
    console.error("Error saving revenue settings:", err);
    return NextResponse.json(
      { error: err.message || "Failed to save revenue settings" },
      { status: 500 }
    );
  }
}
