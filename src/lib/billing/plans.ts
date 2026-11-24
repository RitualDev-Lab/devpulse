export type PlanTier = "free" | "pro" | "team" | "enterprise" | "byos";
export type BillingItemKey = "pro" | "team" | "extra_domain" | "extra_storage";

export interface PlanDefinition {
  id: "free" | "pro" | "team";
  name: string;
  tagline: string;
  priceMonthlyUsd: number;
  maxProjects: number | null; // null = Unlimited
  maxSubdomains: number;
  maxCustomDomains: number;
  storageLimitBytes: number;
  storageLabel: string;
  historyDays: number;
  allowCustomCss: boolean;
  allowByos: boolean;
  allowWhiteLabel: boolean;
  alertChannels: readonly ("discord" | "telegram" | "slack" | "pagerduty" | "generic")[];
  features: readonly string[];
}

export const PLANS: Record<"free" | "pro" | "team", PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Built for solo open-source maintainers",
    priceMonthlyUsd: 0,
    maxProjects: 1,
    maxSubdomains: 1,
    maxCustomDomains: 0,
    storageLimitBytes: 100 * 1024 * 1024, // 100 MB
    storageLabel: "100 MB R2",
    historyDays: 7,
    allowCustomCss: false,
    allowByos: false,
    allowWhiteLabel: false,
    alertChannels: ["generic"],
    features: [
      "1 Project workspace",
      "1 Free *.devpulse.ritualdev.in subdomain",
      "100 MB Cloudflare R2 storage (7-day retention)",
      "7-day analytics & metrics history",
      "Preset dashboard themes & 2D grid",
      "Generic webhook crash notifications",
    ],
  },
  pro: {
    id: "pro",
    name: "Developer Pro",
    tagline: "For indie hackers & growing OSS tools",
    priceMonthlyUsd: 14,
    maxProjects: 5,
    maxSubdomains: 1,
    maxCustomDomains: 1,
    storageLimitBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    storageLabel: "5 GB R2",
    historyDays: 90,
    allowCustomCss: true,
    allowByos: false,
    allowWhiteLabel: true,
    alertChannels: ["discord", "telegram", "generic"],
    features: [
      "Up to 5 independent Projects",
      "1 Custom Domain with automatic SSL",
      "5 GB Cloudflare R2 storage (90-day lifecycle)",
      "90-day analytics & historical sparklines",
      "Discord & Telegram real-time crash alerts",
      "Scoped Custom CSS engine & White-labeling",
    ],
  },
  team: {
    id: "team",
    name: "Team / Studio",
    tagline: "Multi-product orgs & production studios",
    priceMonthlyUsd: 49,
    maxProjects: null, // Unlimited
    maxSubdomains: 1,
    maxCustomDomains: 5,
    storageLimitBytes: 50 * 1024 * 1024 * 1024, // 50 GB
    storageLabel: "50 GB R2 + BYOS",
    historyDays: 365,
    allowCustomCss: true,
    allowByos: true,
    allowWhiteLabel: true,
    alertChannels: ["discord", "telegram", "slack", "pagerduty", "generic"],
    features: [
      "Unlimited Projects & workspaces",
      "5 Custom Domains with automatic SSL",
      "50 GB R2 storage + BYOS (own R2 / S3 bucket)",
      "365-day analytics & metrics retention",
      "Multi-channel PagerDuty, Slack, Discord & Telegram routing",
      "Priority Cloudflare edge telemetry ingestion",
    ],
  },
};

export const ADDONS = {
  extra_domain: {
    key: "extra_domain" as const,
    name: "Extra Custom Domain",
    description: "+1 custom domain with automated Cloudflare SSL provisioning",
    unitPriceUsd: 5,
    domainsPerUnit: 1,
  },
  extra_storage: {
    key: "extra_storage" as const,
    name: "Extra R2 Storage (25 GB)",
    description: "+25 GB managed Cloudflare R2 object & crash trace storage",
    unitPriceUsd: 3,
    gbPerUnit: 25,
    bytesPerUnit: 25 * 1024 * 1024 * 1024,
  },
};

export function normalizePlanTier(tier?: string | null): "free" | "pro" | "team" {
  const normalized = (tier || "free").toLowerCase();
  if (normalized === "team" || normalized === "enterprise" || normalized === "byos") {
    return "team";
  }
  if (normalized === "pro") {
    return "pro";
  }
  return "free";
}

export function getPlanDefinition(tier?: string | null): PlanDefinition {
  return PLANS[normalizePlanTier(tier)];
}

export function getEffectiveEntitlements(input: {
  storageTier?: string | null;
  extraCustomDomains?: number | null;
  extraStorageGb?: number | null;
}) {
  const plan = getPlanDefinition(input.storageTier);
  const extraDomains = Math.max(0, Number(input.extraCustomDomains || 0));
  const extraGb = Math.max(0, Number(input.extraStorageGb || 0));

  return {
    plan,
    maxProjects: plan.maxProjects,
    maxSubdomains: plan.maxSubdomains,
    maxCustomDomains: plan.maxCustomDomains + extraDomains,
    extraCustomDomains: extraDomains,
    storageLimitBytes: plan.storageLimitBytes + extraGb * 1024 * 1024 * 1024,
    extraStorageGb: extraGb,
    historyDays: plan.historyDays,
    allowCustomCss: plan.allowCustomCss,
    allowByos: plan.allowByos,
    allowWhiteLabel: plan.allowWhiteLabel || extraDomains > 0,
    alertChannels: plan.alertChannels,
  };
}

export function canUseAlertChannel(
  tier: string | null | undefined,
  channel: "discord" | "telegram" | "slack" | "pagerduty" | "generic"
): boolean {
  const plan = getPlanDefinition(tier);
  return plan.alertChannels.includes(channel);
}
