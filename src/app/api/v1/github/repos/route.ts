import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listUserAndOrgRepositories } from "@/lib/security/github-ownership";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await listUserAndOrgRepositories(user);

    return NextResponse.json({
      repos: data.repos,
      orgs: data.orgs,
      hasOAuthToken: data.hasOAuthToken,
      githubUsername: user.githubUsername,
    });
  } catch (err: any) {
    console.error("GET /api/v1/github/repos error:", err);
    return NextResponse.json(
      { repos: [], orgs: [], error: "Failed to list repositories" },
      { status: 500 }
    );
  }
}
