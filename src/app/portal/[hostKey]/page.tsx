import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { loadPortalData } from "@/lib/domains/portal-loader";
import { PRIMARY_PORTAL_DOMAIN } from "@/lib/domains/cloudflare-saas";
import { PublicPortalView } from "@/components/portal/PublicPortalView";
import { Globe, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface PortalPageProps {
  params: Promise<{ hostKey: string }>;
  searchParams?: Promise<{ project?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PortalPageProps): Promise<Metadata> {
  const { hostKey } = await params;
  const sp = (await searchParams) || {};
  const data = await loadPortalData(hostKey, sp.project);

  if (!data) {
    return {
      title: "Portal Not Found",
      description: "This developer portal is not claimed yet.",
    };
  }

  const brandName =
    data.user.brandTitle ||
    data.activeProject?.name ||
    data.user.name ||
    data.user.githubUsername;
  const title = data.user.brandTitle
    ? data.user.brandTitle
    : `${brandName} — Live Status & Telemetry`;
  const description =
    data.user.brandDescription ||
    data.activeProject?.description ||
    `Live package downloads, repository velocity, and service health for ${brandName}.`;

  const ogImage =
    data.user.brandOgImageUrl ||
    `https://${PRIMARY_PORTAL_DOMAIN}/api/og?host=${encodeURIComponent(hostKey)}${
      sp.project ? `&project=${encodeURIComponent(sp.project)}` : ""
    }`;

  const favicon = data.user.brandFaviconUrl || "/favicon.ico";

  return {
    title,
    description,
    icons: {
      icon: favicon,
      apple: favicon,
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PortalPage({ params, searchParams }: PortalPageProps) {
  const { hostKey } = await params;
  const sp = (await searchParams) || {};
  const headerStore = await headers();

  const data = await loadPortalData(hostKey, sp.project);

  if (!data) {
    const cleanKey = decodeURIComponent(hostKey);
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full p-8 rounded-3xl bg-zinc-900/90 border border-zinc-800 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mx-auto text-zinc-400">
            <Globe className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-white">Portal Not Found</h1>
          <p className="text-sm text-zinc-400">
            No workspace is currently bound to{" "}
            <code className="text-indigo-300 font-mono">{cleanKey}</code>.
          </p>
          <a
            href={`https://${PRIMARY_PORTAL_DOMAIN}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Claim on DevPulse</span>
          </a>
        </div>
      </div>
    );
  }

  const portalHost =
    headerStore.get("x-devpulse-portal-host") ||
    data.user.customDomain ||
    `${data.user.subdomain}.${PRIMARY_PORTAL_DOMAIN}`;

  return (
    <PublicPortalView
      portalHost={portalHost}
      user={data.user}
      projects={data.projects}
      dashboardData={data.dashboardData}
    />
  );
}
