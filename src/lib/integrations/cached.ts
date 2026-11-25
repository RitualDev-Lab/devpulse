interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const isolateCache = new Map<string, CacheEntry<unknown>>();

function getEdgeCacheStorage(): {
  match: (req: Request) => Promise<Response | undefined>;
  put: (req: Request, res: Response) => Promise<void>;
} | null {
  try {
    const c = (globalThis as any)?.caches?.default;
    if (c && typeof c.match === "function" && typeof c.put === "function") {
      return c;
    }
  } catch {
    // Not in Cloudflare Workers runtime
  }
  return null;
}

/**
 * Multi-tier edge cache (in-isolate memory + Cloudflare Edge Cache API)
 * with strict timeout cap so slow external registries never stall SSR.
 */
export async function withEdgeCache<T>(
  cacheKey: string,
  ttlSeconds: number,
  timeoutMs: number,
  fetcher: () => Promise<T | null>
): Promise<T | null> {
  const now = Date.now();
  const cached = isolateCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value as T | null;
  }

  const edgeCache = getEdgeCacheStorage();
  const cacheReq = edgeCache
    ? new Request(`https://cache.devpulse.internal/edge/${encodeURIComponent(cacheKey)}`)
    : null;

  if (edgeCache && cacheReq) {
    try {
      const matched = await edgeCache.match(cacheReq);
      if (matched) {
        const data = (await matched.json()) as T | null;
        if (data !== null) {
          isolateCache.set(cacheKey, {
            value: data,
            expiresAt: now + ttlSeconds * 1000,
          });
          return data;
        }
      }
    } catch {
      // Ignore edge cache read failures
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race<T | null>([
      fetcher().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (result !== null) {
      isolateCache.set(cacheKey, {
        value: result,
        expiresAt: now + ttlSeconds * 1000,
      });

      if (edgeCache && cacheReq) {
        try {
          const payload = JSON.stringify(result);
          const edgeRes = new Response(payload, {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": `public, max-age=${ttlSeconds}`,
            },
          });
          edgeCache.put(cacheReq, edgeRes).catch(() => {});
        } catch {
          // Ignore non-serializable or cache write issues
        }
      }
    } else if (cached) {
      // Serve stale on upstream timeout
      return cached.value as T | null;
    }

    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
