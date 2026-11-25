"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  ChevronRight,
  X,
  Terminal,
  Clock,
  ShieldAlert,
  HardDrive,
  Paperclip,
  Download,
  Loader2,
  Play,
  RotateCcw,
  EyeOff,
  Layers,
} from "lucide-react";
import { formatDate, formatTime } from "@/lib/utils/format";

export interface ErrorEventItem {
  id: string;
  errorName: string;
  message: string;
  stackTrace?: string | null;
  runtime: string;
  version?: string | null;
  os?: string | null;
  environment?: string | null;
  status: "unresolved" | "resolved" | "ignored";
  attachmentUrl?: string | null;
  r2ObjectKey?: string | null;
  payloadSizeBytes?: number;
  storageProvider?: string | null;
  reporterEmail?: string | null;
  breadcrumbsJson?: string | null;
  commitSha?: string | null;
  createdAt: string;
}

interface IssueGroup {
  fingerprint: string;
  errorName: string;
  latestMessage: string;
  runtime: string;
  status: "unresolved" | "resolved" | "ignored";
  count: number;
  firstSeen: string;
  lastSeen: string;
  versions: string[];
  oses: string[];
  events: ErrorEventItem[];
  latest: ErrorEventItem;
}

interface ErrorStreamCardProps {
  initialErrors: ErrorEventItem[];
  projectId: string;
  telemetryApiKey?: string;
}

function formatBytesShort(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function groupErrorsIntoIssues(items: ErrorEventItem[]): IssueGroup[] {
  const map = new Map<string, ErrorEventItem[]>();
  for (const err of items) {
    const cleanName = err.errorName.split(":")[0].trim() || "RuntimeError";
    const fp = `${cleanName}::${err.runtime}`;
    const list = map.get(fp) || [];
    list.push(err);
    map.set(fp, list);
  }

  const groups: IssueGroup[] = [];
  for (const [fingerprint, evs] of map.entries()) {
    const sorted = [...evs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const latest = sorted[0];
    const earliest = sorted[sorted.length - 1];
    const hasUnresolved = sorted.some((e) => e.status === "unresolved");
    const status: "unresolved" | "resolved" | "ignored" = hasUnresolved
      ? "unresolved"
      : sorted[0].status;

    groups.push({
      fingerprint,
      errorName: latest.errorName.split(":")[0].trim() || latest.errorName,
      latestMessage: latest.message,
      runtime: latest.runtime,
      status,
      count: sorted.length,
      firstSeen: earliest.createdAt,
      lastSeen: latest.createdAt,
      versions: Array.from(new Set(sorted.map((e) => e.version).filter(Boolean) as string[])),
      oses: Array.from(new Set(sorted.map((e) => e.os).filter(Boolean) as string[])),
      events: sorted,
      latest,
    });
  }

  return groups.sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
  );
}

export function ErrorStreamCard({
  initialErrors,
  projectId,
  telemetryApiKey,
}: ErrorStreamCardProps) {
  const [errors, setErrors] = useState<ErrorEventItem[]>(initialErrors);
  const [statusFilter, setStatusFilter] = useState<"all" | "unresolved" | "resolved" | "ignored">("all");
  const [selectedGroup, setSelectedGroup] = useState<IssueGroup | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ErrorEventItem | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [copiedBeacon, setCopiedBeacon] = useState(false);

  const [fullPayload, setFullPayload] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [attachmentSignedUrl, setAttachmentSignedUrl] = useState<string | null>(null);
  const [loadingR2, setLoadingR2] = useState(false);

  useEffect(() => {
    setErrors(initialErrors);
  }, [initialErrors]);

  const issueGroups = useMemo(() => groupErrorsIntoIssues(errors), [errors]);
  const filteredGroups = useMemo(() => {
    if (statusFilter === "all") return issueGroups;
    return issueGroups.filter((g) => g.status === statusFilter);
  }, [issueGroups, statusFilter]);

  useEffect(() => {
    const activeErr = selectedEvent || selectedGroup?.latest || null;
    if (!activeErr) {
      setFullPayload(null);
      setDownloadUrl(null);
      setAttachmentSignedUrl(null);
      return;
    }

    let cancelled = false;
    async function loadR2Assets(errItem: ErrorEventItem) {
      if (!errItem.r2ObjectKey && !errItem.attachmentUrl) {
        setFullPayload(null);
        setDownloadUrl(null);
        setAttachmentSignedUrl(null);
        return;
      }
      setLoadingR2(true);
      try {
        if (errItem.r2ObjectKey) {
          const res = await fetch(
            `/api/v1/storage/attachment?eventId=${encodeURIComponent(errItem.id)}&kind=payload`
          );
          if (res.ok && !cancelled) {
            const data = await res.json();
            setFullPayload(data.content || errItem.stackTrace || null);
            setDownloadUrl(data.downloadUrl || null);
          }
        }
        if (errItem.attachmentUrl) {
          const res = await fetch(
            `/api/v1/storage/attachment?eventId=${encodeURIComponent(errItem.id)}&kind=attachment`
          );
          if (res.ok && !cancelled) {
            const data = await res.json();
            setAttachmentSignedUrl(data.url || null);
          }
        }
      } catch {
        // fallback cleanly
      } finally {
        if (!cancelled) setLoadingR2(false);
      }
    }

    loadR2Assets(activeErr);
    return () => {
      cancelled = true;
    };
  }, [selectedEvent, selectedGroup]);

  const unresolvedCount = issueGroups.filter((g) => g.status === "unresolved").length;

  const updateIssueStatus = async (
    eventIds: string[],
    nextStatus: "unresolved" | "resolved" | "ignored",
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    const idSet = new Set(eventIds);
    setErrors((prev) =>
      prev.map((item) => (idSet.has(item.id) ? { ...item, status: nextStatus } : item))
    );
    if (selectedGroup) {
      setSelectedGroup({
        ...selectedGroup,
        status: nextStatus,
        events: selectedGroup.events.map((ev) => ({ ...ev, status: nextStatus })),
      });
    }

    for (const id of eventIds.slice(0, 10)) {
      fetch("/api/v1/event", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: id, projectId, status: nextStatus }),
      }).catch(() => {});
    }
  };

  const simulateCrashEvent = async () => {
    if (!telemetryApiKey || telemetryApiKey.startsWith("revoked_")) return;
    setSimulating(true);
    try {
      const sampleStack = [
        "TypeError: Cannot read properties of undefined (reading 'sessionToken')",
        "    at AuthVerifier.verifySession (src/auth/verifier.ts:84:19)",
        "    at processRequest (src/edge/router.ts:142:11)",
        "    at async Object.fetch (src/worker.ts:38:5)",
      ].join("\n");

      const sampleCrumbs = [
        { timestamp: new Date(Date.now() - 3200).toISOString(), category: "ui.click", level: "info", message: "Clicked <button> Verify Telemetry" },
        { timestamp: new Date(Date.now() - 1400).toISOString(), category: "http", level: "warning", message: "GET /api/v1/session -> 401" },
        { timestamp: new Date().toISOString(), category: "console", level: "error", message: "AuthVerifier threw SessionVerificationError" },
      ];

      const res = await fetch("/api/v1/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: telemetryApiKey,
          errorName: "SessionVerificationError",
          message: "Simulated Sentry diagnostic event from DevPulse Command Center",
          stackTrace: sampleStack,
          runtime: "node 22.x",
          version: "v1.0.0",
          commitSha: "f5b5fc4",
          os: typeof navigator !== "undefined" ? navigator.platform : "Edge",
          environment: "production",
          breadcrumbs: sampleCrumbs,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const synthetic: ErrorEventItem = {
          id: d.eventId || `err_${Date.now()}`,
          errorName: "SessionVerificationError",
          message: "Simulated Sentry diagnostic event from DevPulse Command Center",
          stackTrace: sampleStack,
          runtime: "node 22.x",
          version: "v1.0.0",
          commitSha: "f5b5fc4",
          breadcrumbsJson: JSON.stringify(sampleCrumbs),
          os: typeof navigator !== "undefined" ? navigator.platform : "Edge",
          environment: "production",
          status: "unresolved",
          createdAt: new Date().toISOString(),
        };
        setErrors((prev) => [synthetic, ...prev]);
      }
    } finally {
      setSimulating(false);
    }
  };

  const testBeaconCommand = `curl -X POST https://devpulse.ritualdev.in/api/v1/event -H "Content-Type: application/json" -d '{"apiKey":"${telemetryApiKey || "YOUR_KEY"}","errorName":"UnhandledError","runtime":"node","message":"Crash report test"}'`;

  const copyTestBeacon = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(testBeaconCommand);
      setCopiedBeacon(true);
      setTimeout(() => setCopiedBeacon(false), 2000);
    }
  };

  const inspectedEvent = selectedEvent || selectedGroup?.latest || null;

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700/80 transition">
      <div>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400">
              <AlertOctagon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight flex items-center gap-2">
                <span>Sentry Issue Stream</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  {issueGroups.length} issues
                </span>
              </h3>
              <p className="text-xs text-zinc-400">
                Fingerprinted crash grouping &bull; R2 stack trace offload
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {telemetryApiKey && !telemetryApiKey.startsWith("revoked_") && (
              <button
                type="button"
                disabled={simulating}
                onClick={simulateCrashEvent}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-zinc-200 transition disabled:opacity-50"
                title="Send a live crash event to verify telemetry & alerts"
              >
                {simulating ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3 text-emerald-400" />
                )}
                <span>Test Crash</span>
              </button>
            )}
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                unresolvedCount > 0
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {unresolvedCount > 0 ? `${unresolvedCount} Unresolved` : "All Clear"}
            </span>
          </div>
        </div>

        {/* Status Filter Bar */}
        {errors.length > 0 && (
          <div className="flex items-center gap-1 mb-3 bg-zinc-950/80 p-1 rounded-xl border border-zinc-800 w-fit text-[11px]">
            {(["all", "unresolved", "resolved", "ignored"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-2.5 py-1 rounded-lg capitalize font-medium transition ${
                  statusFilter === tab
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* Grouped Issues List */}
        {filteredGroups.length === 0 ? (
          <div className="py-5 px-4 text-center rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-400 mb-2" />
            <p className="text-sm font-semibold text-white">
              {errors.length === 0 ? "Zero Crashes Recorded" : `No ${statusFilter} issues`}
            </p>
            <p className="text-xs text-zinc-400 mt-1 max-w-sm">
              Connect the DevPulse SDK (Python, Node, Rust, React/Electron, or CLI) or click{" "}
              <strong className="text-zinc-200">Test Crash</strong> to verify ingest.
            </p>
            <div className="w-full mt-3 flex items-center justify-between gap-2 p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300">
              <span className="truncate text-left text-zinc-400 select-all">
                {testBeaconCommand}
              </span>
              <button
                type="button"
                onClick={copyTestBeacon}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition"
              >
                {copiedBeacon ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {filteredGroups.map((group) => (
              <div
                key={group.fingerprint}
                onClick={() => {
                  setSelectedGroup(group);
                  setSelectedEvent(group.latest);
                }}
                className={`p-3 rounded-xl border transition cursor-pointer text-left flex items-start justify-between gap-3 ${
                  group.status === "resolved"
                    ? "bg-zinc-950/40 border-zinc-800/40 opacity-65 hover:opacity-100"
                    : "bg-zinc-950/80 border-zinc-800 hover:border-indigo-500/40"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-red-950/80 border border-red-800/60 text-red-300 font-semibold truncate max-w-[190px]">
                      {group.errorName}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
                      &times;{group.count}
                    </span>
                    <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      {group.runtime}
                    </span>
                    {group.latest.r2ObjectKey && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">
                        <HardDrive className="w-2.5 h-2.5" />
                        <span>{formatBytesShort(group.latest.payloadSizeBytes) || "R2"}</span>
                      </span>
                    )}
                    {group.latest.attachmentUrl && (
                      <Paperclip className="w-3 h-3 text-cyan-400" />
                    )}
                  </div>
                  <p className="text-xs text-zinc-200 font-medium truncate">
                    {group.latestMessage}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-1">
                    {group.oses[0] && <span>OS: {group.oses.join(", ")}</span>}
                    <span className="flex items-center gap-1" suppressHydrationWarning>
                      <Clock className="w-3 h-3" />
                      Last seen {formatTime(group.lastSeen)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 pt-1">
                  {group.status === "unresolved" && (
                    <button
                      onClick={(e) =>
                        updateIssueStatus(
                          group.events.map((ev) => ev.id),
                          "resolved",
                          e
                        )
                      }
                      title="Resolve Issue"
                      className="text-zinc-500 hover:text-emerald-400 p-1 rounded hover:bg-zinc-800 transition"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span>SHA-256 Auth &bull; 500 req/min rate-limited</span>
        <span className="text-zinc-400 font-mono text-[10px]">POST /api/v1/event</span>
      </div>

      {/* Sentry-Grade Issue Detail Modal */}
      {selectedGroup && inspectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-3xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-950 border border-red-800 flex items-center justify-center text-red-400">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-white text-base">{selectedGroup.errorName}</h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {selectedGroup.count} occurrences
                    </span>
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-semibold">
                      {selectedGroup.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5" suppressHydrationWarning>
                    First seen {formatDate(selectedGroup.firstSeen)} &bull; Latest {formatDate(inspectedEvent.createdAt)} {formatTime(inspectedEvent.createdAt)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {selectedGroup.status !== "resolved" ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateIssueStatus(
                        selectedGroup.events.map((ev) => ev.id),
                        "resolved"
                      )
                    }
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Resolve</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      updateIssueStatus(
                        selectedGroup.events.map((ev) => ev.id),
                        "unresolved"
                      )
                    }
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reopen</span>
                  </button>
                )}
                {selectedGroup.status !== "ignored" && (
                  <button
                    type="button"
                    onClick={() =>
                      updateIssueStatus(
                        selectedGroup.events.map((ev) => ev.id),
                        "ignored"
                      )
                    }
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Ignore</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedGroup(null);
                    setSelectedEvent(null);
                  }}
                  className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Event Selector if multiple occurrences */}
            {selectedGroup.events.length > 1 && (
              <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
                <span className="text-[11px] text-zinc-400 flex items-center gap-1 shrink-0">
                  <Layers className="w-3 h-3" /> Occurrences:
                </span>
                {selectedGroup.events.slice(0, 8).map((ev, idx) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => setSelectedEvent(ev)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono shrink-0 transition ${
                      inspectedEvent.id === ev.id
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
                    }`}
                  >
                    #{selectedGroup.events.length - idx} &bull; {ev.os || ev.runtime}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs mb-3">
              <div>
                <span className="text-zinc-500 block text-[10px]">Runtime</span>
                <span className="text-zinc-200 font-mono">{inspectedEvent.runtime}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">OS / Platform</span>
                <span className="text-zinc-200 truncate block">{inspectedEvent.os || "Unknown"}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">Version</span>
                <span className="text-zinc-200 font-mono">{inspectedEvent.version || "N/A"}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">Release / Commit</span>
                <span className="text-emerald-300 font-mono">
                  {inspectedEvent.version || "N/A"}
                  {inspectedEvent.commitSha ? ` (${inspectedEvent.commitSha.slice(0, 7)})` : ""}
                </span>
              </div>
            </div>

            {inspectedEvent.breadcrumbsJson && (() => {
              try {
                const crumbs = JSON.parse(inspectedEvent.breadcrumbsJson) as Array<{
                  timestamp?: string;
                  category?: string;
                  level?: string;
                  message?: string;
                }>;
                if (!Array.isArray(crumbs) || crumbs.length === 0) return null;
                return (
                  <div className="mb-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                      Breadcrumbs Timeline ({crumbs.length})
                    </span>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {crumbs.map((c, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-[11px] font-mono">
                          <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-300 shrink-0">
                            {c.category || "log"}
                          </span>
                          <span className="text-zinc-300 truncate flex-1">{c.message}</span>
                          {c.timestamp && (
                            <span className="text-zinc-500 shrink-0">
                              {formatTime(c.timestamp)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              } catch {
                return null;
              }
            })()}

            <div className="mb-3">
              <p className="text-xs sm:text-sm text-red-300 font-mono bg-red-950/30 p-3 rounded-xl border border-red-900/40">
                {inspectedEvent.message}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Stack Trace Frames &amp; Diagnostics</span>
                    {inspectedEvent.r2ObjectKey && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 font-mono">
                        {formatBytesShort(inspectedEvent.payloadSizeBytes)} via {inspectedEvent.storageProvider || "R2"}
                      </span>
                    )}
                  </span>
                  {downloadUrl && (
                    <a
                      href={downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-purple-300 hover:text-purple-200 transition"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download Raw R2 Log</span>
                    </a>
                  )}
                </div>

                {loadingR2 ? (
                  <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center gap-2 text-xs text-zinc-400">
                    <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                    <span>Fetching full payload from Cloudflare R2...</span>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-[11px] overflow-x-auto max-h-60 space-y-1">
                    {(fullPayload ?? inspectedEvent.stackTrace ?? "No stack trace captured.")
                      .split("\n")
                      .map((line, idx) => {
                        const isAppFrame = line.includes("src/") || line.includes("app/");
                        return (
                          <div
                            key={idx}
                            className={`px-2 py-0.5 rounded ${
                              idx === 0
                                ? "text-red-300 font-semibold"
                                : isAppFrame
                                ? "bg-indigo-950/50 text-indigo-200 border-l-2 border-indigo-400"
                                : "text-zinc-400"
                            } whitespace-pre-wrap break-words`}
                          >
                            {line}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {attachmentSignedUrl && (
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Attached Diagnostics / Screenshot</span>
                    </span>
                    <a
                      href={attachmentSignedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 underline text-[11px]"
                    >
                      Open Presigned URL
                    </a>
                  </div>
                  {/\.(png|jpe?g|gif|webp)(\?|$)/i.test(inspectedEvent.attachmentUrl || "") && (
                    <img
                      src={attachmentSignedUrl}
                      alt="Crash report attachment"
                      className="max-h-48 rounded-lg border border-zinc-800 object-contain"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
