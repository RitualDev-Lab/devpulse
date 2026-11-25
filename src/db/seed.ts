import { users, projects } from "./schema";

export async function seedDemoData() {
  if (process.env.NODE_ENV !== "development" && process.env.ALLOW_DEV_SEED !== "1") {
    throw new Error(
      "seedDemoData() is restricted to development (NODE_ENV=development or ALLOW_DEV_SEED=1)."
    );
  }

  // Load the database only after the guard, so the guard holds even without a configured DB.
  const { db } = await import("./index");
  const { initDb } = await import("./setup");
  await initDb();

  const demoUserId = "usr_ritualdev_demo";
  const demoProjectId = "prj_ritual_core";

  // Insert or update default user
  await db.insert(users).values({
    id: demoUserId,
    githubUsername: "ritualdev-lab",
    name: "RitualDev Lab",
    email: "demo@example.com",
    avatarUrl: "https://avatars.githubusercontent.com/u/105820465?v=4",
    storageTier: "free",
    customDomain: "stats.example.com",
    customDomainVerified: true,
  }).onConflictDoNothing();

  // Insert or update default project with clean real state
  await db.insert(projects).values({
    id: demoProjectId,
    userId: demoUserId,
    name: "RitualDev Pulse",
    slug: "devpulse",
    description: "Unified developer toolkit & telemetry system for modern workflows.",
    githubRepo: "ritualdev-lab/devpulse",
    npmPackage: "@ritualdev/pulse",
    pypiPackage: null,
    rustCrate: null,
    vscodeExtension: null,
    mcpServerName: null,
    telemetryApiKey: "dp_live_8f93e1b74a9c82",
    isPublic: true,
    theme: "dark",
  }).onConflictDoNothing();

  console.log("Initialized clean project workspace.");
}
