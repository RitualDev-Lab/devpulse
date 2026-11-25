"use client";

import React, { useState } from "react";
import { AlertOctagon, CheckCircle2, ChevronRight, X, Terminal, Clock, ShieldAlert } from "lucide-react";
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
  reporterEmail?: string | null;
  createdAt: string;
}

interface ErrorStreamCardProps {
  initialErrors: ErrorEventItem[];
  projectId: string;
  telemetryApiKey?: string;
}

export function ErrorStreamCard({ initialErrors, projectId, telemetryApiKey }: ErrorStreamCardProps) {
  const [errors, setErrors] = useState<ErrorEventItem[]>(initialErrors);
  const [selectedError, setSelectedError] = useState<ErrorEventItem | null>(null);
  const [copiedBeacon, setCopiedBeacon] = useState(false);

  const unresolvedCount = errors.filter((e) => e.status === "unresolved").length;

  const updateErrorStatus = async (
    id: string,
    status: "resolved" | "ignored" | "unresolved",
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    const prevSnapshot = errors;
    setErrors((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    if (selectedError?.id === id) {
      setSelectedError((prev) => (prev ? { ...prev, status } : null));
    }

    try {
      const res = await fetch(`/api/v1/errors/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        // Revert optimistic update only on explicit non-demo persistence failure
        setErrors(prevSnapshot);
      }
    } catch {
      setErrors(prevSnapshot);
    }
  };

  const testBeaconCommand = `curl -X POST https://devpulse.ritualdev.in/api/v1/event -H "Content-Type: application/json" -d '{"api_key":"${telemetryApiKey || "YOUR_KEY"}","error_name":"FirstTestError","message":"Verifying DevPulse crash telemetry ingest"}'`;

  const copyTestBeacon = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(testBeaconCommand);
      setCopiedBeacon(true);
      setTimeout(() => setCopiedBeacon(false), 2000);
    }
  };

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400">
              <AlertOctagon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight">
                Crash Telemetry & Bug Reports
              </h3>
              <p className="text-xs text-zinc-400">Live package runtime diagnostics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                unresolvedCount > 0
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {unresolvedCount > 0 ? `${unresolvedCount} Active Issues` : "All Clear"}
            </span>
          </div>
        </div>

        {/* Error Items List */}
        {errors.length === 0 ? (
          <div className="py-6 px-4 text-center rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-400 mb-2" />
            <p className="text-sm font-semibold text-white">Zero Crashes Recorded</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-sm">
              Your runtime telemetry is active and waiting for crash events. Test sending your first crash beacon:
            </p>
            <div className="w-full mt-3 flex items-center justify-between gap-2 p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300">
              <span className="truncate text-left text-zinc-400 select-all">{testBeaconCommand}</span>
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
          <div className="space-y-2.5 max-h-[310px] overflow-y-auto pr-1">
            {errors.map((err) => (
              <div
                key={err.id}
                onClick={() => setSelectedError(err)}
                className={`p-3 rounded-xl border transition cursor-pointer text-left flex items-start justify-between gap-3 ${
                  err.status === "resolved"
                    ? "bg-zinc-950/40 border-zinc-800/40 opacity-60 hover:opacity-100"
                    : "bg-zinc-950/80 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400 font-semibold truncate max-w-[200px]">
                      {err.errorName.split(":")[0]}
                    </span>
                    <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      {err.runtime}
                    </span>
                    {err.version && (
                      <span className="text-[10px] text-zinc-400 font-mono">{err.version}</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-200 font-medium truncate">{err.message}</p>
                  <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-1.5">
                    {err.os && <span>OS: {err.os}</span>}
                    <span className="flex items-center gap-1" suppressHydrationWarning>
                      <Clock className="w-3 h-3" />
                      {formatTime(err.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 pt-1">
                  {err.status === "unresolved" && (
                    <button
                      onClick={(e) => updateErrorStatus(err.id, "resolved", e)}
                      title="Mark as Resolved"
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
        <span>DevPulse Telemetry Ingest</span>
        <span className="text-zinc-400 font-mono text-[10px]">Endpoint: /api/v1/event</span>
      </div>

      {/* Stack Trace Modal */}
      {selectedError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-950 border border-red-800 flex items-center justify-center text-red-400">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">{selectedError.errorName}</h3>
                  <p className="text-xs text-zinc-400" suppressHydrationWarning>
                    Reported on {formatDate(selectedError.createdAt)} {formatTime(selectedError.createdAt)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedError(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs mb-4">
              <div>
                <span className="text-zinc-500 block text-[10px]">Runtime:</span>
                <span className="text-zinc-200 font-mono">{selectedError.runtime}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">System OS:</span>
                <span className="text-zinc-200 truncate block">{selectedError.os || "Unknown"}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">Package Version:</span>
                <span className="text-zinc-200 font-mono">{selectedError.version || "N/A"}</span>
              </div>
            </div>

            <div className="mb-2">
              <span className="text-xs text-zinc-400 font-medium">Error Message:</span>
              <p className="text-sm text-red-300 font-mono bg-red-950/30 p-2.5 rounded-lg border border-red-900/40 mt-1">
                {selectedError.message}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto mt-2">
              <span className="text-xs text-zinc-400 font-medium flex items-center gap-1.5 mb-1">
                <Terminal className="w-3.5 h-3.5 text-zinc-400" /> Stack Trace
              </span>
              <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300 font-mono text-[11px] overflow-x-auto whitespace-pre leading-relaxed select-text">
                {selectedError.stackTrace || "No stack trace provided by reporter."}
              </pre>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {selectedError.attachmentUrl && (
                  <a
                    href={`/api/v1/attachments/${encodeURIComponent(selectedError.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs font-medium transition"
                  >
                    Download R2 Log Attachment
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedError.status !== "resolved" ? (
                  <button
                    onClick={() => updateErrorStatus(selectedError.id, "resolved")}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition"
                  >
                    Mark Resolved
                  </button>
                ) : (
                  <button
                    onClick={() => updateErrorStatus(selectedError.id, "unresolved")}
                    className="px-3.5 py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 text-xs font-medium transition"
                  >
                    Reopen Issue
                  </button>
                )}
                <button
                  onClick={() => setSelectedError(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
