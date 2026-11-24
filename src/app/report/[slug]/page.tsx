import React from "react";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { BugReportClientForm } from "./BugReportClientForm";
import { notFound } from "next/navigation";
import { AlertCircle, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BugReportPage({ params }: PageProps) {
  const { slug } = await params;

  // Find project by slug (never expose private telemetryApiKey in public HTML)
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      description: projects.description,
    })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) {
    notFound();
  }

  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "0x4AAAAAAGRcrYre1ndzSEjF";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between py-12 px-4 sm:px-6">
      <div className="max-w-xl mx-auto w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-red-600 via-amber-500 to-amber-400 p-[1px] mx-auto mb-3 shadow-lg shadow-red-500/10">
            <div className="w-full h-full bg-zinc-950 rounded-[15px] flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-amber-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
            Report an Issue with {project.name}
          </h1>
          <p className="text-sm text-zinc-400">
            Submit a bug, crash report, or feedback directly to the maintainers at{" "}
            <span className="text-zinc-200 font-medium">ritualdev-lab</span>. No GitHub account required.
          </p>
        </div>

        {/* Client submission form */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          <BugReportClientForm
            projectSlug={project.slug}
            projectName={project.name}
            turnstileSiteKey={turnstileSiteKey}
          />
        </div>

        {/* Security / Privacy notice */}
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Protected by Cloudflare Turnstile &bull; Delivered securely to DevPulse HQ</span>
        </div>
      </div>

      <footer className="mt-12 text-center text-xs text-zinc-600">
        Powered by DevPulse &bull; Open-Source Maintainer Hub by ritualdev-lab
      </footer>
    </div>
  );
}
