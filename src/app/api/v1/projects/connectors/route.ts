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
import { ECOSYSTEM_WIDGET_DEFS } from "@/lib/dashboard/ecosystem-widgets";
import { refreshProjectSnapshots, syncEcosystemWidgetsAndSnapshots } from "@/lib/dashboard/snapshots";
import { normalizeRegistryProvider, REGISTRY_ADAPTERS } from "@/lib/integrations/registry-adapter";
import { buildDefaultLayout } from "@/lib/layout/grid-engine";
import { isValidPublicMonitorUrl, runMonitorCheck } from "@/lib/monitors/checker";
import { fetchNpmOrgPackages } from "@/lib/integrations/npm";
import { scanGitHubRepository } from "@/lib/scanner/github-scanner";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { decryptSecret } from "@/lib/security/crypto";
import { validatePublicUrl } from "@/lib/security/ssrf";
import { fetchExternalAnalyticsSnapshot } from "@/lib/integrations/ga4";
import { isPublicDemoProject } from "@/lib/security/demo-project";
import { apiError } from "@/lib/security/api-error";
import { summarizeRevenue } from "@/lib/revenue/connector-totals";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (!isPublicDemoProject(projectId)) {
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

    if (action === "discover_github") {
      const repoInput = String(body.repo || "").trim();
      const ownership = await verifyGitHubRepoOwnership(user, repoInput);
      if (!ownership.allowed) {
        return NextResponse.json(
          { error: ownership.reason || "You can only auto-discover GitHub repos you own or maintain." },
          { status: 403 }
        );
      }
      const projToken = await decryptSecret(access.project.githubTokenEncrypted).catch(() => null);
      const token = projToken || ownership.token || (await getUserGitHubAccessToken(user.id).catch(() => null));
      const scanned = await scanGitHubRepository(ownership.githubRepo, token || undefined);
      return NextResponse.json({
        success: true,
        githubRepo: scanned.githubRepo,
        detectedEcosystems: scanned.detectedEcosystems,
        summary: scanned.summary,
      });
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

          // Auto-discover package.json, Cargo.toml, pyproject.toml, go.mod, Dockerfile from GitHub
          try {
            const projToken = await decryptSecret(access.project.githubTokenEncrypted).catch(() => null);
            const ghToken = projToken || (await getUserGitHubAccessToken(user.id).catch(() => null));
            const scanned = await scanGitHubRepository(updateFields.githubRepo, ghToken || undefined);
            const eco = scanned.detectedEcosystems;
            if (eco.npmPackage && !updateFields.npmPackage) {
              updateFields.npmPackage = eco.npmPackage;
              detectedSummary.push(`Auto-detected npm (${eco.npmPackage})`);
            }
            if (eco.pypiPackage && !updateFields.pypiPackage) {
              updateFields.pypiPackage = eco.pypiPackage;
              detectedSummary.push(`Auto-detected PyPI (${eco.pypiPackage})`);
            }
            if (eco.rustCrate && !updateFields.rustCrate) {
              updateFields.rustCrate = eco.rustCrate;
              detectedSummary.push(`Auto-detected Crate (${eco.rustCrate})`);
            }
            if (eco.goModule && !updateFields.goModule) {
              updateFields.goModule = eco.goModule;
              detectedSummary.push(`Auto-detected Go (${eco.goModule})`);
            }
            if (eco.dockerImage && !updateFields.dockerImage) {
              updateFields.dockerImage = eco.dockerImage;
              detectedSummary.push(`Auto-detected Docker (${eco.dockerImage})`);
            }
            if (eco.vscodeExtension && !updateFields.vscodeExtension) {
              updateFields.vscodeExtension = eco.vscodeExtension;
              detectedSummary.push(`Auto-detected VS Code (${eco.vscodeExtension})`);
            }
            if (eco.mcpServerName && !updateFields.mcpServerName) {
              updateFields.mcpServerName = eco.mcpServerName;
              detectedSummary.push(`Auto-detected MCP (${eco.mcpServerName})`);
            }
          } catch {
            // Best-effort auto-discovery
          }
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
        } else {
          const pkgProvider = normalizeRegistryProvider(item.kind);
          if (pkgProvider && item.value) {
            const connId = `con_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
            await db.insert(projectConnectors).values({
              id: connId,
              projectId,
              category: "package",
              provider: pkgProvider,
              label: item.label,
              targetUrl: item.normalizedUrl || REGISTRY_ADAPTERS[pkgProvider].buildUrl(item.value),
              identifier: item.value,
              lastSyncedAt: new Date().toISOString(),
            });
            detectedSummary.push(item.label);
          }
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

      if (typeof body.dockerToken === "string") {
        const t = body.dockerToken.trim();
        if (t && !t.startsWith("••")) {
          const encDocker = await encryptSecret(t);
          await db.insert(projectConnectors).values({
            id: `con_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
            projectId,
            category: "package",
            provider: "docker",
            label: "Docker Hub PAT",
            identifier: updateFields.dockerImage || access.project.dockerImage || null,
            credentialsEncrypted: encDocker,
          });
          detectedSummary.push("Docker Hub PAT (Encrypted)");
        }
      }

      if (body.npmOrg) {
        const orgPkgs = await fetchNpmOrgPackages(
          String(body.npmOrg),
          typeof body.npmToken === "string" && !body.npmToken.startsWith("••") ? body.npmToken : null
        );
        if (orgPkgs.length > 0 && !updateFields.npmPackage && !access.project.npmPackage) {
          updateFields.npmPackage = orgPkgs[0];
          detectedSummary.push(`npm org discovered ${orgPkgs.length} package(s)`);
        }
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

      const changedFields = ECOSYSTEM_WIDGET_DEFS
        .map((d) => d.field)
        .filter((f) => Object.prototype.hasOwnProperty.call(updateFields, f));
      if (updateFields.npmTokenEncrypted !== undefined && !changedFields.includes("npmPackage")) {
        changedFields.push("npmPackage");
      }
      if (typeof body.dockerToken === "string" && body.dockerToken.trim() && !changedFields.includes("dockerImage")) {
        changedFields.push("dockerImage");
      }
      if (changedFields.length > 0) {
        await syncEcosystemWidgetsAndSnapshots({
          projectId,
          userIdForOAuth: user.id,
          changedFields,
        });
      }
      if (parsedItems.some((item) => !item.field && normalizeRegistryProvider(item.kind) !== null)) {
        await refreshProjectSnapshots(
          { ...access.project, ...updateFields },
          { userIdForOAuth: user.id, keys: ["package_connectors", "security"] }
        ).catch(() => {});
      }

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
      if (targetUrl) {
        const urlCheck = validatePublicUrl(targetUrl, { allowHttp: false });
        if (!urlCheck.valid) {
          return NextResponse.json(
            { error: `Unsafe connector targetUrl: ${urlCheck.reason}` },
            { status: 400 }
          );
        }
      }
      const identifier = body.identifier ? String(body.identifier).trim().slice(0, 160) : null;
      const rawSecret = body.apiKey ? String(body.apiKey).trim() : "";

      const encrypted = rawSecret ? await encryptSecret(rawSecret) : null;
      let metadata: Record<string, any> = {};

      if (category === "analytics") {
        try {
          metadata = await fetchExternalAnalyticsSnapshot({
            provider,
            identifier,
            targetUrl,
            credential: rawSecret || null,
          });
        } catch (analyticsErr: any) {
          return apiError(analyticsErr, `Failed to verify ${provider.toUpperCase()} analytics credentials.`, 400);
        }
      }

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
          const res = await fetch("https://api.gumroad.com/v2/sales", {
            headers: { Authorization: `Bearer ${rawSecret}` },
          }).catch(() => null);
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
              Object.assign(metadata, summarizeRevenue(json.items.map((o: any) => ({ amountMinor: Number(o.amount || 0), currency: o.currency })), "USD"));
            }
          }
        } else if (provider === "paddle") {
          const res = await fetch("https://api.paddle.com/transactions?per_page=25", {
            headers: { Authorization: `Bearer ${rawSecret}` },
          }).catch(() => null);
          if (res?.ok) {
            const json = await res.json();
            const rows = Array.isArray(json.data) ? json.data : [];
            metadata.totalSales = rows.length;
            Object.assign(metadata, summarizeRevenue(rows.map((r: any) => ({ amountMinor: Number(r.details?.totals?.total || 0), currency: r.currency_code })), "USD"));
          }
        } else if (provider === "razorpay") {
          const authHeader = rawSecret.includes(":")
            ? `Basic ${Buffer.from(rawSecret).toString("base64")}`
            : `Bearer ${rawSecret}`;
          const res = await fetch("https://api.razorpay.com/v1/payments?count=25", {
            headers: { Authorization: authHeader },
          }).catch(() => null);
          if (res?.ok) {
            const json = await res.json();
            const items = Array.isArray(json.items) ? json.items : [];
            metadata.totalSales = items.length;
            Object.assign(metadata, summarizeRevenue(items.filter((p: any) => p.status === "captured").map((p: any) => ({ amountMinor: Number(p.amount || 0), currency: p.currency })), "INR"));
          }
        } else if (provider === "custom" && targetUrl) {
          const headers: Record<string, string> = { Accept: "application/json" };
          if (rawSecret) headers.Authorization = `Bearer ${rawSecret}`;
          const res = await fetch(targetUrl, { headers }).catch(() => null);
          if (res?.ok) {
            const json = await res.json();
            metadata.totalRevenueCents = Math.round((Number(json.mrr ?? json.totalRevenue ?? 0) || 0) * 100);
            metadata.totalSales = Number(json.payingCustomers ?? json.activeSubscriptions ?? 0) || 0;
            metadata.currency = String(json.currency || "USD").toUpperCase();
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

    if (action === "add_package_connector") {
      if (!access.canWrite) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const providerId = normalizeRegistryProvider(String(body.provider || ""));
      const identifier = String(body.identifier || "").trim().slice(0, 200);
      if (!providerId || !identifier) {
        return NextResponse.json({ error: "Valid registry provider and package identifier required" }, { status: 400 });
      }

      const meta = REGISTRY_ADAPTERS[providerId];
      const label = String(body.label || `${meta.label}: ${identifier}`).trim().slice(0, 120);
      const rawUrl = String(body.targetUrl || "").trim();
      const validatedUrl = rawUrl ? validatePublicUrl(rawUrl) : null;
      const targetUrl = validatedUrl?.valid && validatedUrl.normalized
        ? validatedUrl.normalized
        : meta.buildUrl(identifier);

      const primaryField = meta.projectField;
      const primaryValue = primaryField ? access.project[primaryField] : null;
      if (primaryField && (!primaryValue || !String(primaryValue).trim())) {
        const updatePayload: Record<string, unknown> = {
          [primaryField]: identifier,
          updatedAt: new Date().toISOString(),
        };
        await db.update(projects).set(updatePayload).where(eq(projects.id, projectId));
        await syncEcosystemWidgetsAndSnapshots({
          projectId,
          userIdForOAuth: user.id,
          changedFields: [primaryField],
        });
        await refreshProjectSnapshots(
          { ...access.project, [primaryField]: identifier },
          { userIdForOAuth: user.id, keys: ["security"] }
        ).catch(() => {});

        await recordAuditEvent({
          userId: user.id,
          actorUsername: user.githubUsername,
          organizationId: access.project.organizationId,
          projectId,
          action: "project.package_attached",
          resourceType: "project",
          resourceId: projectId,
          headers: req.headers,
          metadata: { provider: meta.id, identifier, mode: "primary" },
        });

        return NextResponse.json({
          success: true,
          mode: "primary",
          provider: meta.id,
          identifier,
        });
      }

      if (primaryValue && String(primaryValue).trim().toLowerCase() === identifier.toLowerCase()) {
        return NextResponse.json({
          success: true,
          mode: "already_tracked",
          provider: meta.id,
          identifier,
        });
      }

      const existingConn = await db
        .select({ id: projectConnectors.id })
        .from(projectConnectors)
        .where(
          and(
            eq(projectConnectors.projectId, projectId),
            eq(projectConnectors.category, "package"),
            eq(projectConnectors.provider, meta.id),
            eq(projectConnectors.identifier, identifier)
          )
        )
        .limit(1);

      if (existingConn.length > 0) {
        return NextResponse.json({
          success: true,
          mode: "already_tracked",
          connectorId: existingConn[0].id,
          provider: meta.id,
          identifier,
        });
      }

      const rawSecret = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const encrypted = rawSecret ? await encryptSecret(rawSecret) : null;
      const id = `con_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

      await db.insert(projectConnectors).values({
        id,
        projectId,
        category: "package",
        provider: meta.id,
        label,
        targetUrl,
        identifier,
        credentialsEncrypted: encrypted,
        lastSyncedAt: new Date().toISOString(),
      });

      await refreshProjectSnapshots(access.project, {
        userIdForOAuth: user.id,
        keys: ["package_connectors", "security"],
      }).catch(() => {});

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        projectId,
        action: "connector.added",
        resourceType: "project_connector",
        resourceId: id,
        headers: req.headers,
        metadata: { category: "package", provider: meta.id, identifier },
      });

      return NextResponse.json(
        { success: true, mode: "connector", connectorId: id, provider: meta.id, identifier },
        { status: 201 }
      );
    }

    if (action === "sync_connector") {
      const connectorId = String(body.connectorId || "");
      const [conn] = await db
        .select()
        .from(projectConnectors)
        .where(and(eq(projectConnectors.id, connectorId), eq(projectConnectors.projectId, projectId)))
        .limit(1);

      if (!conn) {
        return NextResponse.json({ error: "Connector not found" }, { status: 404 });
      }

      const decrypted = conn.credentialsEncrypted
        ? await decryptSecret(conn.credentialsEncrypted).catch(() => null)
        : null;

      let metadata: Record<string, any> = {};
      if (conn.category === "analytics") {
        metadata = await fetchExternalAnalyticsSnapshot({
          provider: conn.provider,
          identifier: conn.identifier,
          targetUrl: conn.targetUrl,
          credential: decrypted,
        });
      }

      const nowIso = new Date().toISOString();
      await db
        .update(projectConnectors)
        .set({
          metadataJson: JSON.stringify(metadata),
          lastSyncedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(projectConnectors.id, conn.id));

      return NextResponse.json({ success: true, metadata, lastSyncedAt: nowIso });
    }

    if (action === "delete_connector") {
      if (!access.canWrite) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const connectorId = String(body.connectorId || "");
      const [existing] = await db
        .select({ id: projectConnectors.id, category: projectConnectors.category })
        .from(projectConnectors)
        .where(and(eq(projectConnectors.id, connectorId), eq(projectConnectors.projectId, projectId)))
        .limit(1);

      await db
        .delete(projectConnectors)
        .where(and(eq(projectConnectors.id, connectorId), eq(projectConnectors.projectId, projectId)));

      if (existing?.category === "package") {
        await refreshProjectSnapshots(access.project, {
          userIdForOAuth: user.id,
          keys: ["package_connectors"],
        }).catch(() => {});
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported connector action" }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/v1/projects/connectors error:", err);
    return NextResponse.json({ error: "Connector update failed" }, { status: 500 });
  }
}
