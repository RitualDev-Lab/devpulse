"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { DashboardShellMeta } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "./WorkspaceShell";

function DashboardLayoutShellInner({
  shellMeta,
  children,
}: {
  shellMeta: DashboardShellMeta;
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "1";
  const requestedProject = searchParams.get("project");

  if (!shellMeta.user && !isDemo) {
    return <>{children}</>;
  }

  if (shellMeta.user && shellMeta.projects.length === 0) {
    return <>{children}</>;
  }

  const projectList =
    shellMeta.projects.length > 0
      ? shellMeta.projects
      : shellMeta.demoProject
      ? [shellMeta.demoProject]
      : [];

  if (projectList.length === 0) {
    return <>{children}</>;
  }

  const activeProject =
    (requestedProject &&
      projectList.find(
        (p) => p.slug === requestedProject || p.id === requestedProject
      )) ||
    projectList[0];

  return (
    <WorkspaceShell
      currentProject={activeProject}
      projects={projectList}
      storageTier={shellMeta.storageTier}
      customDomain={shellMeta.customDomain}
      isDemo={!shellMeta.user && isDemo}
    >
      {children}
    </WorkspaceShell>
  );
}

export function DashboardLayoutShell({
  shellMeta,
  children,
}: {
  shellMeta: DashboardShellMeta;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<>{children}</>}>
      <DashboardLayoutShellInner shellMeta={shellMeta}>
        {children}
      </DashboardLayoutShellInner>
    </Suspense>
  );
}
