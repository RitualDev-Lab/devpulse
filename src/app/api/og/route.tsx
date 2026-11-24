import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { loadPortalData } from "@/lib/domains/portal-loader";
import { PRIMARY_PORTAL_DOMAIN } from "@/lib/domains/cloudflare-saas";

export async function GET(req: NextRequest) {
  const hostKey = req.nextUrl.searchParams.get("host") || "ritualdev-lab";
  const projectSlug = req.nextUrl.searchParams.get("project") || undefined;

  const data = await loadPortalData(hostKey, projectSlug).catch(() => null);

  const brandTitle =
    data?.user.brandTitle ||
    data?.activeProject?.name ||
    data?.user.name ||
    "DevPulse Telemetry Portal";
  const description =
    data?.user.brandDescription ||
    data?.activeProject?.description ||
    "Real-time multi-registry downloads, release cadence, and runtime diagnostics.";
  const hostDisplay =
    data?.user.customDomain ||
    (data?.user.subdomain
      ? `${data.user.subdomain}.${PRIMARY_PORTAL_DOMAIN}`
      : PRIMARY_PORTAL_DOMAIN);

  const badges: string[] = [];
  if (data?.activeProject?.githubRepo) badges.push(`GitHub: ${data.activeProject.githubRepo}`);
  if (data?.activeProject?.npmPackage) badges.push(`npm: ${data.activeProject.npmPackage}`);
  if (data?.activeProject?.pypiPackage) badges.push(`PyPI: ${data.activeProject.pypiPackage}`);
  if (data?.activeProject?.rustCrate) badges.push(`crates.io: ${data.activeProject.rustCrate}`);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          backgroundColor: "#09090b",
          backgroundImage:
            "radial-gradient(circle at 85% 15%, rgba(99, 102, 241, 0.28), transparent 50%), radial-gradient(circle at 15% 85%, rgba(6, 182, 212, 0.18), transparent 45%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "10px 20px",
              borderRadius: "999px",
              backgroundColor: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#34d399",
              fontSize: "22px",
              fontWeight: 600,
            }}
          >
            LIVE STATUS &amp; TELEMETRY
          </div>
          <div style={{ fontSize: "24px", color: "#a1a1aa", fontFamily: "monospace" }}>
            {hostDisplay}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div style={{ fontSize: "64px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            {brandTitle}
          </div>
          <div style={{ fontSize: "28px", color: "#a1a1aa", lineHeight: 1.4, maxWidth: "980px" }}>
            {description.slice(0, 140)}
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {(badges.length > 0 ? badges.slice(0, 4) : ["Multi-Registry Telemetry", "Zero-Config SSL"]).map(
            (badge) => (
              <div
                key={badge}
                style={{
                  padding: "12px 22px",
                  borderRadius: "16px",
                  backgroundColor: "rgba(24, 24, 27, 0.9)",
                  border: "1px solid rgba(63, 63, 70, 0.8)",
                  color: "#e4e4e7",
                  fontSize: "22px",
                }}
              >
                {badge}
              </div>
            )
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
