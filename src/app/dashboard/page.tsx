import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { initDb } from "@/db/setup";
import { getCurrentUser } from "@/lib/auth";
import { loadProjectDashboardData } from "@/lib/dashboard/load-project-dashboard";
import { DashboardClientView } from "@/components/dashboard/DashboardClientView";
import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import type { ProjectSummary } from "@/components/dashboard/ProjectWorkspaceSwitcher";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams?: Promise<{
    project?: string;
    demo?: string;
  }>;
}

export default async function DashboardPage(props: DashboardPageProps) {
  try {
    await initDb();
  } catch (e) {
    console.warn("initDb warning:", e);
  }

  const params = (await props.searchParams) || {};
  const requestedProject = params.project;
  const isDemoRequested = params.demo === "1";

  // 1. Authenticate user session bound to real GitHub identity
  const user = await getCurrentUser();

  // 2. Unauthenticated Gate: If not logged in and not viewing demo, show Auth Gate
  if (!user && !isDemoRequested) {
    return <DashboardAuthGate />;
  }

  let activeProject: any = null;
  let userProjects: any[] = [];
  let isDemoView = false;

  if (user) {
    // 3. Strict Tenant Scoping: Query projects belonging ONLY to this user
    try {
      userProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, user.id))
        .orderBy(desc(projects.createdAt));
    } catch (dbErr) {
      console.error("Database query error fetching user projects:", dbErr);
      userProjects = [];
    }

    // 4. Onboarding Gate: If logged-in user has 0 projects, render 1-click import onboarding
    if (userProjects.length === 0) {
      return <DashboardOnboardingView user={user} />;
    }

    // 5. Select active project from maintainer's project list
    if (requestedProject) {
      activeProject =
        userProjects.find(
          (p) => p.slug === requestedProject || p.id === requestedProject
        ) || null;
    }

    if (!activeProject) {
      activeProject = userProjects[0];
    }
  } else if (isDemoRequested) {
    // Read-only public demo preview
    isDemoView = true;
    try {
      const demoRows = await db
        .select()
        .from(projects)
        .where(eq(projects.id, "prj_ritual_core"))
        .limit(1);
      activeProject = demoRows[0] || null;
    } catch {
      activeProject = null;
    }

    if (!activeProject) {
      return <DashboardAuthGate />;
    }
  }

  // 6. Load live multi-registry telemetry, analytics, layout & errors via shared helper
  const initialData = await loadProjectDashboardData(activeProject, {
    includePrivate: !isDemoView,
  });

  const projectSummaries: ProjectSummary[] = userProjects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    githubRepo: p.githubRepo,
    npmPackage: p.npmPackage,
    pypiPackage: p.pypiPackage,
    rustCrate: p.rustCrate,
    goModule: p.goModule,
    dockerImage: p.dockerImage,
    telemetryApiKey: p.telemetryApiKey,
  }));

  return (
    <DashboardClientView
      initialData={initialData}
      projects={projectSummaries}
      subdomain={user?.subdomain || null}
      customDomain={user?.customDomainVerified ? user.customDomain : null}
      storageTier={user?.storageTier || "free"}
      extraCustomDomains={user?.extraCustomDomains ?? 0}
      isDemo={isDemoView}
    />
  );
}
