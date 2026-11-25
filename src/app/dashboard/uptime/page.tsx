import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import { UptimeFullView } from "@/components/dashboard/pages/UptimeFullView";
import { loadDashboardWorkspace } from "@/lib/dashboard/load-workspace";

export const dynamic = "force-dynamic";

export default async function UptimeWorkspacePage(props: {
  searchParams?: Promise<{ project?: string; demo?: string }>;
}) {
  const loaded = await loadDashboardWorkspace((await props.searchParams) || {}, {
    scope: "uptime",
  });
  if (loaded.status === "auth_gate") return <DashboardAuthGate />;
  if (loaded.status === "onboarding") return <DashboardOnboardingView user={loaded.user} />;
  return <UptimeFullView workspace={loaded} />;
}
