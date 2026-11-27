"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  Check,
  Plus,
  Layers,
  Key,
  Copy,
  CheckCheck,
  Package,
  Globe,
  Cpu,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { displaySnippetKey } from "@/lib/security/mask-key";

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  githubRepo?: string | null;
  npmPackage?: string | null;
  pypiPackage?: string | null;
  rustCrate?: string | null;
  goModule?: string | null;
  dockerImage?: string | null;
  telemetryApiKey?: string | null;
  theme?: string | null;
  customCss?: string | null;
}

interface ProjectWorkspaceSwitcherProps {
  currentProject: ProjectSummary;
  projects: ProjectSummary[];
  onOpenImportModal: () => void;
}

export function ProjectWorkspaceSwitcher({
  currentProject,
  projects,
  onOpenImportModal,
}: ProjectWorkspaceSwitcherProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [revealKey, setRevealKey] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCopyApiKey = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.clipboard && currentProject.telemetryApiKey) {
      navigator.clipboard.writeText(currentProject.telemetryApiKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string, slug: string) => {
    e.stopPropagation();
    if (confirmDeleteId !== projectId) {
      setConfirmDeleteId(projectId);
      return;
    }
    setDeletingId(projectId);
    try {
      const res = await fetch(`/api/v1/projects?projectId=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setIsOpen(false);
        setConfirmDeleteId(null);
        if (slug === currentProject.slug || projectId === currentProject.id) {
          window.location.href = "/dashboard";
        } else {
          router.refresh();
          window.location.reload();
        }
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleSelectProject = (slug: string) => {
    setIsOpen(false);
    router.push(`/dashboard?project=${slug}`);
    router.refresh();
  };

  return (
    <div className="relative min-w-0 max-w-full" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 sm:gap-2 max-w-full px-2 sm:px-3 py-1.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-left transition shadow-sm"
        title="Switch Project Workspace"
      >
        <div className="w-5 h-5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
          <Layers className="w-3 h-3" />
        </div>
        <div className="min-w-0 flex-1 pr-0.5 sm:pr-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-white truncate max-w-[90px] sm:max-w-[160px]">
              {currentProject.name}
            </span>
            <span className="hidden sm:inline-block shrink-0 text-[10px] font-mono text-zinc-400 px-1 py-0.2 rounded bg-zinc-800">
              {currentProject.slug}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform ${
            isOpen ? "rotate-180 text-white" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 mt-2 w-72 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          {/* Header & Quick API Key (Owner/Admin only) */}
          {currentProject.telemetryApiKey ? (
            <div className="p-2 border-b border-zinc-800/80 mb-1.5">
              <span className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider block mb-1">
                Active Project API Key
              </span>
              <div
                onClick={handleCopyApiKey}
                className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 cursor-pointer text-[11px] font-mono text-zinc-300 transition"
                title="Click to copy telemetry ingest API key"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Key className="w-3 h-3 text-indigo-400 shrink-0" />
                  <span className="truncate">
                    {displaySnippetKey(currentProject.telemetryApiKey, revealKey)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRevealKey((v) => !v);
                    }}
                    className="p-0.5 text-zinc-500 hover:text-white"
                    title={revealKey ? "Hide API key" : "Reveal API key"}
                  >
                    {revealKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  {copiedKey ? (
                    <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-zinc-500 hover:text-white" />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-2 border-b border-zinc-800/80 mb-1.5">
              <span className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider block mb-0.5">
                Workspace Access
              </span>
              <p className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <Key className="w-3 h-3 text-zinc-500 shrink-0" />
                <span>API key visible to Admins &amp; Owners</span>
              </p>
            </div>
          )}

          {/* Project List */}
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            <span className="text-[10px] uppercase font-semibold text-zinc-500 tracking-wider px-2 py-1 block">
              Your Projects ({projects.length})
            </span>
            {projects.map((p) => {
              const isActive = p.id === currentProject.id || p.slug === currentProject.slug;
              const isConfirming = confirmDeleteId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelectProject(p.slug)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleSelectProject(p.slug);
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-xl text-left text-xs transition cursor-pointer ${
                    isActive
                      ? "bg-indigo-600/15 border border-indigo-500/30 text-white"
                      : "hover:bg-zinc-800/70 text-zinc-300 hover:text-white border border-transparent"
                  }`}
                >
                  <div className="min-w-0 pr-2 flex-1">
                    <div className="font-medium truncate text-white">{p.name}</div>
                    <div className="text-[10px] text-zinc-400 truncate font-mono">
                      {p.githubRepo || p.slug}
                    </div>
                    {/* Ecosystem tags */}
                    <div className="flex items-center gap-1 mt-1">
                      {p.npmPackage && (
                        <span className="text-[9px] px-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                          npm
                        </span>
                      )}
                      {p.pypiPackage && (
                        <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          PyPI
                        </span>
                      )}
                      {p.rustCrate && (
                        <span className="text-[9px] px-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Rust
                        </span>
                      )}
                      {p.goModule && (
                        <span className="text-[9px] px-1 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          Go
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isActive && <Check className="w-4 h-4 text-indigo-400" />}
                    {p.id !== "prj_ritual_core" && (
                      <button
                        type="button"
                        disabled={deletingId === p.id}
                        onClick={(e) => handleDeleteProject(e, p.id, p.slug)}
                        title={isConfirming ? "Click again to confirm deletion" : "Remove workspace / repo"}
                        className={`p-1 rounded-lg transition ${
                          isConfirming
                            ? "bg-red-600 text-white text-[10px] px-1.5 font-semibold"
                            : "text-zinc-500 hover:text-red-400 hover:bg-zinc-900"
                        }`}
                      >
                        {deletingId === p.id ? (
                          <span className="text-[10px]">...</span>
                        ) : isConfirming ? (
                          "Delete?"
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Import / New Project CTA */}
          <div className="pt-2 mt-1 border-t border-zinc-800/80">
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenImportModal();
              }}
              className="w-full flex items-center justify-center gap-1.5 p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Import New Repository</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
