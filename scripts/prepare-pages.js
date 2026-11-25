const fs = require('fs');
const path = require('path');

const openNextDir = path.resolve('.open-next');
const assetsDir = path.resolve('.open-next/assets');

if (!fs.existsSync(openNextDir)) {
  console.error('.open-next directory not found!');
  process.exit(1);
}

// 0. Guard against any remaining cookie@1.x default.parse() calls in OpenNext bundles
for (const rel of ['middleware/handler.mjs', 'server-functions/default/handler.mjs', 'server-functions/default/index.mjs']) {
  const bundlePath = path.join(openNextDir, rel);
  if (fs.existsSync(bundlePath)) {
    const orig = fs.readFileSync(bundlePath, 'utf-8');
    const fixed = orig.replace(/import_cookie\.default\.parse\(/g, '(import_cookie.parse || import_cookie.default?.parse)(');
    if (fixed !== orig) {
      fs.writeFileSync(bundlePath, fixed, 'utf-8');
      console.log(`Patched import_cookie.default.parse in ${rel}`);
    }
  }
}

// 1. Create a Pages-compatible _worker.js that checks env.ASSETS first
const workerContent = `// @ts-expect-error
import { handleCdnCgiImageRequest, handleImageRequest, isCdnCgiImageRequest } from "./cloudflare/images.js";
// @ts-expect-error
import { runWithCloudflareRequestContext } from "./cloudflare/init.js";
// @ts-expect-error
import { maybeGetSkewProtectionResponse } from "./cloudflare/skew-protection.js";
// @ts-expect-error
import { handler as middlewareHandler } from "./middleware/handler.mjs";
export { DOQueueHandler } from "./.build/durable-objects/queue.js";
export { DOShardedTagCache } from "./.build/durable-objects/sharded-tag-cache.js";
export { BucketCachePurge } from "./.build/durable-objects/bucket-cache-purge.js";

export default {
    async fetch(request, env, ctx) {
        // 1. Serve static assets directly from Cloudflare Pages ASSETS binding
        try {
            if (env && env.ASSETS) {
                const asset = await env.ASSETS.fetch(request.clone());
                if (asset.status < 400) {
                    return asset;
                }
            }
        } catch (err) {
            console.error("Asset fetch error:", err);
        }

        // 2. Delegate to Next.js OpenNext Server
        try {
            return await runWithCloudflareRequestContext(request, env, ctx, async () => {
                const response = maybeGetSkewProtectionResponse(request);
                if (response) {
                    return response;
                }
                const url = new URL(request.url);
                if (isCdnCgiImageRequest(url, request.headers)) {
                    return handleCdnCgiImageRequest(url, env);
                }
                const basePath = globalThis.__NEXT_BASE_PATH__ || "";
                const trailingSlash = globalThis.__TRAILING_SLASH__ ? "/" : "";
                if (url.pathname === \`\${basePath}/_next/image\${trailingSlash}\`) {
                    return await handleImageRequest(url, request.headers, env);
                }
                const reqOrResp = await middlewareHandler(request, env, ctx);
                if (reqOrResp instanceof Response) {
                    return reqOrResp;
                }
                if (url.searchParams.has("__debug")) {
                    return new Response(JSON.stringify({
                        reqOrResp,
                        envKeys: Object.keys(env || {}),
                        url: request.url
                    }, null, 2), {
                        status: 200,
                        headers: { "content-type": "application/json" }
                    });
                }

                const capturedErrors = [];
                const originalConsoleError = console.error;
                console.error = (...args) => {
                    capturedErrors.push(args.map(a => (a && a.stack) ? a.stack : String(a)).join(" "));
                    originalConsoleError(...args);
                };

                let res;
                try {
                    const { handler } = await import("./server-functions/default/handler.mjs");
                    res = await handler(reqOrResp, env, ctx, request.signal);
                } finally {
                    console.error = originalConsoleError;
                }

                if (url.searchParams.has("__debug_errors") || (res && res.status === 500 && capturedErrors.length > 0)) {
                    return new Response(JSON.stringify({
                        status: res ? res.status : 500,
                        errors: capturedErrors,
                        url: request.url
                    }, null, 2), {
                        status: 500,
                        headers: { "content-type": "application/json" }
                    });
                }

                if (url.searchParams.has("__debug_res")) {
                    const cloned = res.clone();
                    const text = await cloned.text();
                    return new Response(JSON.stringify({
                        status: res.status,
                        headers: Object.fromEntries(res.headers.entries()),
                        body: text
                    }, null, 2), {
                        status: 200,
                        headers: { "content-type": "application/json" }
                    });
                }
                return res;
            });
        } catch (err) {
            console.error("Next.js Server Execution Error:", err);
            return new Response("DevPulse Edge Error:\\n" + (err.stack || err.message || String(err)), {
                status: 500,
                headers: { "content-type": "text/plain; charset=utf-8" }
            });
        }
    },
    async scheduled(event, env, ctx) {
        // Cloudflare Scheduled Cron Trigger (every 6 hours)
        try {
            console.log("Cloudflare Cron Trigger fired at:", new Date(event.scheduledTime).toISOString(), "cron:", event.cron);
            const dummyRequest = new Request(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/cron/sync`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Cloudflare-Cron-Sync/1.0",
                    ...(env && env.CRON_SECRET ? { "Authorization": "Bearer " + env.CRON_SECRET } : {})
                }
            });
            const { handler } = await import("./server-functions/default/handler.mjs");
            if (ctx && ctx.waitUntil) {
                ctx.waitUntil(handler(dummyRequest, env, ctx));
            } else {
                await handler(dummyRequest, env, ctx);
            }
        } catch (err) {
            console.error("Scheduled cron sync error:", err);
        }
    },
};
`;

fs.writeFileSync(path.join(assetsDir, '_worker.js'), workerContent, 'utf-8');
console.log('Created enhanced Pages _worker.js with ASSETS binding and debug fallback.');

// 3. Copy ALL directories and files from .open-next into assets with dereference: true
for (const item of fs.readdirSync(openNextDir)) {
  if (item === 'assets') continue;
  const src = path.join(openNextDir, item);
  const dest = path.join(assetsDir, item);
  try {
    fs.cpSync(src, dest, { recursive: true, dereference: true });
    console.log(`Copied ${item} -> assets/${item} (dereferenced)`);
  } catch (err) {
    console.warn(`Warning copying ${item}:`, err.message);
  }
}

// 4. Remove any remaining symlinks inside assets directory
function cleanSymlinks(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isSymbolicLink()) {
        fs.unlinkSync(fullPath);
      } else if (entry.isDirectory()) {
        cleanSymlinks(fullPath);
      }
    } catch (e) {
      // ignore
    }
  }
}
cleanSymlinks(assetsDir);

console.log('Successfully prepared Cloudflare Pages assets with _worker.js and all dependencies.');
