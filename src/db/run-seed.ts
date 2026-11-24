import { seedDemoData } from "./seed";

async function main() {
  console.log("Seeding DevPulse database...");
  await seedDemoData();
  console.log("Done!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
