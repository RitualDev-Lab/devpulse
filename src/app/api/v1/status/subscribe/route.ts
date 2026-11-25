import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, statusSubscribers } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  checkRateLimit,
  getClientIp,
  verifyTurnstileToken,
} from "@/lib/security/rate-limit";
import { decryptSecret } from "@/lib/security/crypto";
import { sendTransactionalEmail } from "@/lib/alerts/email";
import { apiError } from "@/lib/security/api-error";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * GET /api/v1/status/subscribe
 *  - ?token=... -> one-click email unsubscribe link
 *  - ?projectId=... -> returns public active subscriber count
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token")?.trim();
    const projectId = req.nextUrl.searchParams.get("projectId")?.trim();

    if (token) {
      const [sub] = await db
        .select()
        .from(statusSubscribers)
        .where(eq(statusSubscribers.unsubscribeToken, token))
        .limit(1);

      if (!sub) {
        return NextResponse.json({ error: "Invalid or expired unsubscribe token" }, { status: 404 });
      }

      await db
        .update(statusSubscribers)
        .set({ isActive: false })
        .where(eq(statusSubscribers.id, sub.id));

      return new NextResponse(
        `<!doctype html><html><body style="font-family:system-ui;background:#09090b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="max-width:420px;padding:24px;border:1px solid #27272a;border-radius:16px;background:#18181b;"><h2 style="margin:0 0 8px;">Unsubscribed</h2><p style="color:#a1a1aa;font-size:14px;">You will no longer receive uptime incident notifications from this DevPulse status page.</p></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId or token" }, { status: 400 });
    }

    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(statusSubscribers)
      .where(and(eq(statusSubscribers.projectId, projectId), eq(statusSubscribers.isActive, true)));

    return NextResponse.json({ subscribers: Number(row?.count || 0) });
  } catch (err: any) {
    return apiError(err, "Failed to process status subscription request", 500);
  }
}

/**
 * POST /api/v1/status/subscribe
 * Subscribes a visitor email to real-time uptime downtime & incident notifications.
 */
export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req.headers);
    const rl = await checkRateLimit({
      key: `status-sub:${clientIp}`,
      limit: 10,
      windowSeconds: 900,
    });

    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many subscription requests. Try again shortly." },
        { status: 429 }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const turnstileOk = await verifyTurnstileToken(body.turnstileToken, clientIp);
    if (!turnstileOk.ok) {
      return NextResponse.json(
        { error: turnstileOk.error || "CAPTCHA verification failed" },
        { status: 403 }
      );
    }

    const email = String(body.email || "").trim().toLowerCase().slice(0, 255);
    const projectSlug = String(body.projectSlug || "").trim();
    const projectIdInput = String(body.projectId || "").trim();

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(projectIdInput ? eq(projects.id, projectIdInput) : eq(projects.slug, projectSlug))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const token = crypto.randomUUID().replace(/-/g, "");
    const id = `ssub_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

    await db
      .insert(statusSubscribers)
      .values({
        id,
        projectId: project.id,
        email,
        isActive: true,
        unsubscribeToken: token,
      })
      .onConflictDoUpdate({
        target: [statusSubscribers.projectId, statusSubscribers.email],
        set: {
          isActive: true,
          unsubscribeToken: token,
        },
      });

    // Best-effort welcome email when project owner configured transactional email
    if (project.emailApiKeyEncrypted || process.env.RESEND_API_KEY) {
      const emailKey = await decryptSecret(project.emailApiKeyEncrypted).catch(() => null);
      const unsubUrl = `${PUBLIC_APP_URL}/api/v1/status/subscribe?token=${token}`;
      await sendTransactionalEmail({
        to: email,
        subject: `[${project.name}] Subscribed to Status Updates`,
        html: `<p>You are now subscribed to live incident and downtime notifications for <strong>${project.name}</strong>.</p><p><a href="${unsubUrl}">Unsubscribe anytime</a></p>`,
        provider: project.emailProvider,
        apiKey: emailKey,
      }).catch(() => {});
    }

    return NextResponse.json(
      {
        success: true,
        message: `Subscribed ${email} to ${project.name} status updates.`,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return apiError(err, "Failed to subscribe email", 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token")?.trim();
    if (!token) {
      return NextResponse.json({ error: "Missing unsubscribe token" }, { status: 400 });
    }
    await db
      .update(statusSubscribers)
      .set({ isActive: false })
      .where(eq(statusSubscribers.unsubscribeToken, token));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, "Failed to unsubscribe", 500);
  }
}
