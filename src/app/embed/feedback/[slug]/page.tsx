import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { FeedbackBoardClient } from "@/components/portal/FeedbackBoardClient";

export const dynamic = "force-dynamic";

/**
 * GET /embed/feedback/[slug]
 * Lightweight iframe-embeddable Feature Requests & Voting card for external sites/docs.
 */
export default async function EmbedFeedbackWidgetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [project] = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 flex flex-col justify-between gap-4">
      <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-4 sm:p-5">
        <FeedbackBoardClient
          projectSlug={project.slug}
          projectName={project.name}
          compact
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-500 px-1">
        <Link
          href={`/report/${encodeURIComponent(project.slug)}?tab=feedback`}
          target="_blank"
          className="text-indigo-400 hover:underline"
        >
          Open Full Roadmap &amp; Bug Portal
        </Link>
        <Link href="https://devpulse.ritualdev.in" target="_blank" className="hover:text-zinc-300">
          Powered by DevPulse
        </Link>
      </div>
    </div>
  );
}
