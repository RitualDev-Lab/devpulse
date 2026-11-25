import React from "react";
import { Cpu, Wrench, Layers, Radio, CheckCircle2, CircleDashed, ExternalLink } from "lucide-react";
import type { McpServerStats } from "@/lib/integrations/mcp";

interface McpStatsCardProps {
  stats: McpServerStats | null;
  serverName: string;
}

export function McpStatsCard({ stats, serverName }: McpStatsCardProps) {
  if (!stats) {
    return (
      <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-zinc-400">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-zinc-200">MCP Server</span>
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Offline</span>
        </div>
        <p className="text-sm">Unable to query MCP registry status for {serverName}.</p>
      </div>
    );
  }

  const registryEntries = [
    { key: "mcpshelf", label: "MCPShelf", active: stats.registries.mcpshelf, submitUrl: "https://mcp.ritualdev.in" },
    { key: "glama", label: "Glama.ai", active: stats.registries.glama, submitUrl: "https://glama.ai/mcp/servers" },
    { key: "smithery", label: "Smithery.ai", active: stats.registries.smithery, submitUrl: "https://smithery.ai" },
  ];

  const anyIndexed = registryEntries.some((r) => r.active);

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-950/80 border border-teal-800/60 flex items-center justify-center text-teal-400">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight">
                {stats.displayName || "MCP Server"}
              </h3>
              <p className="text-xs text-zinc-400 font-mono">{stats.serverName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats.protocolVersion && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 font-mono font-medium">
                MCP {stats.protocolVersion}
              </span>
            )}
            {stats.registryUrl && (
              <a
                href={stats.registryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
                title="View on Registry"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* 3 Real Metric Stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-3.5">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Exposed Tools</span>
            <div className="flex items-center gap-1 text-teal-400 font-bold text-sm">
              <Wrench className="w-3.5 h-3.5" />
              <span>{stats.toolsCount !== null ? `${stats.toolsCount}` : "—"}</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Resources</span>
            <div className="flex items-center gap-1 text-zinc-200 font-bold text-sm">
              <Layers className="w-3.5 h-3.5 text-zinc-400" />
              <span>{stats.resourcesCount !== null ? `${stats.resourcesCount}` : "—"}</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Transport</span>
            <div className="flex items-center gap-1 text-cyan-400 font-semibold text-xs font-mono">
              <Radio className="w-3 h-3" />
              <span>{stats.transport}</span>
            </div>
          </div>
        </div>

        {/* Live Registry Indexing Badges */}
        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 mb-3 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1.5">
            Live Registry Indexing Status
          </span>
          <div className="flex flex-wrap gap-2">
            {registryEntries.map((reg) => (
              <a
                key={reg.key}
                href={reg.submitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] transition ${
                  reg.active
                    ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {reg.active ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ) : (
                  <CircleDashed className="w-3 h-3 text-zinc-600" />
                )}
                <span>{reg.label}</span>
              </a>
            ))}
          </div>
        </div>

        {stats.supportedClients.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="text-zinc-500">Clients:</span>
            {stats.supportedClients.map((client) => (
              <span
                key={client}
                className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 font-mono text-[10px]"
              >
                {client}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span>MCP Registry Check</span>
        <span className={anyIndexed ? "text-teal-400 font-medium" : "text-amber-400 font-medium"}>
          {stats.status === "verified"
            ? "Verified Multi-Registry"
            : stats.status === "indexed"
              ? "Indexed"
              : "Not Listed Yet"}
        </span>
      </div>
    </div>
  );
}
