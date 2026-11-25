"use client";

import React, { useState } from "react";
import { Code2, Copy, Check, Play, Loader2, Activity } from "lucide-react";

type LangTabId =
  | "nextjs"
  | "react"
  | "nodejs"
  | "python"
  | "rust"
  | "go"
  | "desktop"
  | "react_native"
  | "flutter"
  | "cli";

interface LanguageSdkTabsProps {
  apiKey: string;
  projectSlug: string;
  isDemo?: boolean;
  onMetricSent?: () => void;
}

const LANG_TABS: Array<{ id: LangTabId; label: string; file: string }> = [
  { id: "nextjs", label: "Next.js", file: "lib/devpulse.ts" },
  { id: "react", label: "React", file: "App.tsx" },
  { id: "nodejs", label: "Node.js", file: "telemetry.mjs" },
  { id: "python", label: "Python", file: "telemetry.py" },
  { id: "rust", label: "Rust", file: "src/telemetry.rs" },
  { id: "go", label: "Go", file: "telemetry.go" },
  { id: "desktop", label: "Tauri / Electron", file: "main.ts" },
  { id: "react_native", label: "React Native", file: "App.tsx" },
  { id: "flutter", label: "Flutter", file: "lib/devpulse.dart" },
  { id: "cli", label: "CLI Apps", file: "beacon.sh" },
];

function buildLanguageSnippet(tab: LangTabId, apiKey: string): string {
  const key = apiKey || "dp_live_your_api_key";
  switch (tab) {
    case "nextjs":
      return `// npm i @ritualdev/devpulse\nimport { DevPulse } from "@ritualdev/devpulse";\n\nexport const pulse = new DevPulse({\n  apiKey: "${key}",\n  release: process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0",\n}).init();\n\n// Track pageviews, crashes & custom metrics:\npulse.trackEvent("checkout_started", { path: "/pricing", sourceType: "web" });\npulse.trackMetric("active_jobs", 42);`;
    case "react":
      return `// npm i @ritualdev/devpulse\nimport { useEffect } from "react";\nimport { DevPulse } from "@ritualdev/devpulse";\n\nconst pulse = new DevPulse({ apiKey: "${key}", release: "1.2.0" }).init();\n\nexport function App() {\n  useEffect(() => {\n    pulse.trackEvent("pageview", { path: window.location.pathname });\n    pulse.trackMetric("active_jobs", 42);\n  }, []);\n  return null;\n}`;
    case "nodejs":
      return `// npm i @ritualdev/devpulse\nimport { DevPulse } from "@ritualdev/devpulse";\n\nconst pulse = new DevPulse({ apiKey: "${key}", runtime: "node" }).init();\n\nawait pulse.trackMetric("active_jobs", 42, { properties: { queue: "default" } });\n// Crashes & unhandled rejections are captured automatically with breadcrumbs.`;
    case "python":
      return `# pip install devpulse-sdk\nfrom devpulse_sdk import DevPulse\n\npulse = DevPulse(api_key="${key}", release="1.0.0")\npulse.track_event("worker_tick", source_type="app")\npulse.track_metric("active_jobs", 42, properties={"worker": "eu-1"})`;
    case "rust":
      return `// Cargo.toml: reqwest + serde_json (or std/ureq)\nlet client = reqwest::Client::new();\nclient.post("https://devpulse.ritualdev.in/api/v1/analytics")\n  .json(&serde_json::json!({\n    "project": "${key}",\n    "metricName": "active_jobs",\n    "metricValue": 42,\n    "sourceType": "desktop",\n    "os": std::env::consts::OS\n  }))\n  .send().await?;`;
    case "go":
      return `// Standard library net/http — zero third-party deps\npayload := []byte(\`{"project":"${key}","metricName":"active_jobs","metricValue":42,"sourceType":"app","os":"linux"}\`)\nhttp.Post("https://devpulse.ritualdev.in/api/v1/analytics", "application/json", bytes.NewBuffer(payload))`;
    case "desktop":
      return `// Electron Main Process or Tauri Frontend\nawait fetch("https://devpulse.ritualdev.in/api/v1/analytics", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    project: "${key}",\n    metricName: "active_jobs",\n    metricValue: 42,\n    sourceType: "desktop",\n    os: navigator.platform,\n    appVersion: "2.1.0",\n  }),\n});`;
    case "react_native":
      return `// npm i @ritualdev/devpulse\nimport { DevPulseClient } from "@ritualdev/devpulse";\n\nconst pulse = new DevPulseClient({ apiKey: "${key}", release: "2.1.0" }).initReactNative({\n  platform: "ios",\n  deviceModel: "iPhone 15 Pro",\n  anrThresholdMs: 5000,\n});\n\n// Report native OOM / network failures & evaluate feature flags:\npulse.reportMobileEvent({ errorName: "OOMKill", message: "Memory warning", category: "oom", platform: "ios" });`;
    case "flutter":
      return `// packages/devpulse_flutter — captures exceptions, OOM, ANR & network errors\nawait DevPulseFlutter.init(\n  apiKey: "${key}",\n  release: "2.1.0",\n  deviceModel: "Pixel 9",\n);\n\nif (await DevPulseFlutter.instance!.flag("new-checkout", userId: "usr_123")) {\n  // Render new checkout\n}`;
    case "cli":
      return `# Track custom numeric metrics & CLI runs from any shell binary\ncurl -s -X POST https://devpulse.ritualdev.in/api/v1/analytics \\\n  -H "Content-Type: application/json" \\\n  -d '{"project":"${key}","metricName":"active_jobs","metricValue":42,"sourceType":"cli","os":"Linux"}'`;
  }
}

export function LanguageSdkTabs({
  apiKey,
  projectSlug,
  isDemo = false,
  onMetricSent,
}: LanguageSdkTabsProps) {
  const [activeTab, setActiveTab] = useState<LangTabId>("nextjs");
  const [copied, setCopied] = useState(false);
  const [metricName, setMetricName] = useState("active_jobs");
  const [metricValue, setMetricValue] = useState("42");
  const [sending, setSending] = useState(false);
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  const tabMeta = LANG_TABS.find((t) => t.id === activeTab) || LANG_TABS[0];
  const code = buildLanguageSnippet(activeTab, apiKey);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSendMetric = async () => {
    const val = Number(metricValue);
    if (!metricName.trim() || !Number.isFinite(val)) return;
    setSending(true);
    setSentNotice(null);
    try {
      const targetKey = isDemo ? projectSlug : apiKey || projectSlug;
      const res = await fetch("/api/v1/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: targetKey,
          metricName: metricName.trim(),
          metricValue: val,
          sourceType: activeTab === "cli" ? "cli" : activeTab === "desktop" ? "desktop" : "web",
        }),
      });
      if (res.ok) {
        setSentNotice(`Recorded ${metricName.trim()} = ${val}! Refreshing metrics...`);
        if (onMetricSent) onMetricSent();
        else setTimeout(() => window.location.reload(), 650);
      } else {
        setSentNotice("Failed to ingest metric — verify project identifier.");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Code2 className="w-4 h-4 text-emerald-400" />
            <span>Universal Telemetry, Analytics &amp; Custom Metrics (Any Language)</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Send pageviews, crashes, or numeric metrics like <code className="text-cyan-300">trackMetric(&quot;active_jobs&quot;, 42)</code> via SDK or standard HTTP POST.
          </p>
        </div>
      </div>

      {/* 9-Language Interactive Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {LANG_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              activeTab === t.id
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Code Snippet Viewer */}
      <div className="rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
        <div className="px-3.5 py-2 border-b border-zinc-800/80 flex items-center justify-between text-[11px]">
          <span className="font-mono text-zinc-400">{tabMeta.file}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? "Copied!" : "Copy Code"}</span>
          </button>
        </div>
        <pre className="p-3.5 text-[11px] font-mono text-emerald-300/90 overflow-x-auto leading-relaxed whitespace-pre-wrap">
          {code}
        </pre>
      </div>

      {/* Live Custom Metric Tester */}
      <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>Test <code className="text-cyan-300">trackMetric()</code> Live:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={metricName}
            onChange={(e) => setMetricName(e.target.value)}
            placeholder="active_jobs"
            className="w-36 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white"
          />
          <input
            type="number"
            value={metricValue}
            onChange={(e) => setMetricValue(e.target.value)}
            placeholder="42"
            className="w-24 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white"
          />
          <button
            type="button"
            disabled={sending}
            onClick={handleSendMetric}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            <span>Send Metric</span>
          </button>
        </div>
      </div>

      {sentNotice && (
        <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-700/60 text-xs text-emerald-200">
          {sentNotice}
        </div>
      )}
    </div>
  );
}
