import { NextRequest, NextResponse } from "next/server";
import { loadPortalStatusHistory } from "@/lib/domains/status-loader";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";

function escapeXml(raw: string | number | null | undefined): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * GET /portal/[hostKey]/status/rss.xml
 * Public RSS 2.0 feed of 90-day incident history & real-time monitor status.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ hostKey: string }> }
) {
  const { hostKey } = await context.params;
  const projectSlug = req.nextUrl.searchParams.get("project") || undefined;
  const loaded = await loadPortalStatusHistory(hostKey, projectSlug);

  if (!loaded) {
    return new NextResponse("Status portal not found", { status: 404 });
  }

  const { portal, history, incidents } = loaded;
  const project = portal.activeProject;
  const brandName = portal.user.brandTitle || project?.name || portal.user.githubUsername;
  const baseStatusUrl = `${PUBLIC_APP_URL}/portal/${encodeURIComponent(hostKey)}/status${
    project ? `?project=${encodeURIComponent(project.slug)}` : ""
  }`;

  const incidentItems = incidents.map((inc) => {
    const pubDate = new Date(inc.startedAt).toUTCString();
    const title = `[${inc.severity.toUpperCase()} / ${inc.status.toUpperCase()}] ${inc.title}`;
    const descParts = [
      inc.impactSummary || "",
      inc.rcaText ? `RCA: ${inc.rcaText}` : "",
      inc.durationMinutes > 0 ? `Duration: ${inc.durationMinutes} min` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(baseStatusUrl)}</link>
      <guid isPermaLink="false">${escapeXml(inc.id)}</guid>
      <pubDate>${escapeXml(pubDate)}</pubDate>
      <description>${escapeXml(descParts || inc.title)}</description>
    </item>`;
  });

  const monitorItems = history.perMonitor.map((m) => {
    const statusLabel = m.lastStatus.toUpperCase();
    return `    <item>
      <title>${escapeXml(`${m.name}: ${statusLabel} (${m.uptime90dPercent}% uptime, P95 ${m.p95LatencyMs}ms)`)}</title>
      <link>${escapeXml(baseStatusUrl)}</link>
      <guid isPermaLink="false">monitor-${escapeXml(m.monitorId)}-${escapeXml(m.lastStatus)}</guid>
      <pubDate>${escapeXml(new Date().toUTCString())}</pubDate>
      <description>${escapeXml(`Endpoint ${m.url} is currently ${m.lastStatus} with ${m.uptime90dPercent}% 90-day uptime.`)}</description>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(brandName)} — Uptime &amp; Incident Status</title>
    <link>${escapeXml(baseStatusUrl)}</link>
    <description>${escapeXml(`90-day uptime monitors and public incident RCA timeline for ${brandName}. Overall uptime: ${history.overall90dPercent}%.`)}</description>
    <lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>
    <atom:link href="${escapeXml(`${PUBLIC_APP_URL}/portal/${encodeURIComponent(hostKey)}/status/rss.xml`)}" rel="self" type="application/rss+xml" />
${[...incidentItems, ...monitorItems].join("\n")}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
