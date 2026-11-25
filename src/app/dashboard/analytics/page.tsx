import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import { AnalyticsFullView } from "@/components/dashboard/pages/AnalyticsFullView";
import { loadDashboardWorkspace } from "@/lib/dashboard/load-workspace";

export const dynamic = "force-dynamic";

export default async function AnalyticsWorkspacePage(props: {
  searchParams?: Promise<{ project?: string; demo?: string }>;
}) {
  const loaded = await loadDashboardWorkspace((await props.searchParams) || {});
  if (loaded.status === "auth_gate") return <DashboardAuthGate />;
  if (loaded.status === "onboarding") return <DashboardOnboardingView user={loaded.user} />;
  return <AnalyticsFullView workspace={loaded} />;
}
