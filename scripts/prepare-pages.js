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

// 2. Copy ALL directories and files from .open-next into assets (except assets itself)
for (const item of fs.readdirSync(openNextDir)) {
  if (item === 'assets') continue;
  const src = path.join(openNextDir, item);
  const dest = path.join(assetsDir, item);
  fs.cpSync(src, dest, { recursive: true });
  console.log(`Copied ${item} -> assets/${item}`);
}

console.log('Successfully prepared Cloudflare Pages assets with _worker.js and all dependencies.');
