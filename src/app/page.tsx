import React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ShieldCheck,
  Terminal,
  Zap,
  DollarSign,
  Package,
  Cpu,
  Globe,
  Check,
} from "lucide-react";
import { AuthButton } from "@/components/auth/AuthButton";

export const metadata = {
  title: "DevPulse - Unified Developer Headquarters & Telemetry Engine",
  description:
    "One mission control for every star, download, crash, and dollar. Unify GitHub, npm, PyPI, VS Code, MCP, crash telemetry, and Stripe/Dodo revenue.",
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-indigo-500/30 selection:text-white">
      {/* Navigation Bar */}
      <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/20">
              <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
                <Activity className="w-5 h-5 text-indigo-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-white text-base tracking-tight">DevPulse</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  ritualdev-lab
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 font-medium">Developer Mission Control</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-zinc-400">
            <a href="#about" className="hover:text-white transition">About</a>
            <a href="#features" className="hover:text-white transition">Features</a>
            <a href="#revenue" className="hover:text-white transition">Revenue Engine</a>
            <a href="#pricing" className="hover:text-white transition">Pricing</a>
            <a href="#cli" className="hover:text-white transition">Terminal CLI</a>
            <a
              href="https://github.com/ritualdev-lab/devpulse"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition"
            >
              GitHub
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition"
            >
              <span>Open Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <div className="pl-1 border-l border-zinc-800">
              <AuthButton />
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-28">
        {/* Ambient Gradient Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-indigo-500/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/3 w-[300px] h-[200px] bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10 text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-emerald-400">DevPulse HQ 1.0</span>
            <span className="text-zinc-500">&bull;</span>
            <span>Unified Command Center for Software Creators</span>
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-[1.1]">
            One Mission Control for Every{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400">
              Star, Download, Crash & Dollar.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            Stop juggling 8 different tabs. DevPulse brings your GitHub traffic, npm/PyPI downloads,
            VS Code installs, MCP servers, instant fatal crash telemetry, and Stripe & Dodo Payments
            revenue into a single, real-time developer headquarters.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white shadow-xl shadow-indigo-600/30 transition transform hover:-translate-y-0.5"
            >
              <span>Launch Mission Control</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#about"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-sm font-semibold text-zinc-300 hover:text-white transition"
            >
              <span>Learn How It Works</span>
            </a>
          </div>

          {/* Quick CLI Box */}
          <div className="pt-4 max-w-md mx-auto">
            <div className="px-4 py-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-between text-xs font-mono text-zinc-400">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-zinc-200">npm i -g @ritualdev/pulse</span>
              </div>
              <span className="text-[10px] text-zinc-500 uppercase font-semibold">CLI Ready</span>
            </div>
          </div>
        </div>
      </section>

      {/* Live Interactive UI Showcase Preview */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20 relative z-10">
        <div className="p-1 rounded-3xl bg-gradient-to-b from-zinc-700/50 via-zinc-800/20 to-zinc-900/50 shadow-2xl">
          <div className="rounded-[22px] bg-zinc-950 p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="ml-2 font-mono text-xs text-zinc-400">devpulse.ritualdev.in/dashboard</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                  ● Live Cloudflare Edge Synced
                </span>
                <span className="text-xs font-semibold text-zinc-400">Ritual-Core CLI</span>
              </div>
            </div>

            {/* Mock Dashboard Grid Preview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* GitHub Card Preview */}
              <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">GitHub Repository</span>
                  <span className="text-xs text-indigo-400 font-mono">ritualdev-lab/core</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">1,420</span>
                  <span className="text-xs font-semibold text-amber-400">★ Stars</span>
                </div>
                <p className="text-xs text-zinc-500">188 forks &bull; 14 open issues &bull; 99.8% health</p>
              </div>

              {/* Package Downloads Card Preview */}
              <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Multi-Registry Downloads</span>
                  <span className="text-xs text-cyan-400 font-mono">npm &bull; PyPI &bull; VSCode</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">84,320</span>
                  <span className="text-xs font-semibold text-emerald-400">+18% this month</span>
                </div>
                <p className="text-xs text-zinc-500">42.1k npm &bull; 31.8k PyPI &bull; 10.4k VS Code</p>
              </div>

              {/* Revenue Card Preview */}
              <div id="revenue" className="p-5 rounded-2xl bg-zinc-900/80 border border-emerald-500/30 space-y-3 bg-gradient-to-br from-emerald-950/20 via-zinc-900/80 to-zinc-900/80">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">MRR & Monetization</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Stripe + Dodo
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-emerald-400">$2,840</span>
                  <span className="text-xs text-zinc-400 font-medium">Monthly Recurring</span>
                </div>
                <p className="text-xs text-zinc-500">142 active subscribers &bull; $3,410 30d volume</p>
              </div>

              {/* Crash Stream Preview (2 cols) */}
              <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3 md:col-span-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Live Crash Telemetry & Alerts</span>
                  </div>
                  <span className="text-xs text-zinc-500 font-mono">Discord &bull; Telegram &bull; Slack</span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-red-500/20 flex items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-red-400">ConnectionTimeout: Failed to reach upstream RPC</span>
                    <p className="text-zinc-500 text-[11px]">Runtime: nodejs@v20.11 &bull; CLI v1.2.0 &bull; 14 minutes ago</p>
                  </div>
                  <span className="px-2 py-1 rounded-lg bg-zinc-900 text-zinc-400 text-[11px] font-mono">Pushed to Discord</span>
                </div>
              </div>

              {/* Web Analytics Preview */}
              <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Cookie-Free Web Analytics</span>
                  <span className="text-xs text-indigo-400 font-mono">&lt;2KB script</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">3,480</span>
                  <span className="text-xs text-zinc-400 font-medium">Unique Pageviews</span>
                </div>
                <p className="text-xs text-zinc-500">Top: HackerNews (28%) &bull; GitHub (41%)</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About Section: The Problem We Solve */}
      <section id="about" className="max-w-7xl mx-auto px-4 sm:px-6 py-20 border-t border-zinc-900">
        <div className="max-w-3xl mx-auto text-center space-y-4 mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-semibold">
            About DevPulse
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Built for Developers Who Ship Fast
          </h2>
          <p className="text-zinc-400 leading-relaxed text-sm sm:text-base">
            Modern software creators build packages on npm and PyPI, extensions for VS Code, MCP servers
            for LLMs, and documentation sites. But monitoring them is painful: traffic charts expire in
            14 days on GitHub, Sentry is heavyweight and expensive, and revenue sits locked away in separate
            billing portals.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
              1
            </div>
            <h3 className="font-bold text-white text-base">Historical Memory Forever</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              GitHub deletes your clone and visitor traffic after 14 days. DevPulse syncs your metrics twice
              daily into Turso libSQL so you have lifetime trends from Day 1 to Day 1,000.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center font-bold">
              2
            </div>
            <h3 className="font-bold text-white text-base">Instant Fatal Crash Pings</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Don’t wait for users to open a GitHub issue. When an unhandled exception or crash occurs in your
              CLI or SDK, DevPulse pings your Discord, Slack, or Telegram channel within seconds.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
              3
            </div>
            <h3 className="font-bold text-white text-base">Integrated Revenue & MRR</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Connect read-only API keys for Stripe or Dodo Payments. Track monthly recurring revenue, net
              volume, active subscribers, and recent transactions directly in your dev dashboard.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Pillars Grid */}
      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 py-20 border-t border-zinc-900">
        <div className="max-w-3xl mx-auto text-center space-y-4 mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-semibold">
            Feature Deep Dive
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Everything You Need in One Single Place
          </h2>
          <p className="text-zinc-400 leading-relaxed text-sm">
            Modular, drag-and-drop widgets designed for modern open-source and commercial developers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
            <Package className="w-6 h-6 text-indigo-400" />
            <h4 className="font-bold text-white text-sm">Multi-Registry Package Tracking</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Auto-fetches download numbers from npm, PyPI, and VS Code Marketplace with weekly & monthly trendlines.
            </p>
          </div>

          {/* Card 2 */}
          <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
            <Cpu className="w-6 h-6 text-cyan-400" />
            <h4 className="font-bold text-white text-sm">Model Context Protocol (MCP) Tracking</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Track MCP server capabilities, tool counts, and Glama/Smithery registry indexing status for AI agent tools.
            </p>
          </div>

          {/* Card 3 */}
          <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
            <DollarSign className="w-6 h-6 text-emerald-400" />
            <h4 className="font-bold text-white text-sm">Stripe & Dodo Payments Revenue</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Track MRR, 30-day net volume, active subscribers, and transaction velocity with 100% read-only secure keys.
            </p>
          </div>

          {/* Card 4 */}
          <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
            <Zap className="w-6 h-6 text-amber-400" />
            <h4 className="font-bold text-white text-sm">Lightweight Telemetry SDK</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Zero dependencies. Drop 5 lines of code in Python or Node.js to stream fatal crashes and breadcrumbs.
            </p>
          </div>

          {/* Card 5 */}
          <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
            <Globe className="w-6 h-6 text-blue-400" />
            <h4 className="font-bold text-white text-sm">Cookie-Free Web Analytics</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              GDPR-compliant &lt;2KB script. Drop into docs sites to see unique visitors, top referrers, and countries.
            </p>
          </div>

          {/* Card 6 */}
          <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
            <ShieldCheck className="w-6 h-6 text-purple-400" />
            <h4 className="font-bold text-white text-sm">Dynamic SVG README Badges</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Embed live dynamic shields like <code className="text-zinc-300">/api/badge/downloads/...svg</code> directly into GitHub READMEs.
            </p>
          </div>
        </div>
      </section>

      {/* Commercial SaaS Pricing Section */}
      <section id="pricing" className="max-w-7xl mx-auto px-4 sm:px-6 py-20 border-t border-zinc-900 space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
            Transparent Developer Pricing
          </span>
          <h3 className="text-3xl sm:text-4xl font-extrabold text-white">
            Start Free. Scale With Your Ecosystem.
          </h3>
          <p className="text-sm text-zinc-400">
            Powered by Dodo Payments with instant tier provisioning, modular domain/storage add-ons, and automated SSL.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Free */}
          <div className="p-7 rounded-3xl bg-zinc-900/50 border border-zinc-800 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-white">Free</span>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                  OSS Solo
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">$0</span>
                <span className="text-xs text-zinc-400">/month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-zinc-300">
                {[
                  "1 Project workspace",
                  "1 Free *.devpulse.ritualdev.in subdomain",
                  "100 MB Cloudflare R2 storage (7d lifecycle)",
                  "7-day analytics & telemetry history",
                  "Generic webhook alerts & preset themes",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Link
              href="/dashboard"
              className="w-full py-3 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-center text-xs font-bold text-white transition"
            >
              Get Started Free
            </Link>
          </div>

          {/* Developer Pro */}
          <div className="p-7 rounded-3xl bg-indigo-950/30 border border-indigo-500/60 shadow-2xl shadow-indigo-950/30 flex flex-col justify-between space-y-6 relative">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-white">Developer Pro</span>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  Popular
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">$14</span>
                <span className="text-xs text-zinc-400">/month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-zinc-200">
                {[
                  "5 Projects + 1-Click GitHub Import",
                  "1 Custom Domain with automatic SSL",
                  "5 GB Cloudflare R2 storage (90d lifecycle)",
                  "90-day analytics & metrics history",
                  "Discord & Telegram crash alerts",
                  "Scoped Custom CSS & white-label portals",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Link
              href="/dashboard"
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-center text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition"
            >
              Upgrade to Pro
            </Link>
          </div>

          {/* Team / Studio */}
          <div className="p-7 rounded-3xl bg-zinc-900/50 border border-zinc-800 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-white">Team / Studio</span>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  BYOS + Scale
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">$49</span>
                <span className="text-xs text-zinc-400">/month</span>
              </div>
              <ul className="space-y-2.5 text-xs text-zinc-300">
                {[
                  "Unlimited Projects & workspaces",
                  "5 Custom Domains with automatic SSL",
                  "50 GB R2 storage + BYOS (own R2 / S3)",
                  "365-day analytics & telemetry history",
                  "Multi-channel PagerDuty, Slack, Discord & Telegram",
                  "Priority Cloudflare edge ingestion",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Link
              href="/dashboard"
              className="w-full py-3 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-center text-xs font-bold text-white transition"
            >
              Launch Team Workspace
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-zinc-400">
          <div className="px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800">
            Add-on: <span className="text-white font-semibold">Extra Custom Domain</span> (+$5/mo per domain)
          </div>
          <div className="px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800">
            Add-on: <span className="text-white font-semibold">Extra R2 Storage</span> (+$3/mo per 25 GB)
          </div>
        </div>
      </section>

      {/* Maintainer CLI Section */}
      <section id="cli" className="max-w-7xl mx-auto px-4 sm:px-6 py-20 border-t border-zinc-900">
        <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-900 border border-zinc-800 flex flex-col lg:flex-row items-center justify-between gap-8">
          <div className="space-y-4 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-semibold">
              <Terminal className="w-3.5 h-3.5" />
              <span>Companion CLI</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
              Control DevPulse From Your Terminal
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Check downloads, stars, and crash logs without leaving tmux or VS Code. Install globally via npm or pip:
            </p>
            <div className="space-y-2 font-mono text-xs text-zinc-300">
              <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <span>devpulse status</span>
                <span className="text-zinc-500"># Prints stars, downloads & MRR</span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <span>devpulse crashes</span>
                <span className="text-zinc-500"># Streams latest unhandled errors</span>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-auto">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white shadow-xl shadow-indigo-600/30 transition w-full lg:w-auto"
            >
              <span>Go To Headquarters</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-10 px-4 sm:px-6 text-xs text-zinc-500 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Activity className="w-4 h-4 text-indigo-400" />
            <span className="font-bold text-zinc-300">DevPulse</span>
            <span>&bull;</span>
            <span>Unified Developer Headquarters & Mission Control</span>
          </div>

          <div className="flex items-center gap-6 text-zinc-400">
            <Link href="/dashboard" className="hover:text-white transition">Dashboard</Link>
            <a href="https://github.com/ritualdev-lab" target="_blank" rel="noreferrer" className="hover:text-white transition">
              RitualDev-Lab
            </a>
            <a href="https://devpulse.ritualdev.in" className="hover:text-white transition">
              devpulse.ritualdev.in
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
