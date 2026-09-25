import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheKey } from "../cache.js";
import { buildManifest } from "../manifest.js";
import { AssetRecordSchema, SCHEMA_VERSION } from "../schemas/asset.js";

const sample = {
  schema: SCHEMA_VERSION,
  id: "abc123",
  path: "input/a.mp4",
  kind: "video" as const,
  content_hash: "sha256:deadbeef",
  bytes: 100,
  mtime: "2026-01-01T00:00:00.000Z",
  status: "probed" as const,
  technical: { duration_s: 12.5 },
  extracted: { transcript: null, ocr: null, sidecar: null },
  visual: { scenes: [], frames: [] },
  tags: [],
  provenance: { tool: "vided", version: "0.1.0", generated_at: "2026-01-01T00:00:00.000Z" },
};

test("asset record parses and applies defaults", () => {
  const parsed = AssetRecordSchema.parse(sample);
  assert.equal(parsed.kind, "video");
  assert.deepEqual(parsed.visual.frames, []);
});

test("buildManifest aggregates totals", () => {
  const asset = AssetRecordSchema.parse({
    ...sample,
    visual: {
      scenes: [],
      frames: [{ t: 1, path: "f.webp", selected: true }],
    },
  });
  const m = buildManifest([asset], {
    project: "p",
    input_roots: ["input"],
    config_hash: "sha256:x",
  });
  assert.equal(m.totals.assets, 1);
  assert.equal(m.totals.duration_s, 12.5);
  assert.equal(m.totals.unique_frames, 1);
});

test("cacheKey is order-sensitive and stable", () => {
  assert.equal(cacheKey(["a", 1]), cacheKey(["a", 1]));
  assert.notEqual(cacheKey(["a", 1]), cacheKey([1, "a"]));
});
