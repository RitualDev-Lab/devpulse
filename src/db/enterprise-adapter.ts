/**
 * Enterprise Dual-Mode Storage Adapter
 * Supports:
 * - "edge": Managed Cloud / Turso libSQL + R2 (default DevPulse SaaS)
 * - "lean": Single-VPC PostgreSQL 16 + TimescaleDB hypertables + S3/MinIO
 * - "scale": High-throughput PostgreSQL 16 + ClickHouse OLAP analytics + S3/MinIO
 */

export type EnterpriseStorageMode = "edge" | "lean" | "scale";

export interface DualStorageConfig {
  mode: EnterpriseStorageMode;
  postgresUrl?: string;
  clickhouseUrl?: string;
  timescaleEnabled: boolean;
  enforcePostgresRls: boolean;
  airgappedZeroEgress: boolean;
}

export function resolveEnterpriseStorageConfig(
  env: Record<string, string | undefined> = process.env
): DualStorageConfig {
  const rawMode = (env.DEVPULSE_STORAGE_MODE || "edge").toLowerCase();
  const mode: EnterpriseStorageMode =
    rawMode === "lean" || rawMode === "scale" ? rawMode : "edge";

  return {
    mode,
    postgresUrl: env.POSTGRES_DATABASE_URL?.trim() || undefined,
    clickhouseUrl: env.CLICKHOUSE_URL?.trim() || undefined,
    timescaleEnabled: mode === "lean",
    enforcePostgresRls:
      env.DEVPULSE_ENFORCE_PG_RLS === "true" || mode === "lean" || mode === "scale",
    airgappedZeroEgress: env.DEVPULSE_AIRGAPPED === "true",
  };
}

export function validateEnterpriseStorageConfig(cfg: DualStorageConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if ((cfg.mode === "lean" || cfg.mode === "scale") && !cfg.postgresUrl) {
    errors.push(`Mode "${cfg.mode}" requires POSTGRES_DATABASE_URL`);
  }
  if (cfg.mode === "scale" && !cfg.clickhouseUrl) {
    errors.push('Mode "scale" requires CLICKHOUSE_URL for analytical queries');
  }
  if ((cfg.mode === "lean" || cfg.mode === "scale") && !cfg.enforcePostgresRls) {
    errors.push("Enterprise VPC modes require PostgreSQL Row-Level Security enabled");
  }
  return { valid: errors.length === 0, errors };
}
