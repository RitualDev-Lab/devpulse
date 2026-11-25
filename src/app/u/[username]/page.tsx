import React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity, ExternalLink, Sparkles, Layers } from "lucide-react";
import { db } from "@/db";
import { initDb } from "@/db/setup";
import { projects, users } from "@/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { loadProjectDashboardData } from "@/lib/dashboard/load-project-dashboard";
import { DragDropGrid } from "@/components/dashboard/DragDropGrid";
import { buildThemeCss, getThemePreset, scopeCustomCss } from "@/lib/styling/themes";
import { getPlanLimits } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

interface TenantPageProps {
  params: Promise<{ username: string }>;
  searchParams?: Promise<{ project?: string; embed?: string }>;
}

export default async function TenantPublicPage({ params, searchParams }: TenantPageProps) {
  await initDb().catch(() => {});
  const { username } = await params;
  const query = (await searchParams) || {};
  const isEmbed = query.embed === "1";

  // Resolve tenant user by claimed subdomain OR GitHub username (case-exact/lowercase)
  const cleanHandle = decodeURIComponent(username).trim().toLowerCase();
  const [owner] = await db
    .select()
    .from(users)
    .where(or(eq(users.subdomain, cleanHandle), eq(users.githubUsername, cleanHandle), eq(users.githubUsername, username)))
    .limit(1);

  if (!owner) {
    notFound();
  }

  const publicProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, owner.id), eq(projects.isPublic, true)))
    .orderBy(desc(projects.createdAt));

  if (publicProjects.length === 0) {
    notFound();
  }

  const activeProject = query.project
    ? publicProjects.find((p) => p.slug === query.project || p.id === query.project) || publicProjects[0]
    : publicProjects[0];

  const dashboardData = await loadProjectDashboardData(activeProject, { includePrivate: false });
  const preset = getThemePreset(activeProject.theme);
  const themeCss = buildThemeCss(activeProject.theme);
  const scopedUserCss = activeProject.customCss ? scopeCustomCss(activeProject.customCss) : "";
  const limits = getPlanLimits(owner.storageTier, owner.extraCustomDomains ?? 0);

  return (
    <div
      data-theme={preset.id}
      className={`devpulse-dashboard min-h-screen ${preset.wrapperClass} flex flex-col selection:bg-indigo-500/30 selection:text-white`}
    >
      <style dangerouslySetInnerHTML={{ __html: `${themeCss}\n${scopedUserCss}` }} />

      {!isEmbed && (
        <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shrink-0">
                <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
                  <Activity className="w-4 h-4 text-indigo-400" />
                </div>
              </div>
              <div className="min-w-0">
                <h1 className="font-bold text-white text-sm sm:text-base truncate">
                  {activeProject.name}
                </h1>
                <p className="text-[11px] text-zinc-400 truncate">
                  @{owner.githubUsername} &bull; Live Package &amp; Error Telemetry
                </p>
              </div>
            </div>

            {publicProjects.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Layers className="w-3.5 h-3.5 text-zinc-500 mr-1" />
                {publicProjects.map((p) => (
                  <Link
                    key={p.id}
                    href={`?project=${p.slug}`}
                    className={`px-2.5 py-1 rounded-lg text-xs border transition ${
                      p.id === activeProject.id
                        ? "bg-indigo-600/20 border-indigo-500 text-white font-semibold"
                        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {p.name}
                  </Link>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              {activeProject.githubRepo && (
                <a
                  href={`https://github.com/${activeProject.githubRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition"
                >
                  <span>Repo</span>
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
              Powered by <strong className="text-indigo-400">DevPulse</strong>
            </span>
          </Link>
        </footer>
      )}
    </div>
  );
}
