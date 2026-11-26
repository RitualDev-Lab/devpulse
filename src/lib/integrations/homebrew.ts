import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface HomebrewStats {
  name: string;
  kind: "formula" | "cask";
  version: string;
  installs30d: number;
  installs90d: number;
  installs365d: number;
  description?: string;
  license?: string;
  homepage?: string;
}

export interface HomebrewSearchItem {
  name: string;
  kind: "formula" | "cask";
  version?: string;
  installs30d?: number;
  description?: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

function sumAnalyticsCount(map: unknown, key: string): number {
  if (!map || typeof map !== "object") return 0;
  const obj = map as Record<string, unknown>;
  const direct = obj[key];
  if (typeof direct === "number") return direct;
  let total = 0;
  for (const val of Object.values(obj)) {
    if (typeof val === "number") total += val;
  }
  return total;
}

export async function fetchHomebrewStats(name: string): Promise<HomebrewStats | null> {
  try {
    const raw = name.trim().toLowerCase();
    if (!raw) return null;

    const preferCask = raw.startsWith("cask/");
    const clean = raw.replace(/^(cask|formula)\//, "");
    const encoded = encodeURIComponent(clean);

    const endpoints: Array<{ kind: "formula" | "cask"; url: string }> = preferCask
      ? [{ kind: "cask", url: `https://formulae.brew.sh/api/cask/${encoded}.json` }]
      : [
          { kind: "formula", url: `https://formulae.brew.sh/api/formula/${encoded}.json` },
          { kind: "cask", url: `https://formulae.brew.sh/api/cask/${encoded}.json` },
        ];

    for (const ep of endpoints) {
      const res = await fetch(ep.url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null);
      if (!res || !res.ok) continue;

      const json = await res.json();
      const itemName = String(json.name || json.token || clean);
      const installMap = json.analytics?.install || json.analytics?.install_on_request || {};

      return {
        name: ep.kind === "cask" ? `cask/${json.token || itemName}` : itemName,
        kind: ep.kind,
        version: String(json.versions?.stable || json.version || "latest"),
        installs30d: sumAnalyticsCount(installMap["30d"], clean),
        installs90d: sumAnalyticsCount(installMap["90d"], clean),
        installs365d: sumAnalyticsCount(installMap["365d"], clean),
        description: json.desc ? String(json.desc) : undefined,
        license: json.license ? String(json.license) : undefined,
        homepage: json.homepage ? String(json.homepage) : undefined,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function searchHomebrewPackages(query: string): Promise<HomebrewSearchItem[]> {
  const clean = query.trim().toLowerCase().replace(/\s+/g, "-");
  if (clean.length < 2) return [];
  const exact = await fetchHomebrewStats(clean);
  if (!exact) return [];
  return [
    {
      name: exact.name,
      kind: exact.kind,
      version: exact.version,
      installs30d: exact.installs30d,
      description: exact.description,
    },
  ];
}
