const fs = require('fs');
const path = require('path');

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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

// 2. Copy server-functions, middleware, and .build into assets so all relative imports resolve
copyDirSync(path.join(openNextDir, 'server-functions'), path.join(assetsDir, 'server-functions'));
copyDirSync(path.join(openNextDir, 'middleware'), path.join(assetsDir, 'middleware'));
copyDirSync(path.join(openNextDir, '.build'), path.join(assetsDir, '.build'));

console.log('Successfully prepared Cloudflare Pages assets with _worker.js and all dependencies.');
