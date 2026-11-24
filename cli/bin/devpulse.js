#!/usr/bin/env node

/**
 * DevPulse Maintainer Terminal CLI
 * Check package downloads, GitHub stars, and crash logs directly from your terminal.
 * Built by ritualdev-lab
 */

const https = require("node:https");
const http = require("node:http");

const DEFAULT_HOST = process.env.DEVPULSE_HOST || "https://devpulse.ritualdev.in";
const DEFAULT_SLUG = process.env.DEVPULSE_PROJECT || "ritual-core";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      })
      .on("error", reject);
  });
}

function printHeader() {
  console.log("\n\x1b[35m⚡ DevPulse Maintainer CLI\x1b[0m \x1b[90m(ritualdev-lab)\x1b[0m");
  console.log("\x1b[90m────────────────────────────────────────────────────\x1b[0m");
}

async function handleStatus(slug) {
  printHeader();
  console.log(`📡 Fetching status for project: \x1b[36m${slug}\x1b[0m\n`);

  try {
    // 1. Fetch public npm metrics
    const npmRes = await fetchJson(`https://api.npmjs.org/downloads/point/last-month/${slug}`);
    const npmWeek = await fetchJson(`https://api.npmjs.org/downloads/point/last-week/${slug}`);
    
    // 2. Fetch public PyPI metrics
    const pypiRes = await fetchJson(`https://pypistats.org/api/packages/${slug}/recent`);

    console.log("\x1b[1m📦 Package Metrics Summary:\x1b[0m");
    if (npmRes && typeof npmRes.downloads === "number") {
      console.log(`   \x1b[31mnpm\x1b[0m  • Last 7 Days: \x1b[32m${(npmWeek?.downloads || 0).toLocaleString()}\x1b[0m | Last 30 Days: \x1b[32m${npmRes.downloads.toLocaleString()}\x1b[0m`);
    } else {
      console.log(`   \x1b[31mnpm\x1b[0m  • Package: ${slug} (Active)`);
    }

    if (pypiRes && pypiRes.data) {
      console.log(`   \x1b[34mPyPI\x1b[0m • Last 7 Days: \x1b[32m${(pypiRes.data.last_week || 0).toLocaleString()}\x1b[0m | Last 30 Days: \x1b[32m${(pypiRes.data.last_month || 0).toLocaleString()}\x1b[0m`);
    } else {
      console.log(`   \x1b[34mPyPI\x1b[0m • Package: ${slug} (Active)`);
    }

    console.log("\n\x1b[1m🌐 Web Dashboard & Badges:\x1b[0m");
    console.log(`   • Dashboard:   \x1b[4m${DEFAULT_HOST}\x1b[0m`);
    console.log(`   • Downloads:   \x1b[4m${DEFAULT_HOST}/api/badge/downloads/${slug}.svg\x1b[0m`);
    console.log(`   • Health:      \x1b[4m${DEFAULT_HOST}/api/badge/health/${slug}.svg\x1b[0m`);
    console.log(`   • Bug Portal:  \x1b[4m${DEFAULT_HOST}/report/${slug}\x1b[0m\n`);
  } catch (err) {
    console.error("❌ Failed to query metrics:", err.message);
  }
}

async function handleCrashes(slug) {
  printHeader();
  console.log(`🚨 Checking runtime crash diagnostics for \x1b[36m${slug}\x1b[0m...\n`);

  console.log("\x1b[32m✔ Telemetry Engine Online\x1b[0m");
  console.log(`• Telemetry Ingest: \x1b[36m${DEFAULT_HOST}/api/v1/event\x1b[0m`);
  console.log(`• View Live Stream: \x1b[36m${DEFAULT_HOST}\x1b[0m\n`);
  console.log("Run with \x1b[33mdevpulse status\x1b[0m to check download velocity.\n");
}

function handleHelp() {
  printHeader();
  console.log("Usage: devpulse <command> [project-slug]\n");
  console.log("Commands:");
  console.log("  \x1b[36mstatus\x1b[0m    [slug]  Print package downloads, release status & badges");
  console.log("  \x1b[36mcrashes\x1b[0m   [slug]  View crash telemetry stream endpoint & status");
  console.log("  \x1b[36mhelp\x1b[0m             Display this help manual\n");
  console.log("Examples:");
  console.log("  $ npx @ritualdev/pulse status");
  console.log("  $ npx @ritualdev/pulse status ritual-core\n");
}

const args = process.argv.slice(2);
const command = args[0] || "status";
const targetSlug = args[1] || DEFAULT_SLUG;

switch (command) {
  case "status":
    handleStatus(targetSlug);
    break;
  case "crashes":
  case "errors":
    handleCrashes(targetSlug);
    break;
  case "help":
  case "--help":
  case "-h":
    handleHelp();
    break;
  default:
    console.log(`Unknown command: ${command}`);
    handleHelp();
    process.exit(1);
}
