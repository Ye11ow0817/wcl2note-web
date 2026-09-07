import { build } from "esbuild";
// Verified against edgeone CLI 1.6.34 init template: edge-functions + named onRequest.
await build({
  entryPoints: { "api/wcl/[[path]]": "server/entry.ts" },
  outdir: "edge-functions",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
