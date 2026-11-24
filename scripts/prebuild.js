const fs = require('fs');
const path = require('path');

console.log('Running prebuild patches for Cloudflare Pages & Next.js 16...');

// 1. Patch OpenNext require-hook plugin to match all require-hook imports
const openNextShimFile = path.resolve('node_modules/@opennextjs/cloudflare/dist/cli/build/patches/plugins/require-hook.js');
if (fs.existsSync(openNextShimFile)) {
  let content = fs.readFileSync(openNextShimFile, 'utf-8');
  content = content.replace(
    /filter:\s*getCrossPlatformPathRegex\([^)]+\)/,
    'filter: /require-hook/'
  );
  fs.writeFileSync(openNextShimFile, content, 'utf-8');
  console.log('Patched @opennextjs/cloudflare require-hook filter to /require-hook/');
}

// 2. Patch next/dist/server/require-hook.js to be safe if loaded in workerd
const nextRequireHookFile = path.resolve('node_modules/next/dist/server/require-hook.js');
if (fs.existsSync(nextRequireHookFile)) {
  let content = fs.readFileSync(nextRequireHookFile, 'utf-8');
  content = content.replace(
    'const originalRequire = mod.prototype.require;',
    'const originalRequire = mod?.prototype?.require || (() => {});'
  );
  fs.writeFileSync(nextRequireHookFile, content, 'utf-8');
  console.log('Patched next/dist/server/require-hook.js prototype safety.');
}

// 3. Patch next/dist/build/adapter/setup-node-env.external.js
const setupNodeEnvFile = path.resolve('node_modules/next/dist/build/adapter/setup-node-env.external.js');
if (fs.existsSync(setupNodeEnvFile)) {
  let content = fs.readFileSync(setupNodeEnvFile, 'utf-8');
  content = content.replace(
    "require('next/dist/server/require-hook');",
    "// require('next/dist/server/require-hook');"
  );
  fs.writeFileSync(setupNodeEnvFile, content, 'utf-8');
  console.log('Commented out require-hook in setup-node-env.external.js.');
}

console.log('Prebuild patches applied successfully.');
