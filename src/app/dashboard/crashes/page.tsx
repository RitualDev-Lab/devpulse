import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import { CrashesFullView } from "@/components/dashboard/pages/CrashesFullView";
import { loadDashboardWorkspace } from "@/lib/dashboard/load-workspace";

export const dynamic = "force-dynamic";

export default async function CrashesWorkspacePage(props: {
  searchParams?: Promise<{ project?: string; demo?: string }>;
}) {
  const loaded = await loadDashboardWorkspace((await props.searchParams) || {});
  if (loaded.status === "auth_gate") return <DashboardAuthGate />;
  if (loaded.status === "onboarding") return <DashboardOnboardingView user={loaded.user} />;
  return <CrashesFullView workspace={loaded} />;
}
