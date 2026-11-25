import React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity, ExternalLink, Lock, Sparkles } from "lucide-react";
import { db } from "@/db";
import { initDb } from "@/db/setup";
import { projects, users } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { loadProjectDashboardData } from "@/lib/dashboard/load-project-dashboard";
import { DragDropGrid } from "@/components/dashboard/DragDropGrid";
import { buildThemeCss, getThemePreset, scopeCustomCss } from "@/lib/styling/themes";
import { getPlanLimits } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

interface PublicProjectPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ embed?: string }>;
}

export default async function PublicProjectPage({
  params,
  searchParams,
}: PublicProjectPageProps) {
  await initDb().catch(() => {});
  const { slug } = await params;
  const query = (await searchParams) || {};
  const isEmbed = query.embed === "1";

  const rows = await db
    .select({
      project: projects,
      ownerUsername: users.githubUsername,
      ownerTier: users.storageTier,
      ownerExtraDomains: users.extraCustomDomains,
    })
    .from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
    .where(or(eq(projects.slug, slug), eq(projects.id, slug)))
    .limit(1);

  const match = rows[0];
  if (!match) {
    notFound();
  }

  const { project, ownerUsername, ownerTier, ownerExtraDomains } = match;

  if (!project.isPublic) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full p-8 rounded-3xl bg-zinc-900 border border-zinc-800 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-white">Private Dashboard</h1>
          <p className="text-xs text-zinc-400">
            The maintainer has set telemetry for <strong>{project.name}</strong> to private.
          </p>
          <Link
            href="/"
            className="inline-block px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
          >
            Back to DevPulse
          </Link>
        </div>
      </div>
    );
  }

  const dashboardData = await loadProjectDashboardData(project, { includePrivate: false });
  const preset = getThemePreset(project.theme);
  const themeCss = buildThemeCss(project.theme);
  const scopedUserCss = project.customCss ? scopeCustomCss(project.customCss) : "";
  const limits = getPlanLimits(ownerTier, ownerExtraDomains ?? 0);

  return (
    <div
      data-theme={preset.id}
      className={`devpulse-dashboard min-h-screen ${preset.wrapperClass} flex flex-col selection:bg-indigo-500/30 selection:text-white`}
    >
      <style dangerouslySetInnerHTML={{ __html: `${themeCss}\n${scopedUserCss}` }} />

      {!isEmbed && (
        <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shrink-0">
                <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
                  <Activity className="w-4 h-4 text-indigo-400" />
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="font-bold text-white text-sm sm:text-base truncate">
                    {project.name}
                  </h1>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                    Public Telemetry
                  </span>
                </div>
                {ownerUsername && (
                  <p className="text-[11px] text-zinc-400 truncate">
                    Maintained by @{ownerUsername}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Link
                href={`/report/${project.slug}`}
                className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition"
              >
                Report Bug
              </Link>
              {project.githubRepo && (
                <a
                  href={`https://github.com/${project.githubRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
                >
                  <span>GitHub</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </header>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <DragDropGrid data={dashboardData} isCustomizing={false} readOnly />
      </main>

      {!isEmbed && !limits.whiteLabel && (
        <footer className="border-t border-zinc-900 bg-zinc-950/90 py-4 px-4 text-center text-xs text-zinc-500">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white transition"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              Powered by <strong className="text-indigo-400">DevPulse</strong> — Build your free public telemetry page
            </span>
          </Link>
        </footer>
      )}
    </div>
  );
}
