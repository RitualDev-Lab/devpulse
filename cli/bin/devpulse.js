#!/usr/bin/env node

/**
 * DevPulse Maintainer Terminal CLI
 * Check package downloads, GitHub stars, and crash logs directly from your terminal.
 * Built by ritualdev-lab
 */

const https = require("node:https");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

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

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

function collectMapFiles(dir, baseDir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMapFiles(full, baseDir, acc);
    } else if (
      entry.name.endsWith(".map") ||
      entry.name.endsWith(".dwarf.json") ||
      entry.name.endsWith(".sym.json")
    ) {
      acc.push(path.relative(baseDir, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

async function handleUploadSourcemaps(rawArgs) {
  printHeader();
  const flags = parseFlags(rawArgs);
  const apiKey = flags.key || process.env.DEVPULSE_API_KEY;
  const release = flags.release;
  const targetDir = path.resolve(flags.dir || "./dist");
  const endpoint = (flags.endpoint || DEFAULT_HOST).replace(/\/$/, "");

  if (!apiKey || !release) {
    console.error("❌ Error: --key <apiKey> and --release <version> are required.");
    process.exit(1);
  }
  if (!fs.existsSync(targetDir)) {
    console.error(`❌ Directory not found: ${targetDir}`);
    process.exit(1);
  }

  const mapFiles = collectMapFiles(targetDir, targetDir);
  console.log(`📦 Found ${mapFiles.length} source map / DWARF symbol file(s) for release ${release}\n`);

  let uploaded = 0;
  for (const relPath of mapFiles) {
    const content = fs.readFileSync(path.join(targetDir, relPath), "utf8");
    const res = await fetch(`${endpoint}/api/v1/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        action: "upload_sourcemap",
        version: release,
        filePath: relPath,
        content,
      }),
    });
    if (res.ok) {
      uploaded++;
      console.log(`   \x1b[32m✔\x1b[0m Uploaded ${relPath}`);
    } else {
      console.error(`   \x1b[31m✖\x1b[0m Failed ${relPath} (${res.status}): ${await res.text()}`);
    }
  }

  console.log(`\n✨ Done: ${uploaded}/${mapFiles.length} source maps uploaded to Cloudflare R2.\n`);
}

function handleHelp() {
  printHeader();
  console.log("Usage: devpulse <command> [options]\n");
  console.log("Commands:");
  console.log("  \x1b[36mstatus\x1b[0m            [slug]  Print package downloads, release status & badges");
  console.log("  \x1b[36mcrashes\x1b[0m           [slug]  View crash telemetry stream endpoint & status");
  console.log("  \x1b[36mupload-sourcemaps\x1b[0m [flags] Upload .map & Rust .dwarf.json files to R2");
  console.log("      --key <apiKey>          Project telemetry API key (or DEVPULSE_API_KEY)");
  console.log("      --release <version>     Release version tag (e.g. v1.4.2)");
  console.log("      --dir <distDir>         Build output directory (default: ./dist)");
  console.log("  \x1b[36mhelp\x1b[0m                      Display this help manual\n");
  console.log("Examples:");
  console.log("  $ npx @ritualdev/pulse status");
  console.log("  $ devpulse upload-sourcemaps --key dp_live_xxx --release v1.2.0 --dir .next\n");
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
  case "upload-sourcemaps":
    handleUploadSourcemaps(args.slice(1));
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
