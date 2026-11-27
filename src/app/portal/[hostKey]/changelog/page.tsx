import React from "react";
import Link from "next/link";
import { GitMerge, ArrowLeft, Sparkles, Tag, ExternalLink, Activity } from "lucide-react";
import { loadPortalChangelog } from "@/lib/domains/changelog-loader";
import { normalizeThemeId, getPresetThemeCss, scopeCustomCss } from "@/lib/layout/css-scoper";

export const dynamic = "force-dynamic";

export default async function PortalChangelogPage(props: {
  params: Promise<{ hostKey: string }>;
  searchParams?: Promise<{ project?: string }>;
}) {
  const { hostKey } = await props.params;
  const sp = (await props.searchParams) || {};
  const loaded = await loadPortalChangelog(hostKey, sp.project);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="p-8 rounded-2xl bg-zinc-900 border border-zinc-800 text-center space-y-3">
          <h1 className="text-lg font-bold text-white">Changelog Not Found</h1>
          <Link href="/" className="text-xs text-indigo-400 hover:underline">
            Return to DevPulse
          </Link>
        </div>
      </div>
    );
  }

  const { portal, releases, unreleasedPrs, shippedRequests } = loaded;
  const project = portal.activeProject;
  const activeTheme = normalizeThemeId(project?.theme);
  const dynamicCss = [
    getPresetThemeCss(activeTheme),
    scopeCustomCss(project?.customCss || "", ".devpulse-workspace"),
  ]
    .filter(Boolean)
    .join("\n");
  const brandName = portal.user.brandTitle || project?.name || portal.user.githubUsername;

  return (
    <div data-theme={activeTheme} className="devpulse-shell min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {dynamicCss && <style dangerouslySetInnerHTML={{ __html: dynamicCss }} />}
      <header className="devpulse-topbar border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h1 className="font-bold text-white text-base">{brandName} Changelog</h1>
              <p className="text-xs text-zinc-400">
                Auto-generated from merged GitHub Pull Requests &amp; verified releases
              </p>
            </div>
          </div>
          <Link
            href={project ? `/?project=${encodeURIComponent(project.slug)}` : "/"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Status Portal</span>
          </Link>
        </div>
      </header>

      <main className="devpulse-workspace flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {shippedRequests.length > 0 && (
          <section className="p-5 rounded-2xl bg-zinc-900/80 border border-emerald-500/30 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Shipped From Your Feedback
              </span>
              <span className="text-xs text-zinc-400">{shippedRequests.length} request(s)</span>
            </div>
            <div className="space-y-2">
              {shippedRequests.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 text-xs">
                  <div className="min-w-0">
                    <span className="text-zinc-100 truncate block">{item.title}</span>
                    <span className="text-zinc-500">{item.voteCount} vote(s) · {item.category}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.targetVersion && (
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300">{item.targetVersion}</span>
                    )}
                    {item.releaseUrl && (
                      <a href={item.releaseUrl} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">Release notes</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {unreleasedPrs.length > 0 && (
          <section className="p-5 rounded-2xl bg-zinc-900/80 border border-indigo-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Next Release (Merged PRs)
                </span>
                <span className="text-xs text-zinc-400">{unreleasedPrs.length} pull request(s)</span>
              </div>
            </div>
            <div className="space-y-2">
              {unreleasedPrs.map((pr) => (
                <a
                  key={pr.number}
                  href={pr.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 transition"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <GitMerge className="w-4 h-4 text-purple-400 shrink-0" />
                    <span className="text-xs font-mono text-zinc-500">#{pr.number}</span>
                    <span className="text-sm text-white font-medium truncate">{pr.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[11px] text-zinc-400">
                    <span>@{pr.author}</span>
                    <ExternalLink className="w-3 h-3" />
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {releases.length === 0 && unreleasedPrs.length === 0 ? (
          <div className="p-12 rounded-2xl bg-zinc-900/70 border border-zinc-800 text-center text-sm text-zinc-400 space-y-2">
            <Activity className="w-8 h-8 text-zinc-600 mx-auto" />
            <p>No published releases or merged Pull Requests recorded yet.</p>
          </div>
        ) : (
          releases.map((rel) => (
            <section key={rel.version} className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                  <Tag className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-lg font-bold text-white font-mono">{rel.version}</h2>
                  {rel.commitSha && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400">
                      {rel.commitSha.slice(0, 7)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-400">
                  {new Date(rel.releasedAt).toLocaleDateString()}
                </span>
              </div>

              {rel.commitMessage && (
                <p className="text-xs text-zinc-300 bg-zinc-950/70 p-3 rounded-xl border border-zinc-800/70 font-mono">
                  {rel.commitMessage}
                </p>
              )}

              {rel.pullRequests.length > 0 && (
                <div className="space-y-2 pt-1">
                  {rel.pullRequests.map((pr) => (
                    <a
                      key={pr.number}
                      href={pr.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 hover:border-zinc-700 transition text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GitMerge className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        <span className="font-mono text-zinc-500">#{pr.number}</span>
                        <span className="text-zinc-100 truncate">{pr.title}</span>
                      </div>
                      <span className="text-zinc-500 shrink-0">@{pr.author}</span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          ))
        )}
      </main>
    </div>
  );
}
