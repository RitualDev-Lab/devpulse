"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Workflow,
  Search,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Terminal,
  Copy,
  Check,
  Sparkles,
  Loader2,
  Bug,
  X,
} from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";
import { maskApiKey } from "@/lib/security/mask-key";

interface TraceRow {
  id: string;
  traceId: string;
  serviceName: string;
  rootSpanName: string;
  status: "ok" | "error" | "unset";
  spanCount: number;
  durationMs: number;
  startedAt: string;
  httpMethod: string | null;
  httpRoute: string | null;
  httpStatusCode: number | null;
  linkedErrorId: string | null;
}

interface SpanRow {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  serviceName: string;
  spanName: string;
  kind: string;
  statusCode: string;
  statusMessage: string | null;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  attributesJson: string | null;
  eventsJson: string | null;
}

interface LinkedErrorSummary {
  id: string;
  errorName: string;
  message: string;
  runtime: string;
  version: string | null;
  routePath: string | null;
  createdAt: string;
}

const SERVICE_COLORS = [
  "bg-indigo-500 border-indigo-400",
  "bg-cyan-500 border-cyan-400",
  "bg-emerald-500 border-emerald-400",
  "bg-purple-500 border-purple-400",
  "bg-amber-500 border-amber-400",
];

function computeSpanDepthMap(spans: SpanRow[]): Map<string, number> {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depths = new Map<string, number>();

  function getDepth(spanId: string, seen = new Set<string>()): number {
    if (depths.has(spanId)) return depths.get(spanId)!;
    if (seen.has(spanId)) return 0;
    seen.add(spanId);
    const sp = byId.get(spanId);
    if (!sp || !sp.parentSpanId || !byId.has(sp.parentSpanId)) {
      depths.set(spanId, 0);
      return 0;
    }
    const d = getDepth(sp.parentSpanId, seen) + 1;
    depths.set(spanId, d);
    return d;
  }

  for (const s of spans) getDepth(s.spanId);
  return depths;
}

export function TracesFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;
  const searchParams = useSearchParams();
  const initialTraceId = searchParams.get("traceId") || "";

  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState(initialTraceId);
  const [selectedSpans, setSelectedSpans] = useState<SpanRow[]>([]);
  const [linkedErrors, setLinkedErrors] = useState<LinkedErrorSummary[]>([]);
  const [inspectedSpan, setInspectedSpan] = useState<SpanRow | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "error" | "ok">("all");
  const [httpBucket, setHttpBucket] = useState<"all" | "2xx" | "4xx" | "5xx">("all");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sendingSample, setSendingSample] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const loadTraces = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch(`/api/v1/traces?projectId=${encodeURIComponent(project.id)}`);
      const data = await res.json();
      if (res.ok) {
        const list = (data.traces || []) as TraceRow[];
        setTraces(list);
        if (!selectedTraceId && list.length > 0) {
          setSelectedTraceId(list[0].traceId);
        }
      }
    } finally {
      setLoadingList(false);
    }
  }, [project.id, selectedTraceId]);

  const loadTraceDetail = useCallback(async () => {
    if (!selectedTraceId) {
      setSelectedSpans([]);
      setLinkedErrors([]);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await fetch(
        `/api/v1/traces?projectId=${encodeURIComponent(project.id)}&traceId=${encodeURIComponent(selectedTraceId)}`
      );
      const data = await res.json();
      if (res.ok) {
        const spans = (data.spans || []) as SpanRow[];
        setSelectedSpans(spans);
        setLinkedErrors(data.linkedErrors || []);
        setInspectedSpan(spans[0] || null);
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [project.id, selectedTraceId]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    loadTraceDetail();
  }, [loadTraceDetail]);

  const filteredTraces = useMemo(() => {
    return traces.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (httpBucket !== "all") {
        const code = t.httpStatusCode ?? (t.status === "error" ? 500 : 200);
        if (httpBucket === "2xx" && (code < 200 || code >= 300)) return false;
        if (httpBucket === "4xx" && (code < 400 || code >= 500)) return false;
        if (httpBucket === "5xx" && code < 500) return false;
      }
      if (searchQ.trim()) {
        const q = searchQ.toLowerCase();
        return (
          t.traceId.toLowerCase().includes(q) ||
          t.rootSpanName.toLowerCase().includes(q) ||
          t.serviceName.toLowerCase().includes(q) ||
          (t.httpRoute || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [traces, statusFilter, httpBucket, searchQ]);

  const waterfallMeta = useMemo(() => {
    if (selectedSpans.length === 0) {
      return { minStart: 0, totalDuration: 1, depthMap: new Map<string, number>(), serviceColorMap: new Map<string, string>() };
    }
    const minStart = Math.min(...selectedSpans.map((s) => s.startTimeMs));
    const maxEnd = Math.max(...selectedSpans.map((s) => s.endTimeMs));
    const totalDuration = Math.max(1, maxEnd - minStart);
    const depthMap = computeSpanDepthMap(selectedSpans);

    const services = Array.from(new Set(selectedSpans.map((s) => s.serviceName)));
    const serviceColorMap = new Map<string, string>();
    services.forEach((svc, idx) => {
      serviceColorMap.set(svc, SERVICE_COLORS[idx % SERVICE_COLORS.length]);
    });

    return { minStart, totalDuration, depthMap, serviceColorMap };
  }, [selectedSpans]);

  const handleSendSampleTrace = async () => {
    if (isDemo) return;
    setSendingSample(true);
    try {
      const res = await fetch("/api/v1/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await res.json();
      if (res.ok && d.traceId) {
        await loadTraces();
        setSelectedTraceId(d.traceId);
      }
    } finally {
      setSendingSample(false);
    }
  };

  const otlpEndpoint = `${PUBLIC_APP_URL}/api/v1/ingest/otlp/traces`;
  const otlpSnippet = `export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${otlpEndpoint}"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${maskApiKey(project.telemetryApiKey, "YOUR_API_KEY")}"`;

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <Workflow className="w-6 h-6 text-cyan-400" />
              <span>Distributed Tracing (OpenTelemetry OTLP)</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Jaeger / Tempo-style flame graph waterfall linked directly to crash events via <code className="text-zinc-200">traceId</code>.
            </p>
          </div>
          {!isDemo && (
            <button
              type="button"
              disabled={sendingSample}
              onClick={handleSendSampleTrace}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 text-xs font-semibold transition"
            >
              {sendingSample ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>Emit Sample Multi-Service Trace</span>
            </button>
          )}
        </div>

        {/* OTLP Endpoint Quick Config */}
        <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
            <code className="text-[11px] font-mono text-zinc-300 truncate">
              POST {otlpEndpoint} (OTLP/HTTP JSON)
            </code>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(otlpSnippet);
              setCopiedCurl(true);
              setTimeout(() => setCopiedCurl(false), 1500);
            }}
            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-white font-semibold flex items-center gap-1.5 shrink-0"
          >
            {copiedCurl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedCurl ? "Copied OTLP Env" : "Copy OTEL Env Config"}</span>
          </button>
        </div>

        {/* Split Trace Explorer + Flame Graph Waterfall */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Trace List */}
          <div className="lg:col-span-4 p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Filter service, route, traceId..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white"
              >
                <option value="all">All</option>
                <option value="error">Errors</option>
                <option value="ok">OK</option>
              </select>
            </div>
            <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-[10px] font-mono">
              {(["all", "2xx", "4xx", "5xx"] as const).map((bucket) => (
                <button
                  key={bucket}
                  type="button"
                  onClick={() => setHttpBucket(bucket)}
                  className={`flex-1 py-1 rounded-lg uppercase font-semibold transition ${
                    httpBucket === bucket
                      ? bucket === "5xx"
                        ? "bg-red-600 text-white"
                        : bucket === "4xx"
                        ? "bg-amber-600 text-white"
                        : "bg-cyan-600 text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {bucket === "all" ? "All HTTP" : bucket}
                </button>
              ))}
            </div>

            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {loadingList && traces.length === 0 ? (
                <div className="text-xs text-zinc-500 py-8 text-center">Loading traces...</div>
              ) : filteredTraces.length === 0 ? (
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400 space-y-2">
                  <div>No OpenTelemetry traces recorded yet.</div>
                  <div className="text-[11px] text-zinc-500">
                    Point any OTEL SDK to <code className="text-cyan-300">/api/v1/ingest/otlp/traces</code> or click &ldquo;Emit Sample Multi-Service Trace&rdquo; above.
                  </div>
                </div>
              ) : (
                filteredTraces.map((tr) => {
                  const active = tr.traceId === selectedTraceId;
                  return (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => setSelectedTraceId(tr.traceId)}
                      className={`w-full text-left p-3 rounded-xl border transition space-y-1.5 ${
                        active
                          ? "bg-cyan-600/15 border-cyan-500/50"
                          : "bg-zinc-950 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-white truncate">
                          {tr.rootSpanName}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                            tr.status === "error"
                              ? "bg-red-500/20 text-red-300"
                              : "bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {tr.durationMs}ms
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                        <span>{tr.serviceName}</span>
                        <span>{tr.spanCount} spans</span>
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono truncate">
                        {tr.traceId}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Interactive Flame Graph & Span Inspector */}
          <div className="lg:col-span-8 p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
            {loadingDetail ? (
              <div className="py-12 text-center text-xs text-zinc-400">
                Rendering trace flame graph...
              </div>
            ) : selectedSpans.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-500">
                Select a trace on the left to inspect its service spans &amp; flame graph waterfall.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800">
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      {selectedSpans.some((s) => s.statusCode === "ERROR") ? (
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      )}
                      <span>Trace {selectedTraceId.slice(0, 16)}...</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                      Total Duration: <strong className="text-white">{waterfallMeta.totalDuration}ms</strong> •{" "}
                      {selectedSpans.length} span(s)
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>0ms &rarr; {waterfallMeta.totalDuration}ms</span>
                  </div>
                </div>

                {/* Linked Crash Alert */}
                {linkedErrors.length > 0 && (
                  <div className="p-3 rounded-xl bg-red-950/40 border border-red-700/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-red-200">
                      <Bug className="w-4 h-4 text-red-400 shrink-0" />
                      <span>
                        Linked Crash: <strong>{linkedErrors[0].errorName}</strong> —{" "}
                        {linkedErrors[0].message.slice(0, 100)}
                      </span>
                    </div>
                    <Link
                      href={`/dashboard/crashes?project=${encodeURIComponent(project.slug)}${isDemo ? "&demo=1" : ""}`}
                      className="text-[11px] font-semibold text-red-300 underline"
                    >
                      Inspect Crash &rarr;
                    </Link>
                  </div>
                )}

                {/* Flame Graph / Waterfall Rows */}
                <div className="space-y-1.5">
                  {selectedSpans.map((sp) => {
                    const depth = waterfallMeta.depthMap.get(sp.spanId) || 0;
                    const leftPct = Math.max(
                      0,
                      Math.min(
                        96,
                        ((sp.startTimeMs - waterfallMeta.minStart) / waterfallMeta.totalDuration) * 100
                      )
                    );
                    const widthPct = Math.max(
                      2.5,
                      Math.min(100 - leftPct, (sp.durationMs / waterfallMeta.totalDuration) * 100)
                    );
                    const isErr = sp.statusCode === "ERROR";
                    const svcClass = isErr
                      ? "bg-red-500 border-red-400"
                      : waterfallMeta.serviceColorMap.get(sp.serviceName) || SERVICE_COLORS[0];
                    const isInspected = inspectedSpan?.id === sp.id;

                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => setInspectedSpan(sp)}
                        className={`w-full text-left grid grid-cols-12 items-center gap-2 p-2 rounded-xl border transition ${
                          isInspected
                            ? "bg-zinc-950 border-cyan-500/60"
                            : "bg-zinc-950/60 border-zinc-800/70 hover:border-zinc-700"
                        }`}
                      >
                        <div className="col-span-5 min-w-0 flex items-center gap-1.5">
                          <span
                            style={{ marginLeft: `${Math.min(depth * 14, 56)}px` }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono shrink-0"
                          >
                            {sp.serviceName}
                          </span>
                          <span className="text-xs font-medium text-white truncate">
                            {sp.spanName}
                          </span>
                          {sp.durationMs >= 500 && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold shrink-0">
                              SLOW
                            </span>
                          )}
                        </div>
                        <div className="col-span-6 h-5 rounded bg-zinc-900/90 relative overflow-hidden">
                          <div
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            className={`absolute top-1 bottom-1 rounded border ${svcClass} opacity-90`}
                          />
                        </div>
                        <div className={`col-span-1 text-right text-[11px] font-mono ${sp.durationMs >= 500 ? "text-amber-300 font-bold" : "text-zinc-300"}`}>
                          {sp.durationMs}ms
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Span Attributes & Events Inspector */}
                {inspectedSpan && (
                  <div className="p-4 rounded-xl bg-zinc-950 border border-cyan-500/40 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-white">
                        Span Inspector: {inspectedSpan.spanName} ({inspectedSpan.kind})
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-zinc-400">
                          spanId={inspectedSpan.spanId} • {inspectedSpan.durationMs}ms
                        </span>
                        <button
                          type="button"
                          onClick={() => setInspectedSpan(null)}
                          className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                          title="Close span inspector"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {inspectedSpan.statusMessage && (
                      <div className="p-2 rounded bg-red-950/50 border border-red-800/50 text-red-200 font-mono text-[11px]">
                        Error: {inspectedSpan.statusMessage}
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                          OTEL Span Attributes
                        </div>
                        <pre className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-cyan-200 overflow-x-auto max-h-48">
                          {(() => {
                            try {
                              return JSON.stringify(
                                JSON.parse(inspectedSpan.attributesJson || "{}"),
                                null,
                                2
                              );
                            } catch {
                              return inspectedSpan.attributesJson || "{}";
                            }
                          })()}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                          Span Events &amp; Exceptions
                        </div>
                        <pre className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-emerald-200 overflow-x-auto max-h-48">
                          {(() => {
                            try {
                              return JSON.stringify(
                                JSON.parse(inspectedSpan.eventsJson || "[]"),
                                null,
                                2
                              );
                            } catch {
                              return inspectedSpan.eventsJson || "[]";
                            }
                          })()}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
