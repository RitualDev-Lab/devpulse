export type PlanTier = "free" | "pro" | "team" | "byos";

export interface PlanDefinition {
  tier: PlanTier;
  label: string;
  priceMonthly: number;
  maxProjects: number;
  baseCustomDomains: number;
  storageLimitBytes: number;
  retentionDays: number;
  whiteLabel: boolean;
  allowByos: boolean;
  alertChannelsLimit: number;
  features: string[];
}

export const EXTRA_DOMAIN_ADDON_PRICE_MONTHLY = 5;

export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: "free",
    label: "Free",
    priceMonthly: 0,
    maxProjects: 1,
    baseCustomDomains: 0,
    storageLimitBytes: 100 * 1024 * 1024, // 100 MB
    retentionDays: 7,
    whiteLabel: false,
    allowByos: false,
    alertChannelsLimit: 1,
    features: [
      "1 Project Workspace",
      "1 Free Subdomain (*.devpulse.ritualdev.in)",
      "100 MB Cloudflare R2 Crash Storage",
      "7-Day Metrics & Error Retention",
      "1 Webhook Alert Channel",
    ],
  },
  pro: {
    tier: "pro",
    label: "Developer Pro",
    priceMonthly: 14,
    maxProjects: 5,
    baseCustomDomains: 1,
    storageLimitBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    retentionDays: 90,
    whiteLabel: true,
    allowByos: true,
    alertChannelsLimit: 4,
    features: [
      "Up to 5 Project Workspaces",
      "1 Custom Domain with Auto SSL (CNAME)",
      "5 GB R2 Storage + Optional BYOS R2/S3",
      "90-Day Analytics & Error Retention",
      "White-label Public Dashboards (No Badge)",
    ],
  },
  team: {
    tier: "team",
    label: "Team / Studio",
    priceMonthly: 49,
    maxProjects: 9999,
    baseCustomDomains: 5,
    storageLimitBytes: 50 * 1024 * 1024 * 1024, // 50 GB
    retentionDays: 365,
    whiteLabel: true,
    allowByos: true,
    alertChannelsLimit: 99,
    features: [
      "Unlimited Project Workspaces",
      "5 Custom Domains + Wildcard SSL",
      "50 GB R2 Storage + Full BYOS S3/R2",
      "365-Day Retention & Audit History",
      "Multi-Channel Alerts (Discord, Slack, Telegram)",
    ],
  },
  byos: {
    tier: "byos",
    label: "BYOS Pro",
    priceMonthly: 14,
    maxProjects: 5,
    baseCustomDomains: 1,
    storageLimitBytes: 5 * 1024 * 1024 * 1024,
    retentionDays: 90,
    whiteLabel: true,
    allowByos: true,
    alertChannelsLimit: 4,
    features: [
      "Bring Your Own S3/R2 Bucket",
      "5 Project Workspaces",
      "1 Custom Domain with SSL",
      "90-Day Analytics Retention",
    ],
  },
};

export function normalizeTier(rawTier?: string | null): PlanTier {
  if (rawTier === "pro" || rawTier === "team" || rawTier === "byos") {
    return rawTier;
  }
  return "free";
}

export function getPlanLimits(rawTier?: string | null, extraCustomDomains = 0) {
  const tier = normalizeTier(rawTier);
  const def = PLAN_DEFINITIONS[tier];
  const safeExtra = Math.max(0, Number.isFinite(extraCustomDomains) ? extraCustomDomains : 0);
  return {
    ...def,
    maxCustomDomains: def.baseCustomDomains + safeExtra,
    extraCustomDomains: safeExtra,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}
