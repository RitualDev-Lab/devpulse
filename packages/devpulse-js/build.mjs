import esbuild from "esbuild";
import fs from "fs";

fs.mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: "dist/index.mjs",
});

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: "dist/index.cjs",
});

await esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "dist/cli.mjs",
});

console.log("Built @ritualdev/devpulse dist artifacts cleanly.");
