import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { and, desc, eq, like } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { recordAuditEvent } from "@/lib/security/audit";
import { scrubTelemetryValue } from "@/lib/security/ingest-scrub";

export const dynamic = "force-dynamic";

const ALLOWED_ENGINES = new Set([
  "agentshield",
  "dbshield",
  "skillprism",
  "promptshield",
  "web-sec-auditor",
]);

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  const isDemo = req.nextUrl.searchParams.get("demo") === "1";

  if (isDemo || projectId === "demo") {
    return NextResponse.json({
      source: "demo_snapshot",
      engines: [
        { id: "agentshield", name: "AgentShield", status: "enforced", blocked24h: 19, ruleVersion: "2.4.1", detail: "MCP tool-call egress & token redaction proxy active" },
        { id: "dbshield", name: "DBShield", status: "enforced", blocked24h: 7, ruleVersion: "1.9.0", detail: "Row-Level Security & destructive SQL AST blocker" },
        { id: "skillprism", name: "SkillPrism", status: "enforced", blocked24h: 3, ruleVersion: "1.3.2", detail: "Agent skill & extension static capability auditor" },
        { id: "promptshield", name: "PromptShield", status: "enforced", blocked24h: 42, ruleVersion: "3.1.0", detail: "Indirect prompt-injection & jailbreak boundary filter" },
        { id: "web-sec-auditor", name: "web-sec-auditor", status: "active", blocked24h: 11, ruleVersion: "2.0.5", detail: "CSP, SSRF, Open Redirect & HTTP header verifier" },
      ],
      events: [
        {
          id: "def_demo_1",
          engine: "promptshield",
          severity: "HIGH",
          ruleId: "PS-IND-014",
          summary: "Blocked indirect prompt injection embedded in external GitHub issue comment",
          status: "blocked",
          createdAt: "2026-11-27 10:42:00",
        },
        {
          id: "def_demo_2",
          engine: "dbshield",
          severity: "CRITICAL",
          ruleId: "DBS-AST-002",
          summary: "Rejected multi-statement DROP TABLE payload before parameterized execution",
          status: "blocked",
          createdAt: "2026-11-27 09:15:12",
        },
        {
          id: "def_demo_3",
          engine: "agentshield",
          severity: "MEDIUM",
          ruleId: "AGS-PII-008",
          summary: "Redacted bearer credential before forwarding trace span to external worker",
          status: "scrubbed",
          createdAt: "2026-11-27 08:04:55",
        },
      ],
    });
  }

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await resolveProjectAccess(projectId, user);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.projectId, projectId), like(auditLogs.action, "defense.%")))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);

  const countsByEngine: Record<string, number> = {};
  const events = rows.map((r) => {
    const engine = r.action.replace(/^defense\./, "");
    countsByEngine[engine] = (countsByEngine[engine] || 0) + 1;
    let meta: Record<string, unknown> = {};
    try {
      meta = r.metadataJson ? (JSON.parse(r.metadataJson) as Record<string, unknown>) : {};
    } catch {}
    return {
      id: r.id,
      engine,
      severity: String(meta.severity || "MEDIUM"),
      ruleId: String(meta.ruleId || "DEF-001"),
      summary: String(meta.summary || r.resourceType),
      status: r.status === "denied" ? "blocked" : "logged",
      createdAt: r.createdAt,
    };
  });

  return NextResponse.json({
    source: "live_db",
    engines: [
      { id: "agentshield", name: "AgentShield", status: "enforced", blocked24h: countsByEngine.agentshield || 0, ruleVersion: "2.4.1", detail: "MCP tool-call egress & token redaction proxy" },
      { id: "dbshield", name: "DBShield", status: "enforced", blocked24h: countsByEngine.dbshield || 0, ruleVersion: "1.9.0", detail: "SQL AST guardrails & RLS isolation verification" },
      { id: "skillprism", name: "SkillPrism", status: "enforced", blocked24h: countsByEngine.skillprism || 0, ruleVersion: "1.3.2", detail: "Skill/plugin manifest & permission auditor" },
      { id: "promptshield", name: "PromptShield", status: "enforced", blocked24h: countsByEngine.promptshield || 0, ruleVersion: "3.1.0", detail: "Prompt injection & tool-escape boundary filter" },
      { id: "web-sec-auditor", name: "web-sec-auditor", status: "active", blocked24h: countsByEngine["web-sec-auditor"] || 0, ruleVersion: "2.0.5", detail: "CSP, SSRF, Open Redirect & HTTP header scanner" },
    ],
    events,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    engine?: string;
    severity?: string;
    ruleId?: string;
    summary?: string;
    blocked?: boolean;
    metadata?: Record<string, unknown>;
  };

  const engine = String(body.engine || "").trim().toLowerCase();
  if (!ALLOWED_ENGINES.has(engine)) {
    return NextResponse.json({ error: "Unsupported RitualDev defense engine" }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization");
  const bearerKey = authHeader?.replace(/^Bearer\s+/i, "").trim();
  let projectId = body.projectId?.trim() || "";
  let userId = "system-defense";
  let actorUsername = engine;

  if (bearerKey) {
    const verified = await verifyTelemetryApiKey(bearerKey);
    if (!verified) return NextResponse.json({ error: "Invalid API key" }, { status: 403 });
    projectId = verified.id;
    userId = verified.userId;
  } else {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    const access = await resolveProjectAccess(projectId, user);
    if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    userId = user.id;
    actorUsername = user.githubUsername;
  }

  const scrubbedMeta = scrubTelemetryValue({
    severity: String(body.severity || "HIGH").toUpperCase(),
    ruleId: String(body.ruleId || "DEF-LIVE").slice(0, 64),
    summary: String(body.summary || "Policy rule triggered").slice(0, 300),
    ...(body.metadata || {}),
  }) as Record<string, unknown>;

  await recordAuditEvent({
    userId,
    actorUsername,
    projectId,
    action: `defense.${engine}`,
    resourceType: "defense_finding",
    resourceId: String(scrubbedMeta.ruleId || engine),
    status: body.blocked === false ? "success" : "denied",
    headers: req.headers,
    metadata: scrubbedMeta,
  });

  return NextResponse.json({ ok: true, engine, ruleId: scrubbedMeta.ruleId });
}
