import React from "react";
import { ShieldCheck, ShieldAlert, Award, Scale } from "lucide-react";
import type { DepsDevAdvisorySummary } from "@/lib/integrations/deps-dev";

interface PackageSecurityBadgeProps {
  summary?: DepsDevAdvisorySummary | null;
}

export function PackageSecurityBadge({ summary }: PackageSecurityBadgeProps) {
  if (!summary) return null;

  const hasCves = summary.advisoryCount > 0;
  const primaryLicense = summary.licenses?.[0] || null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border ${
          hasCves
            ? "bg-red-950/60 border-red-500/40 text-red-300"
            : "bg-emerald-950/50 border-emerald-500/30 text-emerald-300"
        }`}
        title={
          hasCves
            ? `${summary.advisoryCount} OSV.dev advisory(ies) found for ${summary.packageName}`
            : "Verified 0 known OSV.dev advisories via deps.dev"
        }
      >
        {hasCves ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
        <span>{hasCves ? `${summary.advisoryCount} CVE` : "0 CVEs"}</span>
      </span>

      {typeof summary.scorecardOverall === "number" && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-cyan-300"
          title="OpenSSF Scorecard rating via deps.dev"
        >
          <Award className="w-3 h-3 text-cyan-400" />
          <span>OSSF {summary.scorecardOverall.toFixed(1)}/10</span>
        </span>
      )}

      {primaryLicense && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-300">
          <Scale className="w-3 h-3 text-zinc-400" />
          <span>{primaryLicense}</span>
        </span>
      )}
    </div>
  );
}
