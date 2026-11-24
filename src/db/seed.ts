import { db } from "./index";
import { initDb } from "./setup";
import { users, projects, dashboardWidgets, dailyMetrics, errorEvents } from "./schema";

export async function seedDemoData() {
  await initDb();

  const demoUserId = "usr_ritualdev_demo";
  const demoProjectId = "prj_ritual_core";

  // Insert or update demo user
  await db.insert(users).values({
    id: demoUserId,
    githubUsername: "ritualdev-lab",
    name: "RitualDev Lab",
    email: "team@ritualdev.in",
    avatarUrl: "https://avatars.githubusercontent.com/u/105820465?v=4",
    storageTier: "free",
    customDomain: "stats.ritualdev.in",
    customDomainVerified: true,
  }).onConflictDoNothing();

  // Insert or update demo project
  await db.insert(projects).values({
    id: demoProjectId,
    userId: demoUserId,
    name: "Ritual Core CLI",
    slug: "ritual-core",
    description: "Unified developer toolkit & telemetry system for modern workflows.",
    githubRepo: "ritualdev-lab/ritual-core",
    npmPackage: "ritual-core",
    pypiPackage: "ritual-core",
    vscodeExtension: "ritualdev.ritual-vscode",
    telemetryApiKey: "dp_live_8f93e1b74a9c82",
    isPublic: true,
    theme: "dark",
  }).onConflictDoNothing();

  // Insert default widgets
  const defaultWidgets = [
    {
      id: "wgt_gh_stats",
      projectId: demoProjectId,
      widgetType: "github_stats",
      title: "GitHub Repository Activity",
      positionX: 0,
      positionY: 0,
      width: 2,
      height: 1,
      isVisible: true,
      configJson: JSON.stringify({ repo: "ritualdev-lab/ritual-core" }),
    },
    {
      id: "wgt_npm_downloads",
      projectId: demoProjectId,
      widgetType: "npm_downloads",
      title: "npm Package Downloads",
      positionX: 2,
      positionY: 0,
      width: 2,
      height: 2,
      isVisible: true,
      configJson: JSON.stringify({ package: "ritual-core" }),
    },
    {
      id: "wgt_pypi_downloads",
      projectId: demoProjectId,
      widgetType: "pypi_downloads",
      title: "PyPI Package Trends",
      positionX: 0,
      positionY: 1,
      width: 2,
      height: 2,
      isVisible: true,
      configJson: JSON.stringify({ package: "ritual-core" }),
    },
    {
      id: "wgt_error_stream",
      projectId: demoProjectId,
      widgetType: "error_stream",
      title: "Runtime Telemetry & Crashes",
      positionX: 2,
      positionY: 2,
      width: 4,
      height: 2,
      isVisible: true,
      configJson: JSON.stringify({ live: true }),
    },
  ];

  for (const w of defaultWidgets) {
    await db.insert(dashboardWidgets).values(w).onConflictDoNothing();
  }

  // Generate 14 days of realistic daily metrics for charts
  const now = new Date();
  for (let i = 14; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    // npm daily downloads (between 120 and 450)
    const npmVal = Math.floor(180 + Math.sin(i * 0.8) * 90 + Math.random() * 80);
    await db.insert(dailyMetrics).values({
      id: `met_npm_${dateStr}`,
      projectId: demoProjectId,
      source: "npm",
      metricType: "downloads",
      date: dateStr,
      value: npmVal,
    }).onConflictDoNothing();

    // PyPI daily downloads (between 90 and 380)
    const pypiVal = Math.floor(140 + Math.cos(i * 0.7) * 70 + Math.random() * 60);
    await db.insert(dailyMetrics).values({
      id: `met_pypi_${dateStr}`,
      projectId: demoProjectId,
      source: "pypi",
      metricType: "downloads",
      date: dateStr,
      value: pypiVal,
    }).onConflictDoNothing();
  }

  // Insert sample crash reports
  const sampleErrors = [
    {
      id: "err_01",
      projectId: demoProjectId,
      errorName: "TypeError: Cannot read properties of undefined (reading 'token')",
      message: "Authentication header missing in CLI sync handshake",
      stackTrace: `TypeError: Cannot read properties of undefined (reading 'token')
    at Authenticator.validate (file:///cli/auth.js:42:15)
    at Command.execute (file:///cli/commands/sync.js:18:22)
    at runCLI (file:///cli/bin.js:88:9)`,
      runtime: "node",
      version: "v1.2.4",
      os: "Linux (Ubuntu 24.04)",
      environment: "production",
      status: "unresolved" as const,
    },
    {
      id: "err_02",
      projectId: demoProjectId,
      errorName: "FileNotFoundError: [Errno 2] No such file or directory: '.ritualrc'",
      message: "Config file not found on first install launch",
      stackTrace: `Traceback (most recent call last):
  File "ritual_core/cli.py", line 112, in load_config
    with open(config_path, "r") as f:
FileNotFoundError: [Errno 2] No such file or directory: '.ritualrc'`,
      runtime: "python",
      version: "v1.2.3",
      os: "Darwin (macOS 15.1)",
      environment: "production",
      status: "resolved" as const,
    },
    {
      id: "err_03",
      projectId: demoProjectId,
      errorName: "NetworkTimeoutError: ETIMEDOUT 104.21.55.2:443",
      message: "Telemetry beacon dropped under high latency connection",
      stackTrace: `NetworkTimeoutError: connection timed out after 5000ms
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1607:16)`,
      runtime: "node",
      version: "v1.2.4",
      os: "Windows 11 (x64)",
      environment: "production",
      status: "unresolved" as const,
    },
  ];

  for (const err of sampleErrors) {
    await db.insert(errorEvents).values(err).onConflictDoNothing();
  }

  console.log("Demo seed data created successfully for ritualdev-lab!");
}
