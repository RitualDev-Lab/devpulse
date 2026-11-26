"use client";

import React, { useEffect, useState } from "react";
import { Gauge, Sparkles } from "lucide-react";

interface QuotaPayload {
  tier: string;
  entitlements: {
    maxProjects: number | null;
    maxCustomDomains: number;
    storageLimitBytes: number;
  };
  usage: {
    projectCount: number;
    customDomainCount: number;
    storageUsedBytes: number;
    packageConnectorCount?: number;
    heartbeatCount?: number;
    monthlyEventCount?: number;
    seatCount?: number;
  };
  quotas?: {
    maxEventsPerMonth: number;
    maxPackages: number | null;
    maxHeartbeats: number | null;
    maxMembers: number;
  };
}

const DEMO_QUOTA: QuotaPayload = {
  tier: "pro",
  entitlements: {
    maxProjects: 25,
    maxCustomDomains: 1,
    storageLimitBytes: 5 * 1024 * 1024 * 1024,
  },
  usage: {
    projectCount: 3,
    customDomainCount: 1,
    storageUsedBytes: 420 * 1024 * 1024,
    packageConnectorCount: 9,
    heartbeatCount: 4,
    monthlyEventCount: 42_180,
    seatCount: 2,
  },
  quotas: {
    maxEventsPerMonth: 250_000,
    maxPackages: 30,
    maxHeartbeats: 20,
    maxMembers: 5,
  },
};

function MeterBar({
  label,
  used,
  limit,
  formatValue,
}: {
  label: string;
  used: number;
  limit: number | null;
  formatValue?: (n: number) => string;
}) {
  const fmt = formatValue || ((n: number) => n.toLocaleString());
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const barColor =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-white font-semibold">
          {fmt(used)} / {limit === null ? "∞" : fmt(limit)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${limit === null ? "bg-cyan-500" : barColor}`}
          style={{ width: `${limit === null ? 24 : Math.max(4, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function BillingQuotaMeters({
  isDemo = false,
  onUpgrade,
}: {
  isDemo?: boolean;
  onUpgrade?: () => void;
}) {
  const [data, setData] = useState<QuotaPayload | null>(isDemo ? DEMO_QUOTA : null);

  useEffect(() => {
    if (isDemo) {
      setData(DEMO_QUOTA);
      return;
    }
    let active = true;
    fetch("/api/v1/billing")
      .then((r) => r.json())
      .then((d) => {
        if (active && !d.error) setData(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isDemo]);

  if (!data) return null;

  const q = data.quotas || {
    maxEventsPerMonth: 10_000,
    maxPackages: 5,
    maxHeartbeats: 2,
    maxMembers: 2,
  };

  return (
    <section className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Gauge className="w-4 h-4 text-emerald-400" />
            <span>Plan Quota &amp; Multi-Account Usage Meters</span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              {data.tier}
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Live monthly ingestion events, R2 storage, tracked registry packages, cron heartbeats, and team seat usage.
          </p>
        </div>
        {onUpgrade && (
          <button
            type="button"
            onClick={onUpgrade}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 text-xs font-semibold transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Manage Plan &amp; Quotas</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <MeterBar
          label="Monthly Ingested Events"
          used={data.usage.monthlyEventCount || 0}
          limit={q.maxEventsPerMonth}
        />
        <MeterBar
          label="Cloudflare R2 Storage"
          used={data.usage.storageUsedBytes}
          limit={data.entitlements.storageLimitBytes}
          formatValue={(b) =>
            b >= 1024 * 1024 * 1024
              ? `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`
              : `${Math.round(b / (1024 * 1024))} MB`
          }
        />
        <MeterBar
          label="Workspaces / Projects"
          used={data.usage.projectCount}
          limit={data.entitlements.maxProjects}
        />
        <MeterBar
          label="Tracked Package Connectors"
          used={data.usage.packageConnectorCount || 0}
          limit={q.maxPackages}
        />
        <MeterBar
          label="Cron Heartbeat Monitors"
          used={data.usage.heartbeatCount || 0}
          limit={q.maxHeartbeats}
        />
        <MeterBar
          label="Organization Team Seats"
          used={data.usage.seatCount || 1}
          limit={q.maxMembers}
        />
      </div>
    </section>
  );
}
