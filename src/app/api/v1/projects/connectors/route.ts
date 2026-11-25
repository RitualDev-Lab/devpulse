import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dashboardWidgets, projectConnectors, projects, uptimeMonitors } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { encryptSecret } from "@/lib/security/crypto";
import { recordAuditEvent } from "@/lib/security/audit";
import { verifyGitHubRepoOwnership } from "@/lib/security/github-ownership";
import { parseMultipleConnectorInputs } from "@/lib/integrations/url-parser";
import { normalizeStackPreset, STACK_PRESETS } from "@/lib/dashboard/presets";
import { buildDefaultLayout } from "@/lib/layout/grid-engine";
import { isValidPublicMonitorUrl, runMonitorCheck } from "@/lib/monitors/checker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (projectId !== "prj_ritual_core") {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [proj] = await db
      .select({
        id: projects.id,
        stackPreset: projects.stackPreset,
        npmTokenEncrypted: projects.npmTokenEncrypted,
        githubTokenEncrypted: projects.githubTokenEncrypted,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const connectors = await db
      .select({
        id: projectConnectors.id,
        category: projectConnectors.category,
        provider: projectConnectors.provider,
        label: projectConnectors.label,
        targetUrl: projectConnectors.targetUrl,
        identifier: projectConnectors.identifier,
        metadataJson: projectConnectors.metadataJson,
        lastSyncedAt: projectConnectors.lastSyncedAt,
        createdAt: projectConnectors.createdAt,
        hasCredentials: projectConnectors.credentialsEncrypted,
      })
      .from(projectConnectors)
      .where(eq(projectConnectors.projectId, projectId))
      .orderBy(desc(projectConnectors.createdAt));

    return NextResponse.json({
      stackPreset: proj?.stackPreset || "saas",
      hasNpmToken: Boolean(proj?.npmTokenEncrypted),
      hasGithubToken: Boolean(proj?.githubTokenEncrypted),
      connectors: connectors.map((c) => ({
        ...c,
        hasCredentials: Boolean(c.hasCredentials),
      })),
    });
  } catch (err: any) {
    console.error("GET /api/v1/projects/connectors error:", err);
    return NextResponse.json({ error: "Failed to load connectors" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const action = String(body.action || "quick_connect");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "quick_connect") {
      const pastedLinks = String(body.linksText || "");
      const parsedItems = pastedLinks ? parseMultipleConnectorInputs(pastedLinks) : [];

      const updateFields: Record<string, any> = {
        updatedAt: new Date().toISOString(),
      };

      const detectedSummary: string[] = [];

      for (const item of parsedItems) {
        if (item.field === "githubRepo") {
          if (item.value.toLowerCase() !== (access.project.githubRepo || "").toLowerCase()) {
            const ownership = await verifyGitHubRepoOwnership(user, item.value);
            if (!ownership.allowed) {
              return NextResponse.json(
                { error: ownership.reason || `You do not own GitHub repo ${item.value}` },
                { status: 403 }
              );
            }
            updateFields.githubRepo = ownership.githubRepo;
          } else {
            updateFields.githubRepo = item.value;
          }
          detectedSummary.push(item.label);
        } else if (item.field) {
          updateFields[item.field] = item.value;
          detectedSummary.push(item.label);
        } else if (item.kind === "uptime") {
          const check = isValidPublicMonitorUrl(item.value);
          if (check.valid && check.normalized) {
            const monId = `mon_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
            await db.insert(uptimeMonitors).values({
              id: monId,
              projectId,
              name: item.label,
              url: check.normalized,
              method: "GET",
              expectedStatus: 200,
              intervalMinutes: 5,
              isActive: true,
            });
            await runMonitorCheck(monId, "quick-connect").catch(() => {});
            detectedSummary.push(item.label);
          }
        } else if (item.kind === "payment") {
          const connId = `con_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
          await db.insert(projectConnectors).values({
            id: connId,
            projectId,
            category: "payment",
            provider: item.provider,
            label: item.label,
            targetUrl: item.normalizedUrl || item.value,
            identifier: item.provider,
          });
          detectedSummary.push(item.label);
        }
      }

      if (typeof body.npmToken === "string") {
        const t = body.npmToken.trim();
        if (!t) updateFields.npmTokenEncrypted = null;
        else if (!t.startsWith("••")) updateFields.npmTokenEncrypted = await encryptSecret(t);
      }

      if (typeof body.githubToken === "string") {
        const t = body.githubToken.trim();
        if (!t) updateFields.githubTokenEncrypted = null;
        else if (!t.startsWith("••")) updateFields.githubTokenEncrypted = await encryptSecret(t);
      }

      if (body.stackPreset) {
        const presetId = normalizeStackPreset(String(body.stackPreset));
        updateFields.stackPreset = presetId;

        if (body.applyPresetWidgets) {
          const preset = STACK_PRESETS[presetId];
          await db.delete(dashboardWidgets).where(eq(dashboardWidgets.projectId, projectId));
          const layout = buildDefaultLayout(preset.recommendedWidgets);
          if (layout.length > 0) {
            await db.insert(dashboardWidgets).values(
              layout.map((w) => ({
                id: `w_${projectId}_${w.id}`.slice(0, 128),
                projectId,
                widgetType: w.id,
                title: w.title,
                positionX: w.x,
                positionY: w.y,
                width: w.w,
                height: w.h,
                isVisible: w.isVisible,
              }))
            );
          }
        }
      }

      await db.update(projects).set(updateFields).where(eq(projects.id, projectId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        projectId,
        action: "project.quick_connected",
        resourceType: "project",
        resourceId: projectId,
        headers: req.headers,
        metadata: { detectedSummary, preset: updateFields.stackPreset || access.project.stackPreset },
      });

      return NextResponse.json({
        success: true,
        detectedSummary,
        parsedItems,
      });
    }

    if (action === "add_connector") {
      const category = ["payment", "package", "analytics", "telemetry", "custom"].includes(body.category)
        ? body.category
        : "payment";
      const provider = String(body.provider || "custom").trim().slice(0, 48);
      const label = String(body.label || provider).trim().slice(0, 80);
      const targetUrl = body.targetUrl ? String(body.targetUrl).trim().slice(0, 500) : null;
      const identifier = body.identifier ? String(body.identifier).trim().slice(0, 160) : null;
      const rawSecret = body.apiKey ? String(body.apiKey).trim() : "";

      const encrypted = rawSecret ? await encryptSecret(rawSecret) : null;
      const metadata: Record<string, any> = {};

      // Optional instant balance/revenue probe for custom/LemonSqueezy/Polar/Gumroad keys
      if (category === "payment" && rawSecret) {
        if (provider === "lemonsqueezy") {
          const res = await fetch("https://api.lemonsqueezy.com/v1/stores", {
            headers: { Authorization: `Bearer ${rawSecret}`, Accept: "application/vnd.api+json" },
          }).catch(() => null);
          if (res?.ok) {
            const json = await res.json();
            const first = json.data?.[0]?.attributes;
            if (first) {
              metadata.storeName = first.name;
              metadata.totalSales = first.total_sales || 0;
              metadata.totalRevenueCents = first.total_revenue || 0;
              metadata.currency = first.currency || "USD";
            }
          }
        } else if (provider === "gumroad") {
          const res = await fetch(`https://api.gumroad.com/v2/sales?access_token=${encodeURIComponent(rawSecret)}`).catch(() => null);
          if (res?.ok) {
            const json = await res.json();
            if (Array.isArray(json.sales)) {
              metadata.totalSales = json.sales.length;
              metadata.totalRevenueCents = json.sales.reduce((acc: number, s: any) => acc + Number(s.price || 0), 0);
              metadata.currency = "USD";
            }
          }
        } else if (provider === "polar") {
          const res = await fetch("https://api.polar.sh/v1/orders/", {
            headers: { Authorization: `Bearer ${rawSecret}` },
          }).catch(() => null);
          if (res?.ok) {
            const json = await res.json();
            if (Array.isArray(json.items)) {
              metadata.totalSales = json.items.length;
              metadata.totalRevenueCents = json.items.reduce((acc: number, o: any) => acc + Number(o.amount || 0), 0);
              metadata.currency = "USD";
            }
          }
        }
      }

      const id = `con_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await db.insert(projectConnectors).values({
        id,
        projectId,
        category,
        provider,
        label,
        targetUrl,
        identifier,
        credentialsEncrypted: encrypted,
        metadataJson: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
        lastSyncedAt: new Date().toISOString(),
      });

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        projectId,
        action: "connector.added",
        resourceType: "project_connector",
        resourceId: id,
        headers: req.headers,
        metadata: { category, provider, label },
      });

      return NextResponse.json({ success: true, connectorId: id, metadata }, { status: 201 });
    }

    if (action === "delete_connector") {
      const connectorId = String(body.connectorId || "");
      await db
        .delete(projectConnectors)
        .where(and(eq(projectConnectors.id, connectorId), eq(projectConnectors.projectId, projectId)));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported connector action" }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/v1/projects/connectors error:", err);
    return NextResponse.json({ error: "Connector update failed" }, { status: 500 });
  }
}
