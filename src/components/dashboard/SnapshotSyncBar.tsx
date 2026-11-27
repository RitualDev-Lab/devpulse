"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { formatRelativeSyncAge } from "@/lib/integrations/registry-adapter";

interface SnapshotSyncBarProps {
  projectId: string;
  snapshotUpdatedAt?: string | null;
  isDemo?: boolean;
  onRefreshed?: (updatedAt: string | null) => void;
}

export function SnapshotSyncBar({
  projectId,
  snapshotUpdatedAt,
  isDemo = false,
  onRefreshed,
}: SnapshotSyncBarProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(snapshotUpdatedAt || null);
  const [justSynced, setJustSynced] = useState(false);

  const effectiveTs = updatedAt || snapshotUpdatedAt || null;

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setJustSynced(false);
    try {
      const res = await fetch(
        `/api/v1/projects/snapshots?projectId=${encodeURIComponent(projectId)}&refresh=1`
      );
      if (res.ok) {
        const data = await res.json();
        const nextTs = data.snapshotUpdatedAt || new Date().toISOString();
        setUpdatedAt(nextTs);
        setJustSynced(true);
        if (onRefreshed) onRefreshed(nextTs);
        router.refresh();
        setTimeout(() => setJustSynced(false), 2500);
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-2 text-xs">
      <span
        className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono text-zinc-400 tabular-nums"
        suppressHydrationWarning
      >
        {justSynced && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
        <span className="text-zinc-500">{isDemo ? "Source: Snapshot" : "Source: Live API"} ·</span>
        <span>{formatRelativeSyncAge(effectiveTs)}</span>
      </span>
      <button
        type="button"
        disabled={syncing || isDemo}
        onClick={handleSyncNow}
        title={isDemo ? "Sign in to force live upstream sync" : "Refresh package, GitHub & revenue snapshots now"}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium disabled:opacity-50 transition"
      >
        <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${syncing ? "animate-spin" : ""}`} />
        <span>{syncing ? "Syncing..." : "Sync Now"}</span>
      </button>
    </div>
  );
}
