"use client";

import React, { useState } from "react";
import {
  Activity,
  ArrowRight,
  ShieldCheck,
  Zap,
  Layers,
  Terminal,
  DollarSign,
  Package,
  GitBranch,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

function GitHubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

export function DashboardAuthGate() {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSignIn = async () => {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between selection:bg-indigo-500/30 selection:text-white">
      {/* Top Navbar */}
      <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/20">
              <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
                <Activity className="w-5 h-5 text-indigo-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-white text-base tracking-tight">DevPulse</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Mission Control
                </span>
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard?demo=1"
              className="text-xs text-zinc-400 hover:text-white transition px-3 py-1.5"
            >
              Explore Live Demo &rarr;
            </Link>
          </div>
        </div>
      </header>

      {/* Main Auth Container */}
      <main className="max-w-xl mx-auto w-full px-4 py-16 text-center space-y-8 relative">
        {/* Glow ambient */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tenant-Isolated Developer Headquarters</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
            Connect Your GitHub Account
          </h1>
          <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
            Sign in with GitHub to unlock 1-click repository auto-scanning, fatal crash telemetry,
            multi-ecosystem package metrics, and live payment revenue monitoring.
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-2 gap-3 text-left relative z-10">
          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800">
            <GitBranch className="w-4 h-4 text-cyan-400 mb-2" />
            <h4 className="text-xs font-semibold text-white">1-Click Auto Scanner</h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Instantly discovers npm, PyPI, Cargo & Go packages.
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800">
            <Zap className="w-4 h-4 text-amber-400 mb-2" />
            <h4 className="text-xs font-semibold text-white">Crash Telemetry</h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Zero-dependency beacon captures fatal exceptions.
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800">
            <DollarSign className="w-4 h-4 text-emerald-400 mb-2" />
            <h4 className="text-xs font-semibold text-white">Dodo & Stripe Revenue</h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Live MRR, net volume, and multi-currency tracking.
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800">
            <Layers className="w-4 h-4 text-indigo-400 mb-2" />
            <h4 className="text-xs font-semibold text-white">Multi-Project Switcher</h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Monitor N tools, SDKs, and packages in one place.
            </p>
          </div>
        </div>

        {/* Big Sign In Button */}
        <div className="relative z-10 space-y-3 pt-2">
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-2xl bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-sm transition shadow-xl shadow-white/10 disabled:opacity-50"
          >
            <GitHubIcon className="w-4 h-4" />
            <span>{loading ? "Redirecting to GitHub..." : "Continue with GitHub"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <div className="pt-2">
            <Link
              href="/dashboard?demo=1"
              className="text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              Or preview the RitualDev live demo workspace &rarr;
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-6 text-center text-xs text-zinc-600">
        DevPulse &bull; Free Subdomain Included &bull; Optional Pro ($14/mo) &amp; Team ($49/mo) Upgrades
      </footer>
    </div>
  );
}
