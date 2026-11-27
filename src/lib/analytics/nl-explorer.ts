/**
 * Safe Natural-Language to Read-Only SQL Compiler & Guardrails
 * Translates natural analytical prompts into project-scoped SELECT SQL
 * and strictly blocks mutating or multi-statement SQL injection attempts.
 */

export interface CompiledNlQuery {
  intentLabel: string;
  sql: string;
  columns: string[];
  description: string;
}

const FORBIDDEN_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|EXEC|EXECUTE|GRANT|REVOKE|MERGE)\b/i;

export function validateReadOnlySelectSql(sql: string): { valid: boolean; reason?: string } {
  const trimmed = sql.trim();
  if (!trimmed) return { valid: false, reason: "Empty SQL query" };
  // Strip single trailing semicolon for validation; forbid mid-query semicolons or SQL comments
  const withoutTrailingSemi = trimmed.replace(/;+$/, "");
  if (withoutTrailingSemi.includes(";")) {
    return { valid: false, reason: "Multiple SQL statements are not allowed" };
  }
  if (/--|\/\*/.test(withoutTrailingSemi)) {
    return { valid: false, reason: "SQL comments are rejected in read-only explorer queries" };
  }
  if (!/^(SELECT|WITH)\b/i.test(withoutTrailingSemi)) {
    return { valid: false, reason: "Only read-only SELECT queries are permitted" };
  }
  if (FORBIDDEN_SQL_RE.test(withoutTrailingSemi)) {
    return { valid: false, reason: "Forbidden mutating or administrative SQL keyword detected" };
  }
  if (!/project_id\s*=/i.test(withoutTrailingSemi)) {
    return { valid: false, reason: "All workspace queries must include project_id tenant scoping" };
  }
  return { valid: true };
}

export function compileNlToSafeSql(prompt: string, projectId: string): CompiledNlQuery {
  const p = prompt.toLowerCase();
  const safeProjLiteral = `'${projectId.replace(/[^a-zA-Z0-9_-]/g, "")}'`;

  if (p.includes("crash") || p.includes("error") || p.includes("bug") || p.includes("route")) {
    return {
      intentLabel: "Top Error Routes & Unresolved Crashes",
      sql: `SELECT error_name, route_path, COUNT(*) AS hits, MAX(created_at) AS last_seen\nFROM error_events\nWHERE project_id = ${safeProjLiteral}\nGROUP BY error_name, route_path\nORDER BY hits DESC\nLIMIT 15`,
      columns: ["error_name", "route_path", "hits", "last_seen"],
      description: "Groups runtime crashes and route impact sorted by frequency.",
    };
  }

  if (p.includes("mcp") || p.includes("agent") || p.includes("ai") || p.includes("cost") || p.includes("token")) {
    return {
      intentLabel: "MCP AI Agent Tool Usage & Cost",
      sql: `SELECT server_name, tool_name, SUM(calls_count) AS total_calls, ROUND(SUM(estimated_cost_usd), 4) AS cost_usd\nFROM mcp_tool_calls\nWHERE project_id = ${safeProjLiteral}\nGROUP BY server_name, tool_name\nORDER BY total_calls DESC\nLIMIT 15`,
      columns: ["server_name", "tool_name", "total_calls", "cost_usd"],
      description: "Aggregates MCP tool invocation velocity and estimated token spend.",
    };
  }

  if (p.includes("deploy") || p.includes("dora") || p.includes("release") || p.includes("rollback")) {
    return {
      intentLabel: "Deployment Velocity & Stability",
      sql: `SELECT release_version, environment, status, commit_sha, created_at\nFROM deployments\nWHERE project_id = ${safeProjLiteral}\nORDER BY created_at DESC\nLIMIT 20`,
      columns: ["release_version", "environment", "status", "commit_sha", "created_at"],
      description: "Lists recent deployments and release health status for DORA tracking.",
    };
  }

  if (p.includes("package") || p.includes("download") || p.includes("npm") || p.includes("pypi")) {
    return {
      intentLabel: "Package Registry Daily Downloads",
      sql: `SELECT date, source, metric_type, SUM(value) AS downloads\nFROM daily_metrics\nWHERE project_id = ${safeProjLiteral}\nGROUP BY date, source, metric_type\nORDER BY date DESC\nLIMIT 30`,
      columns: ["date", "source", "metric_type", "downloads"],
      description: "Daily download velocity snapshots across connected package ecosystems.",
    };
  }

  return {
    intentLabel: "Daily Active Sessions & Geographic Traffic",
    sql: `SELECT date(created_at / 1000, 'unixepoch') AS day, country_code, COUNT(*) AS events, COUNT(DISTINCT visitor_id) AS unique_users\nFROM pageviews\nWHERE project_id = ${safeProjLiteral}\nGROUP BY day, country_code\nORDER BY day DESC, events DESC\nLIMIT 25`,
    columns: ["day", "country_code", "events", "unique_users"],
    description: "Privacy-safe DAU, country distribution, and pageview breakdown.",
  };
}
