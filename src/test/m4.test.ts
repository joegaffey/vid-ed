import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPacket } from "../commands/annotate.js";
import { buildScaffold } from "../commands/script.js";
import { buildContextJson, buildContextPack } from "../context.js";
import { buildManifest } from "../manifest.js";
import { AssetRecordSchema, SCHEMA_VERSION, type AssetRecord } from "../schemas/asset.js";
import { VisionResultsSchema } from "../schemas/vision.js";

function asset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return AssetRecordSchema.parse({
    schema: SCHEMA_VERSION,
    id: "a1",
    path: "input/a.mp4",
    kind: "video",
    content_hash: "sha256:x",
    bytes: 1,
    mtime: "2026-01-01T00:00:00.000Z",
    technical: { duration_s: 10 },
    extracted: {
      transcript: {
        tool: "whisper.cpp",
        segments: [
          { start: 0, end: 2, text: "hello there" },
          { start: 5, end: 7, text: "second line" },
        ],
      },
    },
    visual: {
      scenes: [{ id: "s0", start: 0, end: 4 }],
      frames: [
        { t: 1, path: "f1.webp", selected: true, scene: "s0" },
        { t: 2, path: "f2.webp", selected: false, scene: "s0" },
        { t: 6, path: "f3.webp", selected: true, description: "already seen", tags: ["x"] },
      ],
    },
    provenance: { tool: "vided", version: "0.1.0", generated_at: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  });
}

test("buildPacket includes only selected frames with scene context", () => {
  const frames = buildPacket([asset()], { window: 2 });
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.frame, "f1.webp");
  assert.equal(frames[0]!.scene_start, 0);
  assert.equal(frames[0]!.transcript, "hello there");
  assert.equal(frames[1]!.description, "already seen");
});

test("buildPacket honours the asset filter", () => {
  const frames = buildPacket([asset()], { window: 2, filter: new Set(["nope"]) });
  assert.equal(frames.length, 0);
});

test("VisionResultsSchema applies tag defaults", () => {
  const parsed = VisionResultsSchema.parse({
    schema: "vided.vision.results/1",
    frames: [{ frame: "f1.webp", description: "hi" }],
  });
  assert.deepEqual(parsed.frames[0]!.tags, []);
});

test("context pack includes descriptions and respects the budget", () => {
  const a = asset({
    visual: {
      scenes: [{ id: "s0", start: 0, end: 4 }],
      frames: [{ t: 1, path: "f1.webp", selected: true, scene: "s0", description: "A red car.", tags: ["car"] }],
    },
  });
  const manifest = buildManifest([a], {
    project: "p",
    input_roots: ["input"],
    config_hash: "sha256:x",
  });
  const pack = buildContextPack(manifest, { maxChars: 4000 });
  assert.ok(pack.markdown.includes("A red car."));
  assert.ok(pack.markdown.includes("hello there"));
  assert.equal(pack.truncated, false);

  const tiny = buildContextPack(manifest, { maxChars: 20 });
  assert.equal(tiny.truncated, true);
});

test("buildScaffold maps described frames to timed narration segments", () => {
  const manifest = buildManifest([asset()], {
    project: "p",
    input_roots: ["input"],
    config_hash: "sha256:x",
  });
  const script = buildScaffold(manifest, { gap: 0.5, voice: "amy" });
  assert.equal(script.segments.length, 1);
  assert.equal(script.segments[0]!.start, 6);
  assert.equal(script.segments[0]!.gap_after, 0.5);
  assert.equal(script.voice, "amy");
});

test("buildContextPack folds in brief and per-asset notes", () => {
  const manifest = buildManifest([asset()], {
    project: "p",
    input_roots: ["input"],
    config_hash: "sha256:x",
  });
  const pack = buildContextPack(manifest, {
    maxChars: 4000,
    brief: "Explainer for developers.",
    notes: { a1: "Use the first six seconds." },
  });
  assert.ok(pack.markdown.includes("## Brief"));
  assert.ok(pack.markdown.includes("Explainer for developers."));
  assert.ok(pack.markdown.includes("notes: Use the first six seconds."));
  assert.equal(pack.json.brief, "Explainer for developers.");
  assert.equal(pack.json.assets[0]!.notes, "Use the first six seconds.");
});

test("buildScaffold carries per-asset notes into segments", () => {
  const manifest = buildManifest([asset()], {
    project: "p",
    input_roots: ["input"],
    config_hash: "sha256:x",
  });
  const script = buildScaffold(manifest, { notes: { a1: "Speaker: Joe." } });
  assert.equal(script.segments[0]!.note, "Speaker: Joe.");
});

test("buildContextJson distils assets", () => {
  const json = buildContextJson(
    buildManifest([asset()], { project: "p", input_roots: [], config_hash: "sha256:x" }),
  );
  assert.equal(json.schema, "vided.context/1");
  assert.equal(json.assets[0]!.frames.length, 2);
  assert.equal(json.assets[0]!.transcript.length, 2);
});
