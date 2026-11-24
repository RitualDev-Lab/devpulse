import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
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

    // Update project revenue keys in Turso database
    await db
      .update(projects)
      .set({
        stripeApiKey: stripeApiKey ? stripeApiKey.trim() : null,
        dodoPaymentsApiKey: dodoPaymentsApiKey ? dodoPaymentsApiKey.trim() : null,
        dodoPaymentsEnvironment: dodoPaymentsEnvironment || "live",
        githubSponsorsUsername: githubSponsorsUsername ? githubSponsorsUsername.trim() : null,
      })
      .where(eq(projects.id, projectId));

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
