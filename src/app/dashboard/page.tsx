import { DashboardClientView } from "@/components/dashboard/DashboardClientView";
import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import { loadDashboardWorkspace } from "@/lib/dashboard/load-workspace";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams?: Promise<{
    project?: string;
    demo?: string;
  }>;
}

export default async function DashboardPage(props: DashboardPageProps) {
  const params = (await props.searchParams) || {};
  const loaded = await loadDashboardWorkspace(params, { scope: "overview" });

  if (loaded.status === "auth_gate") {
    return <DashboardAuthGate />;
  }
  if (loaded.status === "onboarding") {
    return <DashboardOnboardingView user={loaded.user} />;
  }

  return (
    <DashboardClientView
      initialData={loaded.initialData}
      projects={loaded.projects}
      customDomain={loaded.customDomain}
      storageTier={loaded.storageTier}
      accessRole={loaded.accessRole}
      isDemo={loaded.isDemo}
    />
  );
}
