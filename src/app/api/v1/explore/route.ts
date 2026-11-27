import { NextRequest, NextResponse } from "next/server";
import { client } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { compileNlToSafeSql, validateReadOnlySelectSql } from "@/lib/analytics/nl-explorer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    prompt?: string;
    sql?: string;
    isDemo?: boolean;
  };

  const projectId = String(body.projectId || "demo").trim();
  const prompt = String(body.prompt || "").trim();
  const customSql = String(body.sql || "").trim();

  const compiled = prompt
    ? compileNlToSafeSql(prompt, projectId)
    : {
        intentLabel: "Custom Scoped SELECT Query",
        sql: customSql,
        columns: [] as string[],
        description: "Executed read-only against tenant-scoped telemetry store.",
      };

  const targetSql = customSql || compiled.sql;
  const check = validateReadOnlySelectSql(targetSql);
  if (!check.valid) {
    return NextResponse.json(
      { error: check.reason || "Query rejected by SQL guardrail", sql: targetSql },
      { status: 400 }
    );
  }

  if (body.isDemo || projectId === "demo") {
    const demoRows = prompt.toLowerCase().includes("mcp")
      ? [
          { server_name: "devpulse-mcp", tool_name: "analyze_crash_stack", total_calls: 1842, cost_usd: 0.421 },
          { server_name: "devpulse-mcp", tool_name: "query_sbom_vulns", total_calls: 940, cost_usd: 0.118 },
          { server_name: "ritual-code-mcp", tool_name: "check_pr_regression", total_calls: 615, cost_usd: 0.279 },
        ]
      : prompt.toLowerCase().includes("crash") || prompt.toLowerCase().includes("error")
      ? [
          { error_name: "TypeError", route_path: "/api/v1/checkout", hits: 42, last_seen: "2026-11-27 10:12:00" },
          { error_name: "TimeoutError", route_path: "/api/v1/webhooks/stripe", hits: 19, last_seen: "2026-11-27 09:48:00" },
          { error_name: "RangeError", route_path: "/dashboard/traces", hits: 7, last_seen: "2026-11-26 22:30:00" },
        ]
      : [
          { day: "2026-11-27", country_code: "US", events: 1420, unique_users: 412 },
          { day: "2026-11-27", country_code: "DE", events: 690, unique_users: 208 },
          { day: "2026-11-27", country_code: "IN", events: 540, unique_users: 195 },
        ];

    return NextResponse.json({
      source: "demo_snapshot",
      intentLabel: compiled.intentLabel,
      description: compiled.description,
      sql: targetSql,
      columns: Object.keys(demoRows[0] || {}),
      rows: demoRows,
    });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await resolveProjectAccess(projectId, user);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const res = await client.execute(targetSql);
    return NextResponse.json({
      source: "live_db",
      intentLabel: compiled.intentLabel,
      description: compiled.description,
      sql: targetSql,
      columns: res.columns,
      rows: res.rows.slice(0, 50),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Query execution failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }
}
