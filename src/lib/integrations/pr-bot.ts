import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const PR_BOT_MARKER = "<!-- devpulse-pr-bot -->";

export interface PrBotCommentInput {
  projectName: string;
  projectSlug: string;
  prNumber: number | string;
  branch?: string | null;
  previewUrl?: string | null;
  webVitalsDelta?: {
    lcpMs?: number | null;
    inpMs?: number | null;
    cls?: number | null;
  } | null;
  vulnerabilities?: Array<{
    packageName: string;
    ecosystem: string;
    severity: string;
    id: string;
  }>;
  touchedCrashes?: Array<{
    errorName: string;
    count: number;
    topFrame?: string | null;
  }>;
}

export function buildPrIntelligenceComment(input: PrBotCommentInput): string {
  const lines: string[] = [
    PR_BOT_MARKER,
    `### DevPulse PR Intelligence — \`${input.projectName}\` (#${input.prNumber})`,
    "",
  ];

  if (input.branch || input.previewUrl) {
    lines.push(
      `Branch: \`${input.branch || "unknown"}\`${
        input.previewUrl ? ` • Preview: ${input.previewUrl}` : ""
      }`
    );
    lines.push("");
  }

  lines.push("#### 1. Core Web Vitals Preview Budget");
  if (input.webVitalsDelta && (input.webVitalsDelta.lcpMs != null || input.webVitalsDelta.inpMs != null || input.webVitalsDelta.cls != null)) {
    const lcp = input.webVitalsDelta.lcpMs != null ? `${Math.round(input.webVitalsDelta.lcpMs)} ms` : "n/a";
    const inp = input.webVitalsDelta.inpMs != null ? `${Math.round(input.webVitalsDelta.inpMs)} ms` : "n/a";
    const cls = input.webVitalsDelta.cls != null ? input.webVitalsDelta.cls.toFixed(3) : "n/a";
    lines.push(`- **LCP p75:** ${lcp} • **INP p75:** ${inp} • **CLS p75:** ${cls}`);
  } else {
    lines.push("- No regressions detected in preview RUM baseline.");
  }
  lines.push("");

  const vulns = input.vulnerabilities || [];
  lines.push(`#### 2. Dependency & SBOM Security (${vulns.length} advisory check(s))`);
  if (vulns.length === 0) {
    lines.push("- 0 known OSV.dev / deps.dev vulnerabilities across attached packages.");
  } else {
    for (const v of vulns.slice(0, 6)) {
      lines.push(`- **[${v.severity}]** \`${v.packageName}\` (${v.ecosystem}) — \`${v.id}\``);
    }
  }
  lines.push("");

  const crashes = input.touchedCrashes || [];
  lines.push(`#### 3. Related Unresolved Crash Regressions (${crashes.length})`);
  if (crashes.length === 0) {
    lines.push("- No open crash groups match recent frames on this workspace.");
  } else {
    for (const c of crashes.slice(0, 5)) {
      lines.push(
        `- \`${c.errorName}\` (${c.count} occurrences)${c.topFrame ? ` at \`${c.topFrame}\`` : ""}`
      );
    }
  }

  lines.push("");
  lines.push(
    `[Open DevPulse Security & Crashes](${PUBLIC_APP_URL}/dashboard/security?project=${encodeURIComponent(
      input.projectSlug
    )})`
  );

  return lines.join("\n");
}

export async function postGitHubPrComment(params: {
  repo: string;
  prNumber: number;
  token: string;
  body: string;
}): Promise<{ ok: boolean; status: number; commentUrl?: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${params.repo}/issues/${params.prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "DevPulse-PR-Bot",
      },
      body: JSON.stringify({ body: params.body }),
    }
  );
  const data = (await res.json().catch(() => ({}))) as { html_url?: string };
  return { ok: res.ok, status: res.status, commentUrl: data.html_url };
}

export async function postGitLabMrNote(params: {
  baseUrl?: string | null;
  projectPath: string;
  mrIid: number;
  token: string;
  body: string;
}): Promise<{ ok: boolean; status: number }> {
  const origin = (params.baseUrl || "https://gitlab.com").replace(/\/$/, "");
  const res = await fetch(
    `${origin}/api/v4/projects/${encodeURIComponent(params.projectPath)}/merge_requests/${params.mrIid}/notes`,
    {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": params.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: params.body }),
    }
  );
  return { ok: res.ok, status: res.status };
}
