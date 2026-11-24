const fs = require('fs');
const path = require('path');

const openNextDir = path.resolve('.open-next');
const assetsDir = path.resolve('.open-next/assets');

if (!fs.existsSync(openNextDir)) {
  console.error('.open-next directory not found!');
  process.exit(1);
}

// 1. Patch handler.mjs & middleware/handler.mjs to output detailed error trace on 500
const handlerFile = path.join(openNextDir, 'server-functions/default/handler.mjs');
if (fs.existsSync(handlerFile)) {
  let content = fs.readFileSync(handlerFile, 'utf-8');
  content = content.replace(
    'res.end("Internal Server Error")',
    'res.end("Internal Server Error: " + (e?.stack || e?.message || e))'
  );
  content = content.replace(
    'error("NextJS request failed.", e);',
    'console.error("NextJS request failed.", e); res.statusCode = 500; res.setHeader("Content-Type", "text/plain"); res.end("DevPulse NextJS Request Failed:\\n" + (e?.stack || e?.message || String(e))); return;'
  );
  fs.writeFileSync(handlerFile, content, 'utf-8');
  console.log('Patched handler.mjs with detailed error output.');
}

const middlewareHandlerFile = path.join(openNextDir, 'middleware/handler.mjs');
if (fs.existsSync(middlewareHandlerFile)) {
  let mContent = fs.readFileSync(middlewareHandlerFile, 'utf-8');
  mContent = mContent.replace(
    'error("Error in routingHandler", e);',
    'console.error("Error in routingHandler", e); return new Response("OpenNext Routing Error:\\n" + (e?.stack || e?.message || String(e)), { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });'
  );
  fs.writeFileSync(middlewareHandlerFile, mContent, 'utf-8');
  console.log('Patched middleware/handler.mjs with detailed error output.');
}

// 2. Create a Pages-compatible _worker.js that checks env.ASSETS first
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
                const { handler } = await import("./server-functions/default/handler.mjs");
                return await handler(reqOrResp, env, ctx, request.signal);
            });
        } catch (err) {
            console.error("Next.js Server Execution Error:", err);
            return new Response("DevPulse Edge Error:\\n" + (err.stack || err.message || String(err)), {
                status: 500,
                headers: { "content-type": "text/plain; charset=utf-8" }
            });
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
