#!/usr/bin/env node
import fs from "fs";
import path from "path";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
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

function collectMapFiles(dir: string, baseDir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMapFiles(full, baseDir, acc);
    else if (entry.name.endsWith(".map")) {
      acc.push(path.relative(baseDir, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const flags = parseArgs(args.slice(1));

  if (cmd !== "upload-sourcemaps") {
    console.log("Usage: devpulse-sdk upload-sourcemaps --key <apiKey> --release <version> --dir <distDir> [--endpoint https://devpulse.ritualdev.in]");
    process.exit(cmd ? 1 : 0);
  }

  const apiKey = flags.key || process.env.DEVPULSE_API_KEY;
  const release = flags.release;
  const targetDir = path.resolve(flags.dir || "./dist");
  const endpoint = (flags.endpoint || "https://devpulse.ritualdev.in").replace(/\/$/, "");

  if (!apiKey || !release) {
    console.error("Error: --key and --release are required.");
    process.exit(1);
  }
  if (!fs.existsSync(targetDir)) {
    console.error("Directory not found:", targetDir);
    process.exit(1);
  }

  const mapFiles = collectMapFiles(targetDir, targetDir);
  console.log(`Found ${mapFiles.length} source map(s) in ${targetDir} for release ${release}...`);

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
      console.log(`Uploaded ${relPath}`);
    } else {
      console.error(`Failed ${relPath} (${res.status}):`, await res.text());
    }
  }

  console.log(`Done: ${uploaded}/${mapFiles.length} source maps uploaded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
