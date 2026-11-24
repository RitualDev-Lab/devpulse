const fs = require('fs');
const path = require('path');

const openNextDir = path.resolve('.open-next');
const assetsDir = path.resolve('.open-next/assets');

if (!fs.existsSync(openNextDir)) {
  console.error('.open-next directory not found!');
  process.exit(1);
}

// 1. Copy worker.js to assets/_worker.js
const workerSrc = path.join(openNextDir, 'worker.js');
const workerDest = path.join(assetsDir, '_worker.js');
if (fs.existsSync(workerSrc)) {
  fs.copyFileSync(workerSrc, workerDest);
  console.log('Copied worker.js -> assets/_worker.js');
}

// 2. Copy server-functions, middleware, and .build into assets using native fs.cpSync
const dirsToCopy = ['server-functions', 'middleware', '.build'];
for (const dir of dirsToCopy) {
  const src = path.join(openNextDir, dir);
  const dest = path.join(assetsDir, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`Copied ${dir} -> assets/${dir}`);
  }
}

console.log('Successfully prepared Cloudflare Pages assets with _worker.js and all dependencies.');
