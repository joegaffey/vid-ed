import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse } from "yaml";
import { ClipsSchema } from "../schemas/clips.js";
import { EdlSchema } from "../schemas/edl.js";
import { explainEdl, lintEdl, resolveEdl } from "../edl.js";
import { buildRenderPlan } from "../render.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const resolve = () => ({ path: "/tmp/placeholder.mp4" });

test("examples/edit.yaml + clips.yaml validate, resolve and render (all clip kinds)", () => {
  const clips = ClipsSchema.parse(parse(read("examples/clips.yaml"))).clips;
  const edl = EdlSchema.parse(parse(read("examples/edit.yaml")));

  const res = resolveEdl(edl, new Map(clips.map((c) => [c.id, c])));
  assert.equal(res.ok, true, res.errors.join("; "));
  const resolved = res.resolved!;

  // every visual kind is represented, plus an audio-track clip
  const kinds = new Set(resolved.visual.map((v) => v.clip.kind));
  for (const k of ["title", "slide", "image", "video"]) {
    assert.ok(kinds.has(k as never), `example is missing a ${k} clip`);
  }
  assert.equal(resolved.audio.length, 1);

  // resolves to a valid, lint-clean composition (placeholders resolve via the stub)
  const errors = lintEdl(resolved, resolve).filter((i) => i.level === "error");
  assert.deepEqual(errors, []);

  // renders to an ffmpeg plan: concat + soft-captions mux
  const plan = buildRenderPlan(resolved, { root, resolveSource: resolve, ffmpeg: "ffmpeg", workDir: join(root, ".vided", "work") });
  assert.ok(plan.filter.includes("concat="));
  assert.ok(plan.args.includes("mov_text"));
  assert.ok(plan.duration > 0);
  assert.ok(plan.artifacts.some((a) => a.path.endsWith(".ass")));

  const ex = explainEdl(resolved, resolve);
  assert.equal(ex.clip_count, resolved.visual.length);
});
