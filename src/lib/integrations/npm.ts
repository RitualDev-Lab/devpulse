/**
 * npm / JavaScript Ecosystem Service (npm, pnpm, Bun)
 * Interacts with public npm APIs (api.npmjs.org and registry.npmjs.org)
 * Ingests:
 * - 30-day download velocity
 * - Version release cadence & history
 * - License and dependency counts
 * Requires ZERO private tokens.
 */

export interface NpmStats {
  packageName: string;
  downloadsLastDay: number;
  downloadsLastWeek: number;
  downloadsLastMonth: number;
  dailyHistory: Array<{ date: string; downloads: number }>;
  latestVersion?: string;
  license?: string;
  totalReleases: number;
  latestReleaseDate?: string;
  daysSinceLastRelease?: number;
  dependenciesCount: number;
  description?: string;
  downloadsLastYearChunked?: number;
}

/**
 * Queries npm download ranges in <=500-day chunks to bypass api.npmjs.org's silent 549-day truncation.
 */
export async function fetchNpmChunkedTotal(
  encodedPkg: string,
  days = 365,
  headers: Record<string, string> = { Accept: "application/json" }
): Promise<number> {
  const CHUNK_DAYS = 500;
  let total = 0;
  let remaining = Math.max(1, Math.min(1825, days));
  let endMs = Date.now() - 86400_000;

  while (remaining > 0) {
    const span = Math.min(remaining, CHUNK_DAYS);
    const startMs = endMs - (span - 1) * 86400_000;
    const startStr = new Date(startMs).toISOString().slice(0, 10);
    const endStr = new Date(endMs).toISOString().slice(0, 10);
    const res = await fetch(
      `https://api.npmjs.org/downloads/range/${startStr}:${endStr}/${encodedPkg}`,
      { headers, next: { revalidate: 21600 } }
    ).catch(() => null);
    if (res && res.ok) {
      const json = (await res.json()) as { downloads?: Array<{ downloads?: number }> };
      if (Array.isArray(json.downloads)) {
        total += json.downloads.reduce((acc, d) => acc + Number(d.downloads || 0), 0);
      }
    }
    remaining -= span;
    endMs = startMs - 86400_000;
    if (remaining > 0) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return total;
}

export async function fetchNpmStats(
  packageName: string,
  npmToken?: string | null
): Promise<NpmStats | null> {
  try {
    const cleanName = packageName.trim();
    const encodedPkg = cleanName.startsWith("@")
      ? `@${encodeURIComponent(cleanName.slice(1)).replace(/%2F/i, "/")}`
      : encodeURIComponent(cleanName);

    const registryHeaders: Record<string, string> = {
      Accept: "application/json",
    };
    // Abbreviated npm install manifest cuts payload size up to ~90% by omitting full READMEs & tarballs
    const abbreviatedHeaders: Record<string, string> = {
      Accept: "application/vnd.npm.install-v1+json, application/json;q=0.9",
    };
    if (npmToken) {
      registryHeaders.Authorization = `Bearer ${npmToken}`;
      abbreviatedHeaders.Authorization = `Bearer ${npmToken}`;
    }

    // Fetch 30-day downloads, week/day points, and slim package metadata in ONE parallel wave
    const [rangeRes, weekRes, dayRes, metaRes] = await Promise.all([
      fetch(`https://api.npmjs.org/downloads/range/last-month/${encodedPkg}`, {
        headers: registryHeaders,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://api.npmjs.org/downloads/point/last-week/${encodedPkg}`, {
        headers: registryHeaders,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://api.npmjs.org/downloads/point/last-day/${encodedPkg}`, {
        headers: registryHeaders,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://registry.npmjs.org/${encodedPkg}`, {
        headers: abbreviatedHeaders,
        next: { revalidate: 86400 },
      }).catch(() => null),
    ]);

    let dailyHistory: Array<{ date: string; downloads: number }> = [];
    let downloadsLastMonth = 0;

    if (rangeRes && rangeRes.ok) {
      const data = await rangeRes.json();
      if (Array.isArray(data.downloads)) {
        dailyHistory = data.downloads.map((d: { day: string; downloads: number }) => ({
          date: d.day,
          downloads: d.downloads,
        }));
        downloadsLastMonth = dailyHistory.reduce((acc, curr) => acc + curr.downloads, 0);
      }
    }

    const weekData = weekRes && weekRes.ok ? await weekRes.json() : { downloads: 0 };
    const dayData = dayRes && dayRes.ok ? await dayRes.json() : { downloads: 0 };

    // 3. Fetch package metadata (latest version, license, release cadence, dependencies)
    let latestVersion = "";
    let description = "";
    let license = "";
    let totalReleases = 0;
    let latestReleaseDate = "";
    let daysSinceLastRelease = 0;
    let dependenciesCount = 0;

    const hasDownloadData = Boolean(
      (rangeRes && rangeRes.ok) || (weekRes && weekRes.ok) || (dayRes && dayRes.ok)
    );
    if ((!metaRes || !metaRes.ok) && !hasDownloadData) {
      return null;
    }

    if (metaRes && metaRes.ok) {
      try {
        const meta = await metaRes.json();
        latestVersion = meta["dist-tags"]?.latest || "";
        description = meta.description || "";
        license =
          typeof meta.license === "string"
            ? meta.license
            : typeof meta.license === "object" && meta.license?.type
              ? String(meta.license.type)
              : "";

        // Release cadence calculation
        const times = Object.entries(meta.time || {}).filter(
          ([k]) => k !== "created" && k !== "modified"
        );
        totalReleases = times.length;

        if (latestVersion && meta.time && meta.time[latestVersion]) {
          latestReleaseDate = meta.time[latestVersion];
          const releaseMs = new Date(latestReleaseDate).getTime();
          if (!isNaN(releaseMs)) {
            daysSinceLastRelease = Math.max(0, Math.floor((Date.now() - releaseMs) / (1000 * 60 * 60 * 24)));
          }
        }

        // Dependency counts
        const versionObj = meta.versions?.[latestVersion];
        if (versionObj?.dependencies) {
          dependenciesCount = Object.keys(versionObj.dependencies).length;
        }
      } catch {
        // Non-fatal
      }
    }

    return {
      packageName,
      downloadsLastDay: dayData.downloads || 0,
      downloadsLastWeek: weekData.downloads || 0,
      downloadsLastMonth: downloadsLastMonth || weekData.downloads * 4,
      dailyHistory,
      latestVersion,
      license,
      totalReleases,
      latestReleaseDate,
      daysSinceLastRelease,
      dependenciesCount,
      description,
    };
  } catch (err) {
    console.error(`Error fetching npm stats for ${packageName}:`, err);
    return null;
  }
}

/**
 * Discover packages belonging to an npm org (uses npm Read Token when private/org).
 */
export async function fetchNpmOrgPackages(
  orgName: string,
  npmToken?: string | null
): Promise<string[]> {
  try {
    const cleanOrg = orgName.trim().replace(/^@/, "");
    if (!cleanOrg) return [];
    const headers: Record<string, string> = { Accept: "application/json" };
    if (npmToken) headers.Authorization = `Bearer ${npmToken}`;
    const res = await fetch(`https://registry.npmjs.org/-/org/${encodeURIComponent(cleanOrg)}/package`, {
      headers,
      next: { revalidate: 1800 },
    }).catch(() => null);
    if (!res?.ok) return [];
    const json = (await res.json()) as Record<string, string>;
    return Object.keys(json || {}).slice(0, 50);
  } catch {
    return [];
  }
}

/**
 * Bulk-fetch npm download totals for many packages cleanly.
 * api.npmjs.org bulk comma queries reject @scoped/pkg names with HTTP 400, so scoped
 * packages are partitioned into isolated single requests while unscoped packages batch up to 128.
 */
export async function fetchNpmDownloadsBulk(
  packageNames: string[],
  period: "last-day" | "last-week" | "last-month" = "last-week"
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const unique = Array.from(new Set(packageNames.map((p) => p.trim()).filter(Boolean)));
  if (unique.length === 0) return results;

  const scoped = unique.filter((p) => p.startsWith("@"));
  const unscoped = unique.filter((p) => !p.startsWith("@"));

  const chunks: string[][] = [];
  for (let i = 0; i < unscoped.length; i += 128) {
    chunks.push(unscoped.slice(i, i + 128));
  }

  await Promise.all([
    ...scoped.map(async (pkg) => {
      const encoded = `@${encodeURIComponent(pkg.slice(1)).replace(/%2F/i, "/")}`;
      const res = await fetch(`https://api.npmjs.org/downloads/point/${period}/${encoded}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 3600 },
      }).catch(() => null);
      if (res?.ok) {
        const json = (await res.json()) as { downloads?: number };
        results[pkg] = Number(json.downloads || 0);
      }
    }),
    ...chunks.map(async (chunk) => {
      if (chunk.length === 1) {
        const pkg = chunk[0];
        const res = await fetch(
          `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(pkg)}`,
          { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
        ).catch(() => null);
        if (res?.ok) {
          const json = (await res.json()) as { downloads?: number };
          results[pkg] = Number(json.downloads || 0);
        }
        return;
      }
      const joined = chunk.map((p) => encodeURIComponent(p)).join(",");
      const res = await fetch(`https://api.npmjs.org/downloads/point/${period}/${joined}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 3600 },
      }).catch(() => null);
      if (res?.ok) {
        const json = (await res.json()) as Record<string, { downloads?: number } | null>;
        for (const pkg of chunk) {
          if (json[pkg]) results[pkg] = Number(json[pkg]?.downloads || 0);
        }
      }
    }),
  ]);

  return results;
}
