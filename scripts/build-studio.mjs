import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const out = "dist/studio";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: ["src/server/public/app.js"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: true,
  outfile: `${out}/app.js`,
  logLevel: "warning",
});

await cp("src/server/public/index.html", `${out}/index.html`);
await cp("src/server/public/app.css", `${out}/app.css`);
console.log("studio → dist/studio");
