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
      githubRepo,
      npmPackage,
      pypiPackage,
      rustCrate,
      goModule,
      dockerImage,
      vscodeExtension,
      mcpServerName,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const cleanStr = (val?: string | null) => {
      if (!val) return null;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

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
        githubRepo: cleanStr(githubRepo),
        npmPackage: cleanStr(npmPackage),
        pypiPackage: cleanStr(pypiPackage),
        rustCrate: cleanStr(rustCrate),
        goModule: cleanStr(goModule),
        dockerImage: cleanStr(dockerImage),
        vscodeExtension: cleanStr(vscodeExtension),
        mcpServerName: cleanStr(mcpServerName),
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));

    return NextResponse.json({
      success: true,
      message: "Package integrations updated successfully.",
    });
  } catch (err: any) {
    console.error("Error updating project integrations:", err);
    return NextResponse.json(
      { error: err.message || "Failed to update project integrations" },
      { status: 500 }
    );
  }
}
