import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { getClientIp } from "./rate-limit";

export interface AuditEventInput {
  userId: string;
  actorUsername: string;
  organizationId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  status?: "success" | "denied";
  headers?: Headers;
  metadata?: Record<string, unknown>;
}

/**
 * Appends an immutable security audit record to Turso audit_logs.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const ipAddress = input.headers ? getClientIp(input.headers) : null;
    const userAgent = input.headers?.get("user-agent")?.slice(0, 240) || null;

    await db.insert(auditLogs).values({
      id: `aud_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
      userId: input.userId,
      actorUsername: input.actorUsername,
      organizationId: input.organizationId || null,
      workspaceId: input.workspaceId || null,
      projectId: input.projectId || null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
      status: input.status || "success",
      ipAddress,
      userAgent,
      metadataJson: input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null,
    });
  } catch (err) {
    console.warn("Audit log write warning:", err);
  }
}
