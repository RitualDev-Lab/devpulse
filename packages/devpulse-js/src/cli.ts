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
    else if (
      entry.name.endsWith(".map") ||
      entry.name.endsWith(".dwarf.json") ||
      entry.name.endsWith(".sym.json")
    ) {
      acc.push(path.relative(baseDir, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

const KNOWN_MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pubspec.yaml",
  "Gemfile",
  "mix.exs",
  "jsr.json",
  "deno.json",
  "Package.swift",
  "conanfile.txt",
  "vcpkg.json",
];

async function runDoctor(flags: Record<string, string>, endpoint: string) {
  const rootDir = path.resolve(flags.dir || ".");
  console.log(`\nDevPulse Doctor — auditing workspace at ${rootDir}\n`);

  const detected = KNOWN_MANIFESTS.filter((m) => fs.existsSync(path.join(rootDir, m)));
  console.log(
    detected.length > 0
      ? `[PASS] Manifests detected: ${detected.join(", ")}`
      : `[WARN] No standard root manifest detected in ${rootDir}`
  );

  let hasSdkDep = false;
  if (fs.existsSync(path.join(rootDir, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      hasSdkDep = Boolean(deps["@ritualdev/devpulse"]);
    } catch {
      // ignore invalid package.json
    }
  }
  console.log(
    hasSdkDep
      ? "[PASS] @ritualdev/devpulse found in package.json dependencies"
      : "[INFO] @ritualdev/devpulse not listed in package.json (install with npm i @ritualdev/devpulse)"
  );

  const apiKey = flags.key || process.env.DEVPULSE_API_KEY || "";
  console.log(
    apiKey
      ? `[PASS] Telemetry API key configured (${apiKey.slice(0, 10)}...)`
      : "[WARN] DEVPULSE_API_KEY is not set in environment or --key"
  );

  const distDir = path.join(rootDir, flags.dist || "dist");
  const maps = fs.existsSync(distDir) ? collectMapFiles(distDir, distDir) : [];
  console.log(
    maps.length > 0
      ? `[PASS] Found ${maps.length} symbol/source map file(s) in ${distDir}`
      : `[INFO] No source maps found in ${distDir}`
  );

  if (flags.ping === "true" && apiKey) {
    const res = await fetch(`${endpoint}/api/v1/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        errorName: "DevPulseDoctorCheck",
        message: "CLI doctor telemetry verification ping",
        runtime: "devpulse-cli-doctor",
        version: flags.release || "1.0.0",
      }),
    });
    console.log(
      res.ok
        ? `[PASS] Test telemetry event accepted by ${endpoint}/api/v1/event`
        : `[FAIL] Test event rejected (${res.status}): ${await res.text()}`
    );
  }

  if (flags.heartbeat) {
    const hbRes = await fetch(`${endpoint}/api/v1/ping/${encodeURIComponent(flags.heartbeat)}?state=finish`);
    console.log(
      hbRes.ok
        ? `[PASS] Cron heartbeat ping delivered for key ${flags.heartbeat}`
        : `[FAIL] Heartbeat ping failed (${hbRes.status})`
    );
  }
  console.log("");
}

async function runLogsTail(flags: Record<string, string>, endpoint: string) {
  const apiKey = flags.key || process.env.DEVPULSE_API_KEY;
  if (!apiKey) {
    console.error("Error: --key or DEVPULSE_API_KEY is required for logs --tail.");
    process.exit(1);
  }

  let sinceMs = 0;
  const seen = new Set<string>();
  console.log(`Tailing structured logs from ${endpoint} (Ctrl+C to stop)...`);

  const poll = async () => {
    const qs = new URLSearchParams({
      ...(sinceMs > 0 ? { sinceMs: String(sinceMs) } : {}),
      ...(flags.level ? { level: flags.level } : {}),
      ...(flags.service ? { service: flags.service } : {}),
    });
    const res = await fetch(`${endpoint}/api/v1/logs?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.error(`Logs fetch error (${res.status})`);
      return;
    }
    const data = (await res.json()) as {
      logs?: Array<{ id: string; timestampIso: string; level: string; serviceName: string; message: string; timestampMs: number }>;
    };
    const items = (data.logs || []).reverse();
    for (const row of items) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (row.timestampMs > sinceMs) sinceMs = row.timestampMs;
      console.log(`[${row.timestampIso}] [${row.level.toUpperCase()}] [${row.serviceName}] ${row.message}`);
    }
  };

  await poll();
  if (flags.tail === "true" || flags.watch === "true") {
    setInterval(() => {
      void poll();
    }, 2000);
  }
}

async function runSync(flags: Record<string, string>, endpoint: string) {
  const apiKey = flags.key || process.env.DEVPULSE_API_KEY;
  if (!apiKey) {
    console.error("Error: --key or DEVPULSE_API_KEY is required for sync.");
    process.exit(1);
  }
  const res = await fetch(`${endpoint}/api/v1/projects/snapshots?refresh=1`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`Sync failed (${res.status}):`, await res.text());
    process.exit(1);
  }
  const data = (await res.json()) as { snapshotUpdatedAt?: string; extraPackages?: unknown[] };
  console.log(`Snapshots refreshed cleanly (${data.snapshotUpdatedAt || "now"}) — ${data.extraPackages?.length || 0} extra connectors synced.`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const flags = parseArgs(args.slice(1));
  const endpoint = (flags.endpoint || "https://devpulse.ritualdev.in").replace(/\/$/, "");

  if (cmd === "doctor") {
    await runDoctor(flags, endpoint);
    return;
  }
  if (cmd === "logs") {
    await runLogsTail(flags, endpoint);
    return;
  }
  if (cmd === "sync") {
    await runSync(flags, endpoint);
    return;
  }

  if (cmd !== "upload-sourcemaps") {
    console.log(
      [
        "DevPulse CLI Companion:",
        "  devpulse doctor [--key <apiKey>] [--ping] [--heartbeat <monitorKey>]",
        "  devpulse logs [--tail] [--key <apiKey>] [--level error] [--service api]",
        "  devpulse sync [--key <apiKey>]",
        "  devpulse upload-sourcemaps --key <apiKey> --release <version> --dir <distDir>",
      ].join("\n")
    );
    process.exit(cmd ? 1 : 0);
  }

  const apiKey = flags.key || process.env.DEVPULSE_API_KEY;
  const release = flags.release;
  const targetDir = path.resolve(flags.dir || "./dist");

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
