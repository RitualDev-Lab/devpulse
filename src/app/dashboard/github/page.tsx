import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import { GitHubFullView } from "@/components/dashboard/pages/GitHubFullView";
import { loadDashboardWorkspace } from "@/lib/dashboard/load-workspace";

export const dynamic = "force-dynamic";

export default async function GitHubWorkspacePage(props: {
  searchParams?: Promise<{ project?: string; demo?: string }>;
}) {
  const loaded = await loadDashboardWorkspace((await props.searchParams) || {});
  if (loaded.status === "auth_gate") return <DashboardAuthGate />;
  if (loaded.status === "onboarding") return <DashboardOnboardingView user={loaded.user} />;
  return <GitHubFullView workspace={loaded} />;
}
