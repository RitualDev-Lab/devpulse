interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const isolateCache = new Map<string, CacheEntry<unknown>>();

/**
 * In-isolate TTL cache + strict timeout cap so external package registries
 * never block SSR page loads for >2.8s and repeat visits return in <5ms.
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
    } else if (cached) {
      // Serve stale on upstream timeout
      return cached.value as T | null;
    }

    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
