"use client";

import React, { useState } from "react";
import { X, Plug, CheckCircle2, Box, Package, Cpu, HelpCircle, GitBranch } from "lucide-react";

interface IntegrationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  initialGithub?: string | null;
  initialNpm?: string | null;
  initialPypi?: string | null;
  initialRustCrate?: string | null;
  initialGoModule?: string | null;
  initialVsCode?: string | null;
  initialMcp?: string | null;
}

export function IntegrationsModal({
  isOpen,
  onClose,
  projectId,
  initialGithub = "",
  initialNpm = "",
  initialPypi = "",
  initialRustCrate = "",
  initialGoModule = "",
  initialVsCode = "",
  initialMcp = "",
}: IntegrationsModalProps) {
  const [github, setGithub] = useState(initialGithub || "");
  const [npm, setNpm] = useState(initialNpm || "");
  const [pypi, setPypi] = useState(initialPypi || "");
  const [rustCrate, setRustCrate] = useState(initialRustCrate || "");
  const [goModule, setGoModule] = useState(initialGoModule || "");
  const [vscode, setVsCode] = useState(initialVsCode || "");
  const [mcp, setMcp] = useState(initialMcp || "");

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/v1/projects/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          githubRepo: github,
          npmPackage: npm,
          pypiPackage: pypi,
          rustCrate: rustCrate,
          goModule: goModule,
          vscodeExtension: vscode,
          mcpServerName: mcp,
        }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          onClose();
          window.location.reload();
        }, 1000);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Plug className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Connect Packages & Data Tabs</h2>
              <p className="text-xs text-zinc-400">Configure which ecosystems your project tracks</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-indigo-300 flex items-start gap-2.5">
            <HelpCircle className="w-4 h-4 shrink-0 text-indigo-400 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Smart Cards:</strong> Leave any package manager blank if you don&apos;t use it. For
              example, if you only build in Python, leave npm blank and DevPulse will only display your
              PyPI card!
            </p>
          </div>

          {/* GitHub */}
          <div className="space-y-1.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-zinc-400" />
              <span>GitHub Repository (owner/repo)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. ritualdev-lab/devpulse"
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            />
          </div>

          {/* PyPI */}
          <div className="space-y-1.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-amber-400" />
              <span>Python / PyPI Package Name</span>
            </label>
            <input
              type="text"
              placeholder="e.g. requests or ritual-core"
              value={pypi}
              onChange={(e) => setPypi(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            />
          </div>

          {/* npm */}
          <div className="space-y-1.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-red-400" />
              <span>Node / npm Package Name (optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. @ritualdev/pulse or express"
              value={npm}
              onChange={(e) => setNpm(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            />
          </div>

          {/* Rust Crate */}
          <div className="space-y-1.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-orange-400" />
              <span>Rust Crate Name (crates.io)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. tokio, serde, or your crate"
              value={rustCrate}
              onChange={(e) => setRustCrate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            />
          </div>

          {/* Go Module */}
          <div className="space-y-1.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-cyan-400" />
              <span>Go Module Path (optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. charm.land/bubbletea or github.com/user/repo"
              value={goModule}
              onChange={(e) => setGoModule(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            />
          </div>

          {/* VS Code */}
          <div className="space-y-1.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>VS Code Extension ID (publisher.name)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. ritualdev.ritual-vscode"
              value={vscode}
              onChange={(e) => setVsCode(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            />
          </div>

          {/* MCP Server */}
          <div className="space-y-1.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>Model Context Protocol (MCP) Server Name</span>
            </label>
            <input
              type="text"
              placeholder="e.g. ritualdev/devpulse-mcp"
              value={mcp}
              onChange={(e) => setMcp(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            />
          </div>

          {/* Submit Action */}
          <div className="pt-2 flex items-center justify-between border-t border-zinc-800/80">
            {success ? (
              <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-xs">
                <CheckCircle2 className="w-4 h-4" />
                <span>Integrations updated! Reloading...</span>
              </div>
            ) : (
              <span className="text-[11px] text-zinc-500">Unused tabs will be removed instantly.</span>
            )}

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Integrations"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
