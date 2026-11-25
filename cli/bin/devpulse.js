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

async function handleCrashes(rawArgs) {
  const positional = rawArgs.filter((a, i) => !a.startsWith("--") && !(i > 0 && rawArgs[i - 1].startsWith("--")));
  const flags = parseFlags(rawArgs);
  const slug = flags.project || positional[0] || DEFAULT_SLUG;
  const apiKey = flags.key || process.env.DEVPULSE_API_KEY || process.env.DEVPULSE_TOKEN;
  const host = (flags.endpoint || DEFAULT_HOST).replace(/\/$/, "");
  const limit = Math.min(100, Math.max(1, Number(flags.limit || 20)));
  const status = flags.status || "all";
  const tail = flags.tail === "true" || flags.tail === true;
  const jsonMode = flags.json === "true" || flags.json === true;

  if (!apiKey) {
    console.error("❌ Authentication required: pass --key <telemetryApiKey> or set DEVPULSE_API_KEY.");
    process.exit(1);
  }

  if (!jsonMode) {
    printHeader();
    console.log(`🚨 Fetching crash feed for \x1b[36m${slug}\x1b[0m${tail ? " (\x1b[33m--tail live mode\x1b[0m)" : ""}...\n`);
  }

  let lastSeenCreatedAt = "";

  const pollOnce = async () => {
    const qs = new URLSearchParams({
      project: slug,
      status,
      limit: String(limit),
    });
    if (lastSeenCreatedAt) qs.set("since", lastSeenCreatedAt);

    const res = await fetch(`${host}/api/v1/event?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const events = Array.isArray(data.events) ? [...data.events].reverse() : [];

    if (events.length === 0) {
      if (!lastSeenCreatedAt && !jsonMode) {
        console.log("\x1b[32m✔ Zero matching crashes recorded.\x1b[0m\n");
      }
      return;
    }

    for (const ev of events) {
      if (jsonMode) {
        console.log(JSON.stringify(ev));
      } else {
        const badge =
          ev.status === "resolved"
            ? "\x1b[32m[RESOLVED]\x1b[0m"
            : ev.status === "ignored"
            ? "\x1b[90m[IGNORED]\x1b[0m"
            : "\x1b[31m[UNRESOLVED]\x1b[0m";
        const fp = ev.fingerprint ? ` \x1b[90m(${ev.fingerprint})\x1b[0m` : "";
        console.log(
          `${badge} \x1b[1m${ev.errorName}\x1b[0m${fp} \x1b[36m[${ev.platform || ev.runtime}]\x1b[0m ${ev.createdAt}`
        );
        console.log(`   ${ev.message}`);
      }
      if (!lastSeenCreatedAt || ev.createdAt > lastSeenCreatedAt) {
        lastSeenCreatedAt = ev.createdAt;
      }
    }
  };

  try {
    await pollOnce();
    if (tail) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, 3000));
        await pollOnce();
      }
    }
  } catch (err) {
    console.error("❌ Failed to fetch crashes:", err.message);
    process.exit(1);
  }
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

function handleDoctor(rawArgs) {
  printHeader();
  const flags = parseFlags(rawArgs);
  const endpoint = (flags.endpoint || DEFAULT_HOST).replace(/\/$/, "");
  const apiKey = flags.key || process.env.DEVPULSE_API_KEY || "";
  console.log("🩺 Running DevPulse Environment Doctor...\n");
  console.log(`   • Target Endpoint : ${endpoint}`);
  console.log(`   • Telemetry Key   : ${apiKey ? apiKey.slice(0, 12) + "..." : "❌ Missing (set DEVPULSE_API_KEY)"}`);
  console.log(`   • Node Runtime    : ${process.version}`);
  fetchJson(`${endpoint}/api/v1/feedback?projectSlug=devpulse`)
    .then((res) => {
      console.log(`   • Edge API Ping   : ${res ? "✅ Reachable (HTTP 200)" : "⚠️ Unreachable"}`);
      console.log("");
    })
    .catch(() => console.log("   • Edge API Ping   : ❌ Network error\n"));
}

function handleInit() {
  printHeader();
  console.log("🚀 Quickstart Configuration (Zero-Leak Sovereign Telemetry):\n");
  console.log("  npm install @ritualdev/devpulse");
  console.log("  # or Python: pip install devpulse-sdk");
  console.log("  # or Rust:   cargo add devpulse-rs\n");
  console.log("  # Upload TC39/Source Maps during CI:");
  console.log("  npx @ritualdev/pulse upload-sourcemaps --key $DEVPULSE_API_KEY --release $GIT_SHA --dir ./dist\n");
}

function handleHelp() {
  printHeader();
  console.log("Usage: devpulse <command> [options]\n");
  console.log("Commands:");
  console.log("  \x1b[36minit\x1b[0m                      Print SDK setup & CI quickstart");
  console.log("  \x1b[36mdoctor\x1b[0m            [flags] Verify CLI keys, runtime & edge reachability");
  console.log("  \x1b[36mstatus\x1b[0m            [slug]  Print package downloads, release status & badges");
  console.log("  \x1b[36mcrashes\x1b[0m           [slug]  Stream live crashes (--key, --project, --tail, --json)");
  console.log("  \x1b[36mupload-sourcemaps\x1b[0m [flags] Upload .map & Rust .dwarf.json files to R2");
  console.log("      --key <apiKey>          Project telemetry API key (or DEVPULSE_API_KEY)");
  console.log("      --release <version>     Release version tag (e.g. v1.4.2)");
  console.log("      --dir <distDir>         Build output directory (default: ./dist)");
  console.log("  \x1b[36mhelp\x1b[0m                      Display this help manual\n");
  console.log("Examples:");
  console.log("  $ npx @ritualdev/pulse doctor --key dp_live_xxx");
  console.log("  $ devpulse upload-sourcemaps --key dp_live_xxx --release v1.2.0 --dir .next\n");
}

const args = process.argv.slice(2);
const command = args[0] || "status";
const targetSlug = args[1] || DEFAULT_SLUG;

switch (command) {
  case "init":
    handleInit();
    break;
  case "doctor":
    handleDoctor(args.slice(1));
    break;
  case "status":
    handleStatus(targetSlug);
    break;
  case "crashes":
  case "errors":
    handleCrashes(args.slice(1));
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
