import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import {
  organizations,
  organizationMembers,
  projects,
  users,
  workspaces,
} from "@/db/schema";
import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/security/audit";
import {
  normalizeOrgRole,
  roleAllowsBilling,
  roleAllowsSecurityAdmin,
  VALID_ORG_ROLES,
  type OrgRole,
} from "@/lib/security/rbac";
import { decryptSecret } from "@/lib/security/crypto";
import { buildRbacInviteEmailHtml, sendTransactionalEmail } from "@/lib/alerts/email";

export const dynamic = "force-dynamic";

const WORKSPACE_PLAN_DEFAULTS: Record<
  "free" | "pro" | "team" | "enterprise",
  { monthlyEventLimit: number; memberLimit: number; projectLimit: number }
> = {
  free: { monthlyEventLimit: 10_000, memberLimit: 3, projectLimit: 2 },
  pro: { monthlyEventLimit: 100_000, memberLimit: 10, projectLimit: 10 },
  team: { monthlyEventLimit: 1_000_000, memberLimit: 50, projectLimit: 50 },
  enterprise: { monthlyEventLimit: 10_000_000, memberLimit: 500, projectLimit: 500 },
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const handle = user.githubUsername.toLowerCase();
    const email = user.email ? user.email.toLowerCase() : null;

    const memberRows = await db
      .select({
        organizationId: organizationMembers.organizationId,
        status: organizationMembers.status,
      })
      .from(organizationMembers)
      .where(
        or(
          eq(organizationMembers.userId, user.id),
          eq(organizationMembers.githubUsername, handle),
          email ? sql`lower(${organizationMembers.email}) = ${email}` : sql`0`
        )
      );

    const ownedOrgs = await db
      .select()
      .from(organizations)
      .where(eq(organizations.ownerUserId, user.id))
      .orderBy(desc(organizations.createdAt));

    const activeOrgMemberIds = memberRows
      .filter((m) => m.status !== "suspended")
      .map((m) => m.organizationId);

    const orgIds = Array.from(
      new Set([...ownedOrgs.map((o) => o.id), ...activeOrgMemberIds])
    );

    const [orgsList, allMembers, allWorkspaces, ownedProjects] = await Promise.all([
      orgIds.length > 0
        ? db.select().from(organizations).where(inArray(organizations.id, orgIds))
        : [],
      orgIds.length > 0
        ? db
            .select()
            .from(organizationMembers)
            .where(inArray(organizationMembers.organizationId, orgIds))
        : [],
      orgIds.length > 0
        ? db
            .select()
            .from(workspaces)
            .where(inArray(workspaces.organizationId, orgIds))
            .orderBy(desc(workspaces.createdAt))
        : [],
      db
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          organizationId: projects.organizationId,
          workspaceId: projects.workspaceId,
        })
        .from(projects)
        .where(eq(projects.userId, user.id)),
    ]);

    const orgProjects =
      orgIds.length > 0
        ? await db
            .select({
              id: projects.id,
              name: projects.name,
              slug: projects.slug,
              organizationId: projects.organizationId,
              workspaceId: projects.workspaceId,
            })
            .from(projects)
            .where(inArray(projects.organizationId, orgIds))
        : [];

    return NextResponse.json({
      currentUser: {
        id: user.id,
        githubUsername: user.githubUsername,
        email: user.email,
      },
      organizations: orgsList.map((org) => {
        const members = allMembers
          .filter((m) => m.organizationId === org.id)
          .map((m) => ({ ...m, role: normalizeOrgRole(m.role) }));

        const myMember = members.find(
          (m) =>
            m.userId === user.id ||
            m.githubUsername === handle ||
            (email && m.email?.toLowerCase() === email)
        );
        const myRole: OrgRole =
          org.ownerUserId === user.id ? "owner" : normalizeOrgRole(myMember?.role);

        const orgWspaces = allWorkspaces
          .filter((w) => w.organizationId === org.id)
          .map((w) => ({
            ...w,
            projects: orgProjects.filter((p) => p.workspaceId === w.id),
          }));

        return {
          ...org,
          myRole,
          workspaces: orgWspaces,
          members,
        };
      }),
      ownedProjects,
    });
  } catch (err) {
    console.error("GET /api/v1/security/orgs error:", err);
    return NextResponse.json({ error: "Failed to load organizations" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const action = String(body.action || "");

    if (action === "create_org") {
      const rawName = String(body.name || "").trim();
      if (rawName.length < 2 || rawName.length > 60) {
        return NextResponse.json(
          { error: "Organization name must be 2-60 characters." },
          { status: 400 }
        );
      }
      const slugBase =
        rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";
      const orgId = `org_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      const slug = `${slugBase}-${orgId.slice(-5)}`;
      const defaultWsId = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

      await db.insert(organizations).values({
        id: orgId,
        name: rawName,
        slug,
        ownerUserId: user.id,
      });

      const planTier = user.storageTier === "team" || user.storageTier === "enterprise" ? "team" : "free";
      const planCaps = WORKSPACE_PLAN_DEFAULTS[planTier];
      await db.insert(workspaces).values({
        id: defaultWsId,
        organizationId: orgId,
        name: "Default Workspace",
        slug: "default",
        billingPlan: planTier,
        monthlyEventLimit: planCaps.monthlyEventLimit,
        monthlyEventsUsed: 0,
        memberLimit: planCaps.memberLimit,
        projectLimit: planCaps.projectLimit,
        billingEmail: user.email || null,
      });

      await db.insert(organizationMembers).values({
        id: `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        organizationId: orgId,
        workspaceId: defaultWsId,
        userId: user.id,
        githubUsername: user.githubUsername.toLowerCase(),
        email: user.email || null,
        role: "owner",
        status: "active",
        invitedByUserId: user.id,
      });

      if (body.projectId) {
        await db
          .update(projects)
          .set({
            organizationId: orgId,
            workspaceId: defaultWsId,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(projects.id, String(body.projectId)), eq(projects.userId, user.id)));
      }

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: orgId,
        workspaceId: defaultWsId,
        projectId: body.projectId ? String(body.projectId) : null,
        action: "org.created",
        resourceType: "organization",
        resourceId: orgId,
        headers: req.headers,
        metadata: { name: rawName, slug, defaultWorkspaceId: defaultWsId },
      });

      return NextResponse.json({
        success: true,
        organizationId: orgId,
        workspaceId: defaultWsId,
        name: rawName,
        slug,
      });
    }

    const organizationId = String(body.organizationId || "");
    if (!organizationId) {
      return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const email = user.email ? user.email.toLowerCase() : null;
    const [callerMember] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          or(
            eq(organizationMembers.userId, user.id),
            eq(organizationMembers.githubUsername, user.githubUsername.toLowerCase()),
            email ? sql`lower(${organizationMembers.email}) = ${email}` : sql`0`
          )
        )
      )
      .limit(1);

    const callerRole: OrgRole =
      org.ownerUserId === user.id
        ? "owner"
        : callerMember && callerMember.status !== "suspended"
        ? normalizeOrgRole(callerMember.role)
        : "viewer";

    const canAdminSecurity =
      org.ownerUserId === user.id ||
      (callerMember && callerMember.status !== "suspended" && roleAllowsSecurityAdmin(callerRole));
    const canAdminBilling =
      org.ownerUserId === user.id ||
      (callerMember && callerMember.status !== "suspended" && roleAllowsBilling(callerRole));

    if (action === "update_workspace") {
      if (!canAdminSecurity && !canAdminBilling) {
        await recordAuditEvent({
          userId: user.id,
          actorUsername: user.githubUsername,
          organizationId,
          action: "workspace.updated",
          resourceType: "workspace",
          status: "denied",
          headers: req.headers,
          metadata: { callerRole },
        });
        return NextResponse.json(
          { error: "Forbidden: Requires Owner, Admin, or Billing role." },
          { status: 403 }
        );
      }

      const workspaceId = String(body.workspaceId || "");
      const [ws] = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
        .limit(1);
      if (!ws) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }

      const billingPlan = (["free", "pro", "team", "enterprise"].includes(body.billingPlan)
        ? body.billingPlan
        : ws.billingPlan) as "free" | "pro" | "team" | "enterprise";
      const defaults = WORKSPACE_PLAN_DEFAULTS[billingPlan];

      const monthlyEventLimit = Math.max(
        1000,
        Number(body.monthlyEventLimit ?? defaults.monthlyEventLimit)
      );
      const memberLimit = Math.max(1, Number(body.memberLimit ?? defaults.memberLimit));
      const projectLimit = Math.max(1, Number(body.projectLimit ?? defaults.projectLimit));
      const billingEmail =
        body.billingEmail !== undefined
          ? String(body.billingEmail || "").trim() || null
          : ws.billingEmail;
      const name = body.name ? String(body.name).trim().slice(0, 60) : ws.name;

      await db
        .update(workspaces)
        .set({
          name,
          billingPlan,
          monthlyEventLimit,
          memberLimit,
          projectLimit,
          billingEmail,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(workspaces.id, workspaceId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        workspaceId,
        action: "workspace.updated",
        resourceType: "workspace",
        resourceId: workspaceId,
        headers: req.headers,
        metadata: {
          previousPlan: ws.billingPlan,
          newPlan: billingPlan,
          monthlyEventLimit,
          memberLimit,
          projectLimit,
        },
      });

      return NextResponse.json({ success: true });
    }

    if (!canAdminSecurity) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: `org.${action || "unknown"}`,
        resourceType: "organization_member",
        status: "denied",
        headers: req.headers,
        metadata: { role: callerRole },
      });
      return NextResponse.json(
        { error: "Forbidden: Only Organization Owners & Admins can manage RBAC, workspaces, and projects." },
        { status: 403 }
      );
    }

    if (action === "create_workspace") {
      const name = String(body.name || "").trim();
      if (name.length < 2 || name.length > 60) {
        return NextResponse.json(
          { error: "Workspace name must be 2-60 characters." },
          { status: 400 }
        );
      }
      const billingPlan = (["free", "pro", "team", "enterprise"].includes(body.billingPlan)
        ? body.billingPlan
        : "free") as "free" | "pro" | "team" | "enterprise";
      const defaults = WORKSPACE_PLAN_DEFAULTS[billingPlan];
      const wsId = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      const slug =
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
        wsId.slice(-6);

      await db.insert(workspaces).values({
        id: wsId,
        organizationId,
        name,
        slug,
        billingPlan,
        monthlyEventLimit: defaults.monthlyEventLimit,
        monthlyEventsUsed: 0,
        memberLimit: defaults.memberLimit,
        projectLimit: defaults.projectLimit,
        billingEmail: body.billingEmail ? String(body.billingEmail).trim() : user.email || null,
      });

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        workspaceId: wsId,
        action: "workspace.created",
        resourceType: "workspace",
        resourceId: wsId,
        headers: req.headers,
        metadata: { name, slug, billingPlan },
      });

      return NextResponse.json({ success: true, workspaceId: wsId, name, slug });
    }

    if (action === "assign_project") {
      const projectId = String(body.projectId || "");
      const workspaceId = body.workspaceId ? String(body.workspaceId) : null;

      const [proj] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
        .limit(1);
      if (!proj) {
        return NextResponse.json(
          { error: "Project not found or not owned by you." },
          { status: 404 }
        );
      }

      if (workspaceId) {
        const [ws] = await db
          .select()
          .from(workspaces)
          .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
          .limit(1);
        if (!ws) {
          return NextResponse.json({ error: "Target workspace not found" }, { status: 404 });
        }
        const existingInWs = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, workspaceId));
        if (
          !existingInWs.some((p) => p.id === projectId) &&
          existingInWs.length >= ws.projectLimit
        ) {
          return NextResponse.json(
            {
              error: `Workspace project limit (${ws.projectLimit}) reached. Upgrade workspace plan to add more projects.`,
            },
            { status: 402 }
          );
        }
      }

      await db
        .update(projects)
        .set({
          organizationId,
          workspaceId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(projects.id, projectId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        workspaceId,
        projectId,
        action: "org.project_assigned",
        resourceType: "project",
        resourceId: projectId,
        headers: req.headers,
      });

      return NextResponse.json({ success: true });
    }

    if (action === "invite_member") {
      const rawEmail = body.email ? String(body.email).trim().toLowerCase() : "";
      const rawHandle = String(body.githubUsername || "").trim().replace(/^@/, "").toLowerCase();
      const handle =
        rawHandle ||
        (rawEmail
          ? `${rawEmail.split("@")[0].replace(/[^a-z0-9_-]/g, "-") || "member"}`
          : "");
      const role = normalizeOrgRole(String(body.role || "viewer"));
      const workspaceId = body.workspaceId ? String(body.workspaceId) : null;

      if ((!handle && !rawEmail) || !(VALID_ORG_ROLES as readonly string[]).includes(role)) {
        return NextResponse.json(
          { error: "Provide an email or GitHub username and a valid role (owner/admin/developer/viewer/billing)." },
          { status: 400 }
        );
      }
      if (role === "owner" && callerRole !== "owner") {
        return NextResponse.json(
          { error: "Only an Organization Owner can invite another Owner." },
          { status: 403 }
        );
      }

      const orgMembers = await db
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, organizationId));
      const orgWspaces = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.organizationId, organizationId));
      const maxMembers =
        orgWspaces.length > 0
          ? Math.max(...orgWspaces.map((w) => w.memberLimit))
          : 25;

      const existingMem = orgMembers.find(
        (m) =>
          (rawEmail && m.email?.toLowerCase() === rawEmail) ||
          (handle && m.githubUsername.toLowerCase() === handle)
      );

      if (!existingMem && orgMembers.filter((m) => m.status !== "suspended").length >= maxMembers) {
        return NextResponse.json(
          { error: `Member limit (${maxMembers}) reached for this organization's workspaces.` },
          { status: 402 }
        );
      }

      const [existingUser] = await db
        .select({ id: users.id, email: users.email, githubUsername: users.githubUsername })
        .from(users)
        .where(
          or(
            handle ? eq(users.githubUsername, handle) : sql`0`,
            rawEmail ? sql`lower(${users.email}) = ${rawEmail}` : sql`0`
          )
        )
        .limit(1);

      if (existingMem) {
        await db
          .update(organizationMembers)
          .set({
            role,
            workspaceId: workspaceId || existingMem.workspaceId,
            userId: existingUser?.id || existingMem.userId,
            email: rawEmail || existingMem.email || existingUser?.email || null,
            status: existingUser ? "active" : existingMem.status === "suspended" ? "pending" : existingMem.status,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(organizationMembers.id, existingMem.id));
      } else {
        await db.insert(organizationMembers).values({
          id: `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
          organizationId,
          workspaceId,
          userId: existingUser?.id || null,
          githubUsername: existingUser?.githubUsername || handle,
          email: rawEmail || existingUser?.email || null,
          role,
          status: existingUser ? "active" : "pending",
          invitedByUserId: user.id,
        });
      }

      const inviteEmail = rawEmail || existingUser?.email || null;

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        workspaceId,
        action: "member.invited",
        resourceType: "organization_member",
        resourceId: inviteEmail || handle,
        headers: req.headers,
        metadata: { githubUsername: handle, role, email: inviteEmail },
      });

      let emailStatus: { sent: boolean; provider?: string; skippedReason?: string } | null = null;
      if (inviteEmail) {
        const [orgProj] = await db
          .select({
            emailProvider: projects.emailProvider,
            emailApiKeyEncrypted: projects.emailApiKeyEncrypted,
          })
          .from(projects)
          .where(eq(projects.organizationId, organizationId))
          .limit(1);

        const decryptedKey = orgProj?.emailApiKeyEncrypted
          ? await decryptSecret(orgProj.emailApiKeyEncrypted)
          : null;

        emailStatus = await sendTransactionalEmail({
          to: inviteEmail,
          subject: `[@${user.githubUsername}] Invited you to ${org.name} on DevPulse (${role})`,
          html: buildRbacInviteEmailHtml({
            orgName: org.name,
            inviterUsername: user.githubUsername,
            inviteeUsername: inviteEmail || handle,
            role,
          }),
          provider: orgProj?.emailProvider,
          apiKey: decryptedKey,
        }).catch(() => ({ sent: false, skippedReason: "Email send failed" }));
      }

      return NextResponse.json({ success: true, emailNotification: emailStatus });
    }

    if (action === "update_role") {
      const memberId = String(body.memberId || "");
      const role = normalizeOrgRole(String(body.role || ""));
      if (!memberId || !(VALID_ORG_ROLES as readonly string[]).includes(role)) {
        return NextResponse.json({ error: "Invalid memberId or role" }, { status: 400 });
      }
      if (role === "owner" && callerRole !== "owner") {
        return NextResponse.json(
          { error: "Only an Organization Owner can grant the Owner role." },
          { status: 403 }
        );
      }

      const [target] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.id, memberId),
            eq(organizationMembers.organizationId, organizationId)
          )
        )
        .limit(1);
      if (!target) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
      if (target.userId === org.ownerUserId && role !== "owner") {
        return NextResponse.json(
          { error: "Cannot demote primary Organization Owner." },
          { status: 400 }
        );
      }

      await db
        .update(organizationMembers)
        .set({ role, updatedAt: new Date().toISOString() })
        .where(eq(organizationMembers.id, memberId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: "member.role_updated",
        resourceType: "organization_member",
        resourceId: memberId,
        headers: req.headers,
        metadata: { previousRole: target.role, newRole: role },
      });

      return NextResponse.json({ success: true });
    }

    if (action === "remove_member") {
      const memberId = String(body.memberId || "");
      const [targetMem] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.id, memberId),
            eq(organizationMembers.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!targetMem) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
      if (targetMem.userId === org.ownerUserId) {
        return NextResponse.json(
          { error: "Cannot remove the primary Organization Owner." },
          { status: 400 }
        );
      }

      await db.delete(organizationMembers).where(eq(organizationMembers.id, memberId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: "member.removed",
        resourceType: "organization_member",
        resourceId: targetMem.email || targetMem.githubUsername,
        headers: req.headers,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported organization action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/v1/security/orgs error:", err);
    return NextResponse.json({ error: "Organization action failed" }, { status: 500 });
  }
}
