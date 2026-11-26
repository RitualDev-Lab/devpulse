import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface LuaRocksStats {
  name: string;
  version: string;
  downloads?: number | null;
  url: string;
}

export interface LuaRocksSearchItem {
  name: string;
  version?: string;
  url: string;
}

const HEADERS = {
  Accept: "text/html,application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchLuaRocksStats(rawName: string): Promise<LuaRocksStats | null> {
  try {
    const clean = rawName.trim().toLowerCase();
    if (!clean) return null;

    const modulePath = clean.includes("/")
      ? `https://luarocks.org/modules/${clean}`
      : `https://luarocks.org/modules/luarocks/${encodeURIComponent(clean)}`;

    const res = await fetch(modulePath, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);

    if (!res || !res.ok) return null;
    const html = await res.text();
    const verMatch = html.match(/version[_-]?name[^>]*>([^<]+)</i) || html.match(/<span class="version">([^<]+)</i);
    const dlMatch = html.match(/([0-9,]+)\s+downloads/i);

    return {
      name: clean,
      version: verMatch?.[1]?.trim() || "latest",
      downloads: dlMatch?.[1] ? Number(dlMatch[1].replace(/,/g, "")) : null,
      url: modulePath,
    };
  } catch {
    return null;
  }
}

export async function searchLuaRocksPackages(query: string): Promise<LuaRocksSearchItem[]> {
  const exact = await fetchLuaRocksStats(query);
  return exact ? [{ name: exact.name, version: exact.version, url: exact.url }] : [];
}
