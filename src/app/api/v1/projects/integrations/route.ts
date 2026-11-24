import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      githubRepo,
      npmPackage,
      pypiPackage,
      rustCrate,
      vscodeExtension,
      mcpServerName,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    // Clean strings: trim and convert empty to null
    const cleanStr = (val?: string | null) => {
      if (!val) return null;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    await db
      .update(projects)
      .set({
        githubRepo: cleanStr(githubRepo),
        npmPackage: cleanStr(npmPackage),
        pypiPackage: cleanStr(pypiPackage),
        rustCrate: cleanStr(rustCrate),
        vscodeExtension: cleanStr(vscodeExtension),
        mcpServerName: cleanStr(mcpServerName),
      })
      .where(eq(projects.id, projectId));

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
