"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Scale,
  Download,
  GitPullRequest,
  ExternalLink,
  RefreshCw,
  Award,
  CheckCircle2,
  AlertTriangle,
  Search,
  X,
} from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import type { CveSeverity, SbomInventoryReport, SbomVulnerability } from "@/lib/security/sbom";
import { analyzeSupplyChainBehavior } from "@/lib/security/watchdog";
import { WorkspaceShell } from "../WorkspaceShell";
import { useWorkspaceData } from "../WorkspaceCacheContext";

interface EnrichedVulnerability extends SbomVulnerability {
  fixIssueUrl?: string | null;
}

interface EnrichedReport extends SbomInventoryReport {
  packages: Array<
    SbomInventoryReport["packages"][number] & {
      vulnerabilities: EnrichedVulnerability[];
    }
  >;
  githubRepo?: string | null;
}

const DEMO_SBOM_REPORT: EnrichedReport = {
  generatedAt: new Date().toISOString(),
  totalPackages: 4,
  totalVulnerabilities: 1,
  severityCounts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
  spdxApprovedCount: 4,
  githubRepo: "RitualDev-Lab/devpulse",
  packages: [
    {
      ecosystem: "npm",
      packageName: "@ritualdev/pulse",
      version: "1.4.2",
      license: "MIT",
      spdxCompliant: true,
      advisoryCount: 0,
      scorecardOverall: 8.4,
      sourceRepo: "github.com/RitualDev-Lab/devpulse",
      vulnerabilities: [],
    },
    {
      ecosystem: "pypi",
      packageName: "devpulse-sdk",
      version: "1.1.0",
      license: "Apache-2.0",
      spdxCompliant: true,
      advisoryCount: 1,
      scorecardOverall: 7.9,
      sourceRepo: "github.com/RitualDev-Lab/devpulse",
      vulnerabilities: [
        {
          id: "GHSA-demo-98vx-4q2m",
          packageName: "devpulse-sdk",
          ecosystem: "pypi",
          version: "1.1.0",
          severity: "HIGH",
          summary: "Sample OSV.dev advisory illustrating Fix PR workflow & SPDX license compliance verification.",
          fixedVersion: "1.1.2",
          referenceUrl: "https://osv.dev/",
          fixIssueUrl: "https://github.com/RitualDev-Lab/devpulse/issues/new",
        },
      ],
    },
    {
      ecosystem: "crates",
      packageName: "devpulse-rs",
      version: "0.9.1",
      license: "MIT",
      spdxCompliant: true,
      advisoryCount: 0,
      scorecardOverall: 8.1,
      sourceRepo: "github.com/RitualDev-Lab/devpulse",
      vulnerabilities: [],
    },
    {
      ecosystem: "go",
      packageName: "github.com/ritualdev-lab/devpulse-go",
      version: "v0.4.0",
      license: "BSD-3-Clause",
      spdxCompliant: true,
      advisoryCount: 0,
      scorecardOverall: 8.0,
      sourceRepo: "github.com/RitualDev-Lab/devpulse",
      vulnerabilities: [],
    },
  ],
};

const SEVERITY_BADGE: Record<CveSeverity, string> = {
  CRITICAL: "bg-red-500/20 text-red-300 border-red-500/40",
  HIGH: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  MEDIUM: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  LOW: "bg-zinc-800 text-zinc-300 border-zinc-700",
};

export function SecurityCenterFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { projects, customDomain, storageTier, isDemo } = workspace;
  const initialData = useWorkspaceData(workspace.initialData);
  const project = initialData.project;

  const [report, setReport] = useState<EnrichedReport | null>(isDemo ? DEMO_SBOM_REPORT : null);
  const [loading, setLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<"ALL" | CveSeverity>("ALL");
  const [pkgSearch, setPkgSearch] = useState("");
  const [spdxFilter, setSpdxFilter] = useState<"all" | "compliant" | "non_compliant">("all");
  const [inspectedVuln, setInspectedVuln] = useState<EnrichedVulnerability | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadSbom = useCallback(async () => {
    if (isDemo) {
      setReport(DEMO_SBOM_REPORT);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/security/sbom?projectId=${encodeURIComponent(project.id)}`);
      const d = await res.json();
      if (res.ok) setReport(d);
    } finally {
      setLoading(false);
    }
  }, [project.id, isDemo]);

  useEffect(() => {
    void loadSbom();
  }, [loadSbom]);

  const handleOpenFixPr = async (v: EnrichedVulnerability) => {
    const key = `${v.packageName}:${v.id}`;
    if (isDemo) {
      setActionMsg(`Demo Fix PR preview: opens security remediation issue for ${v.packageName} (${v.id}) in GitHub.`);
      return;
    }
    setBusyKey(key);
    setActionMsg(null);
    try {
      const res = await fetch("/api/v1/security/sbom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          packageName: v.packageName,
          ecosystem: v.ecosystem,
          advisoryId: v.id,
          fixedVersion: v.fixedVersion,
        }),
      });
      const data = await res.json();
      if (data.issueUrl) {
        if (data.mode === "created") {
          setActionMsg(`Created GitHub security fix issue #${data.issueNumber}.`);
        } else {
          window.open(data.issueUrl, "_blank", "noopener,noreferrer");
          setActionMsg(data.message || "Opened pre-filled GitHub remediation issue.");
        }
      } else {
        setActionMsg(data.error || data.message || "Unable to open Fix PR.");
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleExportCycloneDx = () => {
    if (!report) return;
    const cyclonedx = {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: {
        timestamp: report.generatedAt,
        component: { name: project.name, type: "application" },
      },
      components: report.packages.map((p) => ({
        type: "library",
        name: p.packageName,
        version: p.version || "latest",
        licenses: p.license && p.license !== "UNKNOWN" ? [{ license: { id: p.license } }] : [],
        purl: `pkg:${p.ecosystem}/${p.packageName}${p.version ? `@${p.version}` : ""}`,
      })),
      vulnerabilities: report.packages.flatMap((p) =>
        p.vulnerabilities.map((v) => ({
          id: v.id,
          ratings: [{ severity: v.severity.toLowerCase() }],
          description: v.summary,
        }))
      ),
    };
    const blob = new Blob([JSON.stringify(cyclonedx, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.slug}-sbom-cyclonedx.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allVulns = (report?.packages || []).flatMap((p) => p.vulnerabilities);
  const filteredVulns =
    severityFilter === "ALL" ? allVulns : allVulns.filter((v) => v.severity === severityFilter);
  const filteredPackages = (report?.packages || []).filter((pkg) => {
    if (spdxFilter === "compliant" && !pkg.spdxCompliant) return false;
    if (spdxFilter === "non_compliant" && pkg.spdxCompliant) return false;
    if (pkgSearch.trim()) {
      const q = pkgSearch.toLowerCase();
      return (
        pkg.packageName.toLowerCase().includes(q) ||
        pkg.ecosystem.toLowerCase().includes(q) ||
        (pkg.license || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <ShieldAlert className="w-6 h-6 text-emerald-400" />
              <span>Security &amp; SBOM Vulnerability Center</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Live OSV.dev CVEs, OpenSSF Scorecard ratings, SPDX license compliance matrix &amp; 1-click Fix PR automation
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadSbom()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? "animate-spin" : ""}`} />
              <span>Rescan SBOM</span>
            </button>
            <button
              type="button"
              onClick={handleExportCycloneDx}
              disabled={!report}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-xs font-semibold text-emerald-300 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CycloneDX JSON</span>
            </button>
          </div>
        </div>

        {actionMsg && (
          <div className="p-3 rounded-xl bg-cyan-950/50 border border-cyan-500/30 text-xs text-cyan-200">
            {actionMsg}
          </div>
        )}

        {/* Top KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[11px] text-zinc-400">Tracked SBOM Packages</div>
            <div className="text-2xl font-bold text-white mt-1">{report?.totalPackages ?? 0}</div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[11px] text-zinc-400">Open CVEs (OSV.dev)</div>
            <div className={`text-2xl font-bold mt-1 ${(report?.totalVulnerabilities || 0) > 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {report?.totalVulnerabilities ?? 0}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[11px] text-zinc-400">Critical / High Severity</div>
            <div className="text-2xl font-bold text-red-400 mt-1">
              {(report?.severityCounts.CRITICAL || 0) + (report?.severityCounts.HIGH || 0)}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[11px] text-zinc-400">SPDX License Compliance</div>
            <div className="text-2xl font-bold text-cyan-300 mt-1">
              {report?.spdxApprovedCount ?? 0}/{report?.totalPackages ?? 0}
            </div>
          </div>
        </div>

        {/* CVE Severity Queue */}
        <section className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">Vulnerability Advisories &amp; 1-Click Fix PRs</h2>
              <p className="text-xs text-zinc-400">Filter OSV.dev CVEs by severity across all attached ecosystems</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2.5 py-1 rounded-lg border font-semibold transition ${
                    severityFilter === sev
                      ? "bg-indigo-600 text-white border-indigo-500"
                      : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white"
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          {filteredVulns.length === 0 ? (
            <div className="p-6 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center gap-3 text-xs text-emerald-300">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>Zero known vulnerabilities matching the selected filter.</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredVulns.map((v) => {
                const key = `${v.packageName}:${v.id}`;
                return (
                  <div
                    key={key}
                    onClick={() => setInspectedVuln(v)}
                    className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-cyan-500/40 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${SEVERITY_BADGE[v.severity]}`}>
                          {v.severity}
                        </span>
                        <span className="text-xs font-mono font-bold text-white">{v.id}</span>
                        <span className="text-xs font-mono text-cyan-300">
                          {v.packageName} ({v.ecosystem})
                        </span>
                        {v.fixedVersion && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                            Fix &rarr; {v.fixedVersion}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400">{v.summary}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setInspectedVuln(v)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-cyan-300"
                      >
                        Inspect CVE
                      </button>
                      <a
                        href={v.referenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>OSV</span>
                      </a>
                      <button
                        type="button"
                        disabled={busyKey === key}
                        onClick={() => void handleOpenFixPr(v)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <GitPullRequest className="w-3.5 h-3.5" />
                        <span>Open Fix PR</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* SBOM Dependency Inventory & SPDX Matrix */}
        <section className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">SBOM Dependency Tree &amp; SPDX Compliance Matrix</h2>
              <p className="text-xs text-zinc-400">Aggregated across primary slots and multi-registry connectors</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={pkgSearch}
                  onChange={(e) => setPkgSearch(e.target.value)}
                  placeholder="Filter package or license..."
                  className="pl-8 pr-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white w-48"
                />
              </div>
              <select
                value={spdxFilter}
                onChange={(e) => setSpdxFilter(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white"
              >
                <option value="all">All SPDX</option>
                <option value="compliant">SPDX Approved</option>
                <option value="non_compliant">Non-Compliant</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/70 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-2.5">Package</th>
                  <th className="px-4 py-2.5">Scope</th>
                  <th className="px-4 py-2.5">Ecosystem</th>
                  <th className="px-4 py-2.5">Version</th>
                  <th className="px-4 py-2.5">License / SPDX</th>
                  <th className="px-4 py-2.5">OpenSSF Scorecard</th>
                  <th className="px-4 py-2.5">CVEs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredPackages.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                      No SBOM dependencies match the active filter.
                    </td>
                  </tr>
                ) : (
                  filteredPackages.map((pkg, idx) => (
                    <tr key={`${pkg.ecosystem}:${pkg.packageName}`} className="hover:bg-zinc-950/40">
                      <td className="px-4 py-2.5 font-mono text-white font-semibold">{pkg.packageName}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                            idx < 2 || pkg.sourceRepo
                              ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                              : "bg-zinc-800 text-zinc-400 border-zinc-700"
                          }`}
                        >
                          {idx < 2 || pkg.sourceRepo ? "Direct" : "Transitive"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 uppercase text-[11px] font-mono text-zinc-400">{pkg.ecosystem}</td>
                      <td className="px-4 py-2.5 font-mono text-cyan-300">{pkg.version || "latest"}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          {pkg.spdxCompliant ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                          )}
                          <Scale className="w-3 h-3 text-zinc-500" />
                          <span className="font-mono text-zinc-200">{pkg.license}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {typeof pkg.scorecardOverall === "number" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-cyan-300 font-mono text-[11px]">
                            <Award className="w-3 h-3 text-cyan-400" />
                            {pkg.scorecardOverall.toFixed(1)}/10
                          </span>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        <span className={pkg.advisoryCount > 0 ? "text-amber-400 font-bold" : "text-emerald-400"}>
                          {pkg.advisoryCount}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Behavioral Supply-Chain Watchdog */}
        {(() => {
          const watchdogFindings = analyzeSupplyChainBehavior(
            (report?.packages || []).map((p) => ({
              ecosystem: p.ecosystem,
              packageName: p.packageName,
              version: p.version,
              license: p.license,
              scorecardOverall: p.scorecardOverall,
              sourceRepo: p.sourceRepo,
            }))
          );
          return (
            <section className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Behavioral Supply-Chain Watchdog</span>
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Screens packages for install-script hazards, typosquat lookalikes, maintainer key churn, and Scorecard provenance gaps.
                  </p>
                </div>
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-zinc-950 border border-zinc-800 text-zinc-300 tabular-nums">
                  {watchdogFindings.length} Alert{watchdogFindings.length === 1 ? "" : "s"}
                </span>
              </div>
              {watchdogFindings.length === 0 ? (
                <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/25 text-xs text-emerald-300">
                  All scanned packages passed behavioral install-hook, typosquat, and provenance checks.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {watchdogFindings.map((finding) => (
                    <div key={finding.id} className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-bold text-white">{finding.packageName}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          {finding.severity} · {finding.category}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-200 font-semibold">{finding.title}</div>
                      <p className="text-[11px] text-zinc-400">{finding.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })()}

        {/* CVE Advisory Detail Slide-Over Drawer */}
        {inspectedVuln && (
          <div
            onClick={() => setInspectedVuln(null)}
            className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex justify-end"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="devpulse-modal-panel w-full max-w-md h-full bg-zinc-900 border-l border-zinc-800 p-6 flex flex-col justify-between overflow-y-auto shadow-2xl"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-zinc-800">
                  <div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${SEVERITY_BADGE[inspectedVuln.severity]}`}>
                      {inspectedVuln.severity}
                    </span>
                    <h3 className="text-base font-bold text-white font-mono mt-1.5">{inspectedVuln.id}</h3>
                    <p className="text-xs text-cyan-300 font-mono">
                      {inspectedVuln.packageName}@{inspectedVuln.version || "latest"} ({inspectedVuln.ecosystem})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectedVuln(null)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Advisory Summary
                  </div>
                  <p className="text-xs text-zinc-200 leading-relaxed">{inspectedVuln.summary}</p>
                </div>

                {inspectedVuln.fixedVersion && (
                  <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                      Remediation Upgrade Path
                    </div>
                    <code className="block text-xs font-mono text-emerald-200 bg-zinc-950 px-2.5 py-2 rounded-lg border border-zinc-800">
                      Upgrade {inspectedVuln.packageName} &rarr; {inspectedVuln.fixedVersion}
                    </code>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-zinc-800 flex items-center gap-2">
                <a
                  href={inspectedVuln.referenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 font-semibold text-center inline-flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>View on OSV.dev</span>
                </a>
                <button
                  type="button"
                  disabled={busyKey === `${inspectedVuln.packageName}:${inspectedVuln.id}`}
                  onClick={() => void handleOpenFixPr(inspectedVuln)}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <GitPullRequest className="w-3.5 h-3.5" />
                  <span>Open Fix PR</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
