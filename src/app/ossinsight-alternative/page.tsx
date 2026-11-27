import React from "react";
import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, ShieldCheck, Zap, GitBranch } from "lucide-react";
import { OssInsightConverterClient } from "./OssInsightConverterClient";

export const metadata = {
  title: "OSSInsight Alternative for GitHub READMEs & Analytics — DevPulse",
  description:
    "Replace frozen next.ossinsight.io embeds and discontinued api.ossinsight.io endpoints with live edge-cached SVG telemetry cards across GitHub, npm, PyPI & Crates.",
};

export default function OssInsightAlternativePage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-x-hidden">
      <header className="w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px]">
              <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
                <Activity className="w-4 h-4 text-indigo-400" />
              </div>
            </div>
            <span className="font-extrabold text-white text-base tracking-tight">DevPulse</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <Link
              href="/dashboard?demo=1"
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-xs font-semibold text-emerald-200 transition"
            >
              Live Demo
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
            >
              <span>Import Repo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-12 space-y-10">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-xs text-amber-300 font-semibold">
            <span>OSSInsight Migration Guide (Dec 2026 Shutdown Ready)</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white max-w-3xl mx-auto leading-tight">
            Drop-In Replacement for Frozen{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400">
              OSSInsight README Badges &amp; Analytics
            </span>
          </h1>
          <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            When <code className="text-zinc-200">next.ossinsight.io</code> widgets freeze and{" "}
            <code className="text-zinc-200">api.ossinsight.io</code> retires, DevPulse keeps your README shields live
            and archives your GitHub traffic past GitHub&apos;s 14-day cutoff alongside 23+ package registries.
          </p>
        </div>

        <OssInsightConverterClient />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-2">
            <GitBranch className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">Lifetime GitHub Traffic</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Persists daily clones, unique visitors, and stars past GitHub&apos;s 14-day history cliff across GitHub, GitLab, Bitbucket &amp; Codeberg.
            </p>
          </div>
          <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">23+ Package Registries</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Combines npm, PyPI, Crates.io, Docker Hub, Go, VS Code, MCP, NuGet &amp; Homebrew downloads in one SVG badge.
            </p>
          </div>
          <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Security &amp; Crash Health</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Live OSV.dev CVE status, OpenSSF Scorecards, and crash-free session % served securely via CSP-sandboxed SVGs.
            </p>
          </div>
        </div>

        <section className="p-6 rounded-3xl bg-zinc-900/60 border border-zinc-800 space-y-3">
          <h2 className="text-sm font-bold text-white">How Migration Works in 60 Seconds</h2>
          <ol className="space-y-2 text-xs text-zinc-300 list-decimal pl-5">
            <li>Sign in with GitHub on <Link href="/dashboard" className="text-indigo-400 underline">/dashboard</Link> and import your repository (auto-scans <code className="text-zinc-200">package.json</code>, <code className="text-zinc-200">pyproject.toml</code>, <code className="text-zinc-200">Cargo.toml</code>, and <code className="text-zinc-200">go.mod</code>).</li>
            <li>Copy your generated Markdown shields above into your <code className="text-zinc-200">README.md</code> replacing <code className="text-zinc-200">next.ossinsight.io</code> image tags.</li>
            <li className="flex items-center gap-1.5 list-none -ml-5 pt-1 text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Your stars, multi-registry downloads, CVE posture, and runtime crash health sync automatically.</span>
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}
