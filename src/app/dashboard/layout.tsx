import React, { Suspense } from "react";
import { loadDashboardShellMeta } from "@/lib/dashboard/load-workspace";
import { DashboardLayoutShell } from "@/components/dashboard/DashboardLayoutShell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const shellMeta = await loadDashboardShellMeta();

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#08090c]" />}>
      <DashboardLayoutShell shellMeta={shellMeta}>
        {children}
      </DashboardLayoutShell>
    </Suspense>
  );
}
