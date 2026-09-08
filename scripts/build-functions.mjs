import { build } from "esbuild";
// Build the versioned platform route into a separate local verification bundle.
await build({
  entryPoints: { "api/wcl/[[path]]": "edge-functions/api/wcl/[[path]].ts" },
  outdir: ".edge-build",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
