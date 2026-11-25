import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { organizations, organizationMembers, projects, users } from "@/db/schema";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/security/audit";
import type { OrgRole } from "@/lib/security/rbac";
import { decryptSecret } from "@/lib/security/crypto";
import { buildRbacInviteEmailHtml, sendTransactionalEmail } from "@/lib/alerts/email";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const handle = user.githubUsername.toLowerCase();

    const memberRows = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(
        or(
          eq(organizationMembers.userId, user.id),
          eq(organizationMembers.githubUsername, handle)
        )
      );

    const ownedOrgs = await db
      .select()
      .from(organizations)
      .where(eq(organizations.ownerUserId, user.id))
      .orderBy(desc(organizations.createdAt));

    const orgIds = Array.from(
      new Set([...ownedOrgs.map((o) => o.id), ...memberRows.map((m) => m.organizationId)])
    );

    const orgsList =
      orgIds.length > 0
        ? await db.select().from(organizations).where(inArray(organizations.id, orgIds))
        : [];

    const allMembers =
      orgIds.length > 0
        ? await db
            .select()
            .from(organizationMembers)
            .where(inArray(organizationMembers.organizationId, orgIds))
        : [];

    const ownedProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .where(eq(projects.userId, user.id));

    return NextResponse.json({
      currentUser: {
        id: user.id,
        githubUsername: user.githubUsername,
      },
      organizations: orgsList.map((org) => {
        const members = allMembers.filter((m) => m.organizationId === org.id);
        const myRole: OrgRole =
          org.ownerUserId === user.id
            ? "owner"
            : ((members.find(
                (m) => m.userId === user.id || m.githubUsername === handle
              )?.role || "viewer") as OrgRole);

        return {
          ...org,
          myRole,
          members,
        };
      }),
      ownedProjects,
    });
  } catch (err: any) {
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
    const { action } = body;

    if (action === "create_org") {
      const rawName = String(body.name || "").trim();
      if (rawName.length < 2 || rawName.length > 60) {
        return NextResponse.json({ error: "Organization name must be 2-60 characters." }, { status: 400 });
      }
      const slugBase = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";
      const orgId = `org_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      const slug = `${slugBase}-${orgId.slice(-5)}`;

      await db.insert(organizations).values({
        id: orgId,
        name: rawName,
        slug,
        ownerUserId: user.id,
      });

      await db.insert(organizationMembers).values({
        id: `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        organizationId: orgId,
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
          .set({ organizationId: orgId, updatedAt: new Date().toISOString() })
          .where(and(eq(projects.id, String(body.projectId)), eq(projects.userId, user.id)));
      }

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: orgId,
        projectId: body.projectId ? String(body.projectId) : null,
        action: "org.created",
        resourceType: "organization",
        resourceId: orgId,
        headers: req.headers,
        metadata: { name: rawName, slug },
      });

      return NextResponse.json({ success: true, organizationId: orgId, name: rawName, slug });
    }

    const organizationId = String(body.organizationId || "");
    if (!organizationId) {
      return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    }

    // Verify caller is an Owner of the target Organization
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const [callerMember] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          or(
            eq(organizationMembers.userId, user.id),
            eq(organizationMembers.githubUsername, user.githubUsername.toLowerCase())
          )
        )
      )
      .limit(1);

    const isOwner = org.ownerUserId === user.id || callerMember?.role === "owner";
    if (!isOwner) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: `org.${String(action || "unknown")}`,
        resourceType: "organization_member",
        status: "denied",
        headers: req.headers,
        metadata: { role: callerMember?.role || "none" },
      });
      return NextResponse.json(
        { error: "Forbidden: Only Organization Owners can manage RBAC members & projects." },
        { status: 403 }
      );
    }

    if (action === "assign_project") {
      const projectId = String(body.projectId || "");
      const [proj] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
        .limit(1);
      if (!proj) {
        return NextResponse.json({ error: "Project not found or not owned by you." }, { status: 404 });
      }
      await db
        .update(projects)
        .set({ organizationId, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, projectId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        projectId,
        action: "org.project_assigned",
        resourceType: "project",
        resourceId: projectId,
        headers: req.headers,
      });

      return NextResponse.json({ success: true });
    }

    if (action === "invite_member") {
      const handle = String(body.githubUsername || "").trim().replace(/^@/, "").toLowerCase();
      const role = String(body.role || "viewer") as OrgRole;
      if (!handle || !["owner", "maintainer", "viewer"].includes(role)) {
        return NextResponse.json({ error: "Valid GitHub username and role (owner/maintainer/viewer) required." }, { status: 400 });
      }

      const [existingUser] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.githubUsername, handle))
        .limit(1);

      const [existingMem] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.githubUsername, handle)
          )
        )
        .limit(1);

      if (existingMem) {
        await db
          .update(organizationMembers)
          .set({
            role,
            userId: existingUser?.id || existingMem.userId,
            status: existingUser ? "active" : existingMem.status,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(organizationMembers.id, existingMem.id));
      } else {
        await db.insert(organizationMembers).values({
          id: `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
          organizationId,
          userId: existingUser?.id || null,
          githubUsername: handle,
          email: body.email ? String(body.email).trim() : existingUser?.email || null,
          role,
          status: existingUser ? "active" : "pending",
          invitedByUserId: user.id,
        });
      }

      const inviteEmail = body.email ? String(body.email).trim() : existingUser?.email || null;

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: "member.invited",
        resourceType: "organization_member",
        resourceId: handle,
        headers: req.headers,
        metadata: { githubUsername: handle, role, email: inviteEmail },
      });

      let emailStatus: { sent: boolean; provider?: string; skippedReason?: string } | null = null;
      if (inviteEmail) {
        // Resolve org-scoped project email key if present
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
            inviteeUsername: handle,
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
      const role = String(body.role || "") as OrgRole;
      if (!memberId || !["owner", "maintainer", "viewer"].includes(role)) {
        return NextResponse.json({ error: "Invalid memberId or role" }, { status: 400 });
      }

      await db
        .update(organizationMembers)
        .set({ role, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(organizationMembers.id, memberId),
            eq(organizationMembers.organizationId, organizationId)
          )
        );

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: "member.role_updated",
        resourceType: "organization_member",
        resourceId: memberId,
        headers: req.headers,
        metadata: { role },
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
        return NextResponse.json({ error: "Cannot remove the primary Organization Owner." }, { status: 400 });
      }

      await db.delete(organizationMembers).where(eq(organizationMembers.id, memberId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: "member.removed",
        resourceType: "organization_member",
        resourceId: targetMem.githubUsername,
        headers: req.headers,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported organization action" }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/v1/security/orgs error:", err);
    return NextResponse.json({ error: "Organization action failed" }, { status: 500 });
  }
}
