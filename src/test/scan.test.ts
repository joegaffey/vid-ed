import assert from "node:assert/strict";
import { test } from "node:test";
import { preserveDerived } from "../commands/scan.js";
import { AssetRecordSchema, SCHEMA_VERSION, type AssetRecord } from "../schemas/asset.js";

function record(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return AssetRecordSchema.parse({
    schema: SCHEMA_VERSION,
    id: "abc",
    path: "input/a.mp4",
    kind: "video",
    content_hash: "sha256:x",
    bytes: 1,
    mtime: "2026-01-01T00:00:00.000Z",
    status: "probed",
    technical: {},
    extracted: { transcript: null, ocr: null, sidecar: null },
    visual: { scenes: [], frames: [] },
    tags: [],
    provenance: { tool: "vided", version: "0.1.0", generated_at: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  });
}

test("preserveDerived keeps derived data for an unchanged file", () => {
  const existing = record({
    status: "annotated",
    tags: ["demo"],
    summary: "a summary",
    notes: "some notes",
    extracted: {
      transcript: { tool: "whisper.cpp", segments: [{ start: 0, end: 1, text: "hi" }] },
      ocr: null,
      sidecar: null,
    },
    visual: {
      scenes: [{ id: "s0", start: 0, end: 3 }],
      frames: [{ t: 1, path: "f.jpg", selected: true, tags: [] }],
    },
  });
  const merged = preserveDerived(existing, record());
  assert.equal(merged.status, "annotated");
  assert.equal(merged.visual.frames.length, 1);
  assert.equal(merged.extracted.transcript?.segments.length, 1);
  assert.deepEqual(merged.tags, ["demo"]);
  assert.equal(merged.summary, "a summary");
  assert.equal(merged.notes, "some notes");
});

test("preserveDerived resets when the content hash changed", () => {
  const existing = record({
    status: "annotated",
    content_hash: "sha256:old",
    visual: { scenes: [], frames: [{ t: 1, path: "f.jpg", selected: true, tags: [] }] },
  });
  const merged = preserveDerived(existing, record({ content_hash: "sha256:new" }));
  assert.equal(merged.status, "probed");
  assert.equal(merged.visual.frames.length, 0);
});
