import { NextRequest } from "next/server";
import { resolveScimBaseUrl, scimJson } from "@/lib/saml/scim-auth";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const baseUrl = resolveScimBaseUrl();
  return scimJson({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: `${PUBLIC_APP_URL}/docs/sso-scim`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Authentication scheme using the SCIM Bearer Token generated in DevPulse Security Settings.",
        primary: true,
      },
    ],
    meta: {
      location: `${baseUrl}/ServiceProviderConfig`,
      resourceType: "ServiceProviderConfig",
    },
  });
}
