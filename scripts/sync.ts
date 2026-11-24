import { syncAllProjects } from "../src/lib/sync/sync-metrics";

async function main() {
  console.log("⚡ [DevPulse] Starting scheduled metrics sync...");
  const startTime = Date.now();
  const results = await syncAllProjects();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`✅ [DevPulse] Synced ${results.length} projects in ${elapsed}s:`);
  for (const r of results) {
    console.log(`   - ${r.projectName}: [${r.syncedSources.join(", ")}]`);
    if (r.errors.length > 0) {
      console.warn(`     Warnings: ${r.errors.join("; ")}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [DevPulse] Sync failed:", err);
  process.exit(1);
});
