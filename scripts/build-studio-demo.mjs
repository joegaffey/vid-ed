import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ClipsSchema, KNOWN_FORMATS } from "../dist/schemas/clips.js";
import { EdlSchema } from "../dist/schemas/edl.js";
import { explainEdl, resolveEdl } from "../dist/edl.js";

/**
 * Build a static, read-only studio demo for GitHub Pages from a sample project.
 * The emitted `api/` directory *is* the API: the client (built with relative
 * `api/...` paths) fetches these files directly. No server, no SSE, no jobs.
 */
const SAMPLE = "samples/rc-build-agent-demo";
const OUT = "dist/studio-demo";
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

const read = (p) => readFile(join(SAMPLE, p), "utf8");
const api = (p) => join(OUT, "api", p);
async function writeJSON(rel, data) {
  const p = api(rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// --- data ---------------------------------------------------------------
const manifest = JSON.parse(await read("manifest.json"));
const clipsText = await read("clips.yaml");
const editText = await read("edit.yaml");
const clips = ClipsSchema.parse(parseYaml(clipsText)).clips;
const edl = EdlSchema.parse(parseYaml(editText));

await writeJSON("status", {
  project: "rc-build-agent-demo",
  root: "",
  assets: manifest.totals.assets,
  duration_s: manifest.totals.duration_s,
  unique_frames: manifest.totals.unique_frames,
  tools: { ffmpeg: true, ffprobe: true, whisper: false, piper: true },
});
await writeJSON("manifest", manifest);
await writeJSON("clips", { file: "clips.yaml", clips, formats: Object.keys(KNOWN_FORMATS) });
await writeJSON("context", {});
await writeJSON("jobs", []);
await writeJSON("staleness", []);

const ctxMd = await read("context.md");
await writeJSON("context-pack", { exists: true, file: "context.md", markdown: ctxMd, chars: ctxMd.length });

const resolved = resolveEdl(edl, new Map(clips.map((c) => [c.id, c])));
if (resolved.resolved) await writeJSON("edl", { file: "edit.yaml", edl, ...explainEdl(resolved.resolved) });

// outputs = the committed demo render(s)
const outFiles = existsSync(join(SAMPLE, "media/outputs")) ? await readdir(join(SAMPLE, "media/outputs")) : [];
const outputs = [];
for (const name of outFiles) {
  const st = await stat(join(SAMPLE, "media/outputs", name));
  outputs.push({ name, bytes: st.size, mtime: st.mtime.toISOString() });
}
await writeJSON("renders", outputs);
// per-output technical metadata (baked so the static build needs no ffprobe)
const infoDir = join(SAMPLE, "media/render-info");
for (const o of outputs) {
  const p = join(infoDir, o.name + ".json");
  if (existsSync(p)) await writeJSON(`render-info/${o.name}`, JSON.parse(await readFile(p, "utf8")));
}
// history: one agent version per tracked artifact present in the sample
const tracked = ["clips.yaml", "edit.yaml", "narration.yaml", "brief.md"];
const history = [];
for (const a of tracked) {
  const text = await read(a);
  const v = { ts: new Date().toISOString(), writer: "agent", hash: hash(text), label: "" };
  history.push({ artifact: a, ...v });
  await writeJSON(`history/${encodeURIComponent(a)}`, { artifact: a, versions: [v] });
}
await writeJSON("changes", history);

// per-asset frames (only the selected frames are committed under media/frames)
for (const asset of manifest.assets) {
  const selected = (asset.visual?.frames ?? []).filter((f) => f.selected);
  const dir = join(SAMPLE, "media/frames", asset.id);
  const present = existsSync(dir) ? new Set(await readdir(dir)) : new Set();
  const frames = selected
    .filter((f) => present.has(f.path.split("/").pop()))
    .map((f) => ({
      t: f.t,
      selected: true,
      ...(f.scene ? { scene: f.scene } : {}),
      ...(f.description ? { description: f.description } : {}),
      tags: f.tags ?? [],
      url: `api/frames/${asset.id}/${f.path.split("/").pop()}`,
    }));
  if (frames.length) await writeJSON(`assets/${asset.id}/frames`, { asset: asset.path, kind: asset.kind, frames });
}

// --- media --------------------------------------------------------------
for (const dir of ["frames", "outputs"]) {
  const from = join(SAMPLE, "media", dir);
  if (existsSync(from)) await cp(from, api(dir), { recursive: true });
}
// image sources: media/sources/<assetId>.<ext> -> api/media/<assetId> (served as a file)
const sourcesDir = join(SAMPLE, "media/sources");
if (existsSync(sourcesDir)) {
  for (const name of await readdir(sourcesDir)) {
    await mkdir(api("media"), { recursive: true });
    await cp(join(sourcesDir, name), api(join("media", name.replace(/\.[^.]+$/, ""))));
  }
}

// --- shell --------------------------------------------------------------
await cp("dist/studio/app.js", join(OUT, "app.js"));
await cp("dist/studio/app.css", join(OUT, "app.css"));
const [jsBuf, cssBuf] = await Promise.all([
  readFile(join(OUT, "app.js")),
  readFile(join(OUT, "app.css")),
]);
const shell = (await readFile("src/server/public/index.html", "utf8"))
  .replace("./app.css", `./app.css?v=${hash(cssBuf)}`)
  .replace("./app.js", `./app.js?v=${hash(jsBuf)}`)
  .replace(
    "</head>",
    '  <link rel="icon" href="data:," />\n  <script id="vided-config" type="application/json">{ "mode": "static" }</script>\n</head>',
  );
await writeFile(join(OUT, "index.html"), shell, "utf8");
await writeFile(join(OUT, ".nojekyll"), "", "utf8");

console.log(`studio demo → ${OUT} (clips ${clips.length}, outputs ${outputs.length})`);
