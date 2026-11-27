import { Suspense } from "react";
import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import { DefenseSuiteFullView } from "@/components/dashboard/pages/DefenseSuiteFullView";
import { loadDashboardWorkspace } from "@/lib/dashboard/load-workspace";

export const dynamic = "force-dynamic";

export default async function DefenseSuiteWorkspacePage(props: {
  searchParams?: Promise<{ project?: string; demo?: string }>;
}) {
  const loaded = await loadDashboardWorkspace((await props.searchParams) || {}, {
    scope: "minimal",
  });
  if (loaded.status === "auth_gate") return <DashboardAuthGate />;
  if (loaded.status === "onboarding") return <DashboardOnboardingView user={loaded.user} />;
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#08090c]" />}>
      <DefenseSuiteFullView workspace={loaded} />
    </Suspense>
  );
}
