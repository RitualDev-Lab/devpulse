/**
 * Docker Hub Container Registry Service
 * Interacts with public Docker Hub API (hub.docker.com/v2/repositories/{namespace}/{repo})
 * Ingests:
 * - Container pull counts & stars
 * - Recent tag updates, image sizes & architectures
 * Requires ZERO private tokens.
 */

export interface DockerTagInfo {
  name: string;
  sizeBytes: number;
  lastUpdated: string;
}

export interface DockerRepoStats {
  imageName: string;
  namespace: string;
  repository: string;
  pullCount: number;
  starCount: number;
  lastUpdated?: string;
  description?: string;
  tags: DockerTagInfo[];
  hubUrl: string;
}

export async function fetchDockerRepoStats(imageName: string): Promise<DockerRepoStats | null> {
  try {
    const cleanImage = imageName.trim();
    const parts = cleanImage.split("/");
    const namespace = parts.length === 1 ? "library" : parts[0];
    const repository = parts.length === 1 ? parts[0] : parts.slice(1).join("/");

    const headers = {
      "User-Agent": "DevPulse-HQ/1.0 (https://devpulse.ritualdev.in)",
      Accept: "application/json",
    };

    let repoRes = await fetch(
      `https://hub.docker.com/v2/repositories/${namespace}/${repository}`,
      {
        headers: {
          "User-Agent": "Docker-Client/24.0.0 (linux)",
          Accept: "application/json",
        },
        next: { revalidate: 3600 },
      }
    ).catch(() => null);

    if (!repoRes || !repoRes.ok) {
      repoRes = await fetch(
        `https://registry.hub.docker.com/v2/repositories/${namespace}/${repository}`,
        {
          headers: {
            "User-Agent": "Docker-Client/24.0.0 (linux)",
            Accept: "application/json",
          },
          next: { revalidate: 3600 },
        }
      ).catch(() => null);
    }

    if (!repoRes || !repoRes.ok) {
      console.warn(
        `Docker Hub returned ${repoRes?.status} ${repoRes?.statusText} for ${namespace}/${repository}`
      );
      return null;
    }

    const repoJson = await repoRes.json();

    let tagsRes = await fetch(
      `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags?page_size=5`,
      {
        headers: {
          "User-Agent": "Docker-Client/24.0.0 (linux)",
          Accept: "application/json",
        },
        next: { revalidate: 3600 },
      }
    ).catch(() => null);

    if (!tagsRes || !tagsRes.ok) {
      tagsRes = await fetch(
        `https://registry.hub.docker.com/v2/repositories/${namespace}/${repository}/tags?page_size=5`,
        {
          headers: {
            "User-Agent": "Docker-Client/24.0.0 (linux)",
            Accept: "application/json",
          },
          next: { revalidate: 3600 },
        }
      ).catch(() => null);
    }

    const tags: DockerTagInfo[] = [];
    if (tagsRes && tagsRes.ok) {
      try {
        const tagsJson = await tagsRes.json();
        if (Array.isArray(tagsJson.results)) {
          for (const t of tagsJson.results) {
            tags.push({
              name: t.name,
              sizeBytes: t.full_size || 0,
              lastUpdated: t.last_updated || t.tag_last_pushed || "",
            });
          }
        }
      } catch {
        // ignore
      }
    }

    const hubUrl =
      namespace === "library"
        ? `https://hub.docker.com/_/${repository}`
        : `https://hub.docker.com/r/${namespace}/${repository}`;

    return {
      imageName: `${namespace}/${repository}`,
      namespace,
      repository,
      pullCount: repoJson.pull_count || 0,
      starCount: repoJson.star_count || 0,
      lastUpdated: repoJson.last_updated || undefined,
      description: repoJson.description || "",
      tags,
      hubUrl,
    };
  } catch (err) {
    console.warn(`Error fetching Docker stats for ${imageName}:`, err);
    return null;
  }
}
