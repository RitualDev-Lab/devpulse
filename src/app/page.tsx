import { db } from "@/db";
import { projects, errorEvents, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { initDb } from "@/db/setup";
import { seedDemoData } from "@/db/seed";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { DashboardClientView } from "@/components/dashboard/DashboardClientView";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await initDb();

  // Find first active project or seed demo project
  let [project] = await db.select().from(projects).limit(1);

  if (!project) {
    await seedDemoData();
    const result = await db.select().from(projects).limit(1);
    project = result[0];
  }

  // Fetch user info for custom domain & storage tier
  const [user] = await db
    .select({
      storageTier: users.storageTier,
      customDomain: users.customDomain,
      customDomainVerified: users.customDomainVerified,
    })
    .from(users)
    .where(eq(users.id, project.userId))
    .limit(1);

  // Fetch live registry metrics in parallel
  const [githubStats, npmStats, pypiStats, rawErrors] = await Promise.all([
    project.githubRepo ? fetchGitHubRepoStats(project.githubRepo) : Promise.resolve(null),
    project.npmPackage ? fetchNpmStats(project.npmPackage) : Promise.resolve(null),
    project.pypiPackage ? fetchPyPiStats(project.pypiPackage) : Promise.resolve(null),
    db
      .select()
      .from(errorEvents)
      .where(eq(errorEvents.projectId, project.id))
      .orderBy(desc(errorEvents.createdAt))
      .limit(20),
  ]);

  const errors = rawErrors.map((err) => ({
    id: err.id,
    errorName: err.errorName,
    message: err.message,
    stackTrace: err.stackTrace,
    runtime: err.runtime,
    version: err.version,
    os: err.os,
    environment: err.environment,
    status: err.status,
    reporterEmail: err.reporterEmail,
    createdAt: err.createdAt,
  }));

  const initialData = {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      githubRepo: project.githubRepo,
      npmPackage: project.npmPackage,
      pypiPackage: project.pypiPackage,
      telemetryApiKey: project.telemetryApiKey,
    },
    githubStats,
    npmStats,
    pypiStats,
    errors,
  };

  return (
    <DashboardClientView
      initialData={initialData}
      customDomain={user?.customDomainVerified ? user.customDomain : null}
      storageTier={user?.storageTier || "free"}
    />
  );
}
