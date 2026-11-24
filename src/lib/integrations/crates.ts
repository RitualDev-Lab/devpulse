/**
 * Rust Crates.io Service
 * Interacts with public crates.io API (https://crates.io/api/v1/crates/{crate})
 * Requires ZERO private tokens.
 */

export interface RustCrateStats {
  crateName: string;
  totalDownloads: number;
  recentDownloads: number;
  maxVersion: string;
  description?: string;
  homepage?: string;
  repository?: string;
  documentation?: string;
}

export async function fetchRustCrateStats(crateName: string): Promise<RustCrateStats | null> {
  try {
    const cleanName = encodeURIComponent(crateName.trim().toLowerCase());
    const res = await fetch(`https://crates.io/api/v1/crates/${cleanName}`, {
      headers: {
        "User-Agent": "DevPulse-HQ/1.0 (https://devpulse.ritualdev.in)",
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    const c = json.crate;
    if (!c) return null;

    return {
      crateName: c.name || crateName,
      totalDownloads: c.downloads || 0,
      recentDownloads: c.recent_downloads || 0,
      maxVersion: c.max_version || c.default_version || "0.1.0",
      description: c.description || "",
      homepage: c.homepage || undefined,
      repository: c.repository || undefined,
      documentation: c.documentation || `https://docs.rs/${cleanName}`,
    };
  } catch (err) {
    console.warn(`Failed to fetch crate stats for ${crateName}:`, err);
    return null;
  }
}
