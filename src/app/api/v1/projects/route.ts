import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        description: projects.description,
        githubRepo: projects.githubRepo,
        npmPackage: projects.npmPackage,
        pypiPackage: projects.pypiPackage,
        rustCrate: projects.rustCrate,
        goModule: projects.goModule,
        telemetryApiKey: projects.telemetryApiKey,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.userId, user.id))
      .orderBy(desc(projects.createdAt));

    return NextResponse.json({ projects: userProjects });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, githubRepo, npmPackage, pypiPackage, rustCrate, goModule, vscodeExtension, mcpServerName } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";

    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const slugCheck = await db
        .select()
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1);
      if (slugCheck.length === 0) break;
      slug = `${baseSlug}-${counter++}`;
    }

    const projectId = `prj_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const telemetryApiKey = `dp_live_${crypto.randomBytes(12).toString("hex")}`;

    await db.insert(projects).values({
      id: projectId,
      userId: user.id,
      name,
      slug,
      githubRepo: githubRepo || null,
      npmPackage: npmPackage || null,
      pypiPackage: pypiPackage || null,
      rustCrate: rustCrate || null,
      goModule: goModule || null,
      vscodeExtension: vscodeExtension || null,
      mcpServerName: mcpServerName || null,
      telemetryApiKey,
      isPublic: true,
      theme: "dark",
    });

    const created = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    return NextResponse.json({ success: true, project: created[0] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
