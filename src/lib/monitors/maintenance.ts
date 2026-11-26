import { db } from "@/db";
import { projectConnectors } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  formatMaintenanceWindowRow,
  isWindowActiveAt,
  parseMaintenanceMetadata,
  type MaintenanceMetadata,
  type MaintenanceWindowRecord,
} from "./maintenance-eval";

export {
  formatMaintenanceWindowRow,
  isWindowActiveAt,
  parseMaintenanceMetadata,
  type MaintenanceMetadata,
  type MaintenanceWindowRecord,
};

export async function listProjectMaintenanceWindows(
  projectId: string,
  nowMs = Date.now()
): Promise<MaintenanceWindowRecord[]> {
  const rows = await db
    .select({
      id: projectConnectors.id,
      label: projectConnectors.label,
      metadataJson: projectConnectors.metadataJson,
    })
    .from(projectConnectors)
    .where(
      and(
        eq(projectConnectors.projectId, projectId),
        eq(projectConnectors.category, "telemetry"),
        eq(projectConnectors.provider, "maintenance_window")
      )
    );

  return rows
    .map((r) => formatMaintenanceWindowRow(r, nowMs))
    .filter((w): w is MaintenanceWindowRecord => Boolean(w))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}

export async function isProjectInMaintenanceWindow(
  projectId: string,
  nowMs = Date.now()
): Promise<MaintenanceWindowRecord | null> {
  const windows = await listProjectMaintenanceWindows(projectId, nowMs);
  return windows.find((w) => w.isActiveNow && w.suppressAlerts) || null;
}
