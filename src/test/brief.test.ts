import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectPaths } from "../config.js";
import { loadBrief, saveBrief } from "../context.js";
import { cmdManifest } from "../commands/manifest.js";

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vided-brief-"));
  await mkdir(join(root, ".vided"), { recursive: true });
  await writeFile(join(root, ".vided", "config.json"), "{}\n");
  return root;
}

test("brief: brief.md is the single source", async () => {
  const root = await project();
  assert.equal(await loadBrief(projectPaths(root)), undefined);
  await writeFile(join(root, "brief.md"), "From brief.md\n");
  assert.equal(await loadBrief(projectPaths(root)), "From brief.md");
});

test("brief: save then reload round-trips brief.md", async () => {
  const root = await project();
  const paths = projectPaths(root);
  await saveBrief(paths, "hello");
  assert.equal(await loadBrief(paths), "hello");
  await saveBrief(paths, "   ");
  assert.equal(await loadBrief(paths), undefined);
});

test("brief: a new agent writes brief.md and builds a context pack (no media)", async () => {
  const root = await project();
  await writeFile(join(root, "brief.md"), "Audience: makers. Tone: warm.\n");
  await cmdManifest({ dir: root, contextPack: "work/context.md", json: true, quiet: true });
  const md = await readFile(join(root, "work", "context.md"), "utf8");
  assert.ok(md.includes("## Brief"));
  assert.ok(md.includes("Audience: makers. Tone: warm."));
  const json = JSON.parse(await readFile(join(root, "work", "context.json"), "utf8")) as { brief?: string };
  assert.equal(json.brief, "Audience: makers. Tone: warm.");
});
