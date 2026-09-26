import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCliEntry } from "../server/jobs.js";
import { ALLOWED_OPS } from "../server/index.js";

test("resolveCliEntry locates the built CLI", () => {
  const { bin, prefix } = resolveCliEntry();
  assert.equal(prefix.length, 1);
  assert.ok(prefix[0]!.endsWith("cli.js"));
  assert.ok(bin.length > 0);
});

test("ALLOWED_OPS exposes the core stages", () => {
  for (const op of ["scan", "extract-text", "sample", "dedupe", "annotate", "tts", "captions", "render"]) {
    assert.ok(ALLOWED_OPS.has(op), `expected ${op}`);
  }
  assert.ok(!ALLOWED_OPS.has("rm"));
});
