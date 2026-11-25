import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import { RevenueFullView } from "@/components/dashboard/pages/RevenueFullView";
import { loadDashboardWorkspace } from "@/lib/dashboard/load-workspace";

export const dynamic = "force-dynamic";

export default async function RevenueWorkspacePage(props: {
  searchParams?: Promise<{ project?: string; demo?: string }>;
}) {
  const loaded = await loadDashboardWorkspace((await props.searchParams) || {}, {
    scope: "revenue",
  });
  if (loaded.status === "auth_gate") return <DashboardAuthGate />;
  if (loaded.status === "onboarding") return <DashboardOnboardingView user={loaded.user} />;
  return <RevenueFullView workspace={loaded} />;
}
