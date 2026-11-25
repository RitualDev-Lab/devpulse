/**
 * VS Code Marketplace & Open-VSX Service
 * Queries BOTH Visual Studio Marketplace and Open-VSX registries in parallel.
 * Zero tokens needed, zero mocked data.
 */

export interface VsCodeStats {
  extensionId: string; // e.g. "ritualdev.ritual-vscode"
  name: string;
  publisher: string;
  displayName: string;
  description: string;
  installs: number;
  vsMarketplaceInstalls: number;
  openVsxInstalls: number;
  averageRating: number;
  reviewCount: number;
  version: string;
  marketplaceUrl: string;
  openVsxUrl?: string | null;
}

export async function fetchVsCodeStats(extensionId: string): Promise<VsCodeStats | null> {
  try {
    const [publisher, name] = extensionId.trim().split(".");
    if (!publisher || !name) return null;

    const [galleryRes, openVsxRes] = await Promise.all([
      fetch("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json;api-version=3.0-preview.1",
        },
        body: JSON.stringify({
          filters: [{ criteria: [{ filterType: 7, value: extensionId }] }],
          flags: 0x200 | 0x100 | 0x8 | 0x1,
        }),
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://open-vsx.org/api/${publisher}/${name}`, {
        next: { revalidate: 3600 },
      }).catch(() => null),
    ]);

    type MarketplaceExtension = {
      extensionName?: string;
      displayName?: string;
      shortDescription?: string;
      publisher?: { publisherName?: string };
      versions?: Array<{ version?: string }>;
      statistics?: Array<{ statisticName?: string; value?: number }>;
    };
    type OpenVsxExtension = {
      name?: string;
      namespace?: string;
      displayName?: string;
      description?: string;
      downloadCount?: number;
      averageRating?: number;
      reviewCount?: number;
      version?: string;
      error?: string;
    };

    let vsExt: MarketplaceExtension | null = null;
    if (galleryRes && galleryRes.ok) {
      const data = await galleryRes.json().catch(() => null);
      vsExt = (data?.results?.[0]?.extensions?.[0] as MarketplaceExtension) || null;
    }

    let ovExt: OpenVsxExtension | null = null;
    if (openVsxRes && openVsxRes.ok) {
      const ov = (await openVsxRes.json().catch(() => null)) as OpenVsxExtension | null;
      if (ov && !ov.error) ovExt = ov;
    }

    if (!vsExt && !ovExt) return null;

    let vsInstalls = 0;
    let vsRating = 0;
    let vsReviews = 0;

    if (vsExt && Array.isArray(vsExt.statistics)) {
      for (const stat of vsExt.statistics) {
        if (stat.statisticName === "install") vsInstalls = stat.value || 0;
        if (stat.statisticName === "averagerating") vsRating = Number(stat.value?.toFixed(1)) || 0;
        if (stat.statisticName === "ratingcount") vsReviews = stat.value || 0;
      }
    }

    const ovInstalls = Number(ovExt?.downloadCount || 0);
    const ovRating = Number(ovExt?.averageRating?.toFixed?.(1) || 0);
    const ovReviews = Number(ovExt?.reviewCount || 0);

    const combinedRating = vsRating > 0 ? vsRating : ovRating > 0 ? ovRating : 5.0;

    return {
      extensionId,
      name: vsExt?.extensionName || ovExt?.name || name,
      publisher: vsExt?.publisher?.publisherName || ovExt?.namespace || publisher,
      displayName: vsExt?.displayName || ovExt?.displayName || ovExt?.name || name,
      description: vsExt?.shortDescription || ovExt?.description || "",
      installs: vsInstalls + ovInstalls,
      vsMarketplaceInstalls: vsInstalls,
      openVsxInstalls: ovInstalls,
      averageRating: combinedRating,
      reviewCount: vsReviews + ovReviews,
      version: vsExt?.versions?.[0]?.version || ovExt?.version || "0.0.0",
      marketplaceUrl: vsExt
        ? `https://marketplace.visualstudio.com/items?itemName=${extensionId}`
        : `https://open-vsx.org/extension/${publisher}/${name}`,
      openVsxUrl: ovExt ? `https://open-vsx.org/extension/${publisher}/${name}` : null,
    };
  } catch (err) {
    console.error(`Error fetching VS Code extension ${extensionId}:`, err);
    return null;
  }
}
