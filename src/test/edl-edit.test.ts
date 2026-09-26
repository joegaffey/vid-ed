import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdlOps } from "../edl-edit.js";

const EDL = `schema: vided.edl/3
# a comment that should survive
tracks:
  visual:
    - id: a
      use: c1
    - id: b
      use: c2
      speed: 2
  audio: []
`;

test("set updates a placement and preserves comments", () => {
  const r = applyEdlOps(EDL, [{ op: "set", id: "a", patch: { speed: 3 } }]);
  assert.equal(r.ok, true);
  assert.ok(r.yaml!.includes("speed: 3"));
  assert.ok(r.yaml!.includes("# a comment that should survive"));
  assert.ok(r.yaml!.includes("id: b"));
});

test("reorder moves an item and remove deletes it", () => {
  const moved = applyEdlOps(EDL, [{ op: "reorder", id: "b", delta: -1 }]);
  assert.equal(moved.ok, true);
  assert.ok(moved.yaml!.indexOf("id: b") < moved.yaml!.indexOf("id: a"));
  const removed = applyEdlOps(EDL, [{ op: "remove", id: "b" }]);
  assert.equal(removed.ok, true);
  assert.ok(!removed.yaml!.includes("id: b"));
});

test("add appends a placement referencing a clip", () => {
  const r = applyEdlOps(EDL, [{ op: "add", use: "c3", id: "c" }]);
  assert.equal(r.ok, true);
  assert.ok(r.yaml!.includes("use: c3"));
});

test("schema-invalid edits are rejected", () => {
  const r = applyEdlOps(EDL, [{ op: "set", id: "a", patch: { speed: -2 } }]);
  assert.equal(r.ok, false);
  assert.ok(r.issues && r.issues.length > 0);
});

test("set-captions patches the captions layer", () => {
  const r = applyEdlOps(EDL, [{ op: "set-captions", patch: { mode: "burn", file: "work/captions.ass" } }]);
  assert.equal(r.ok, true);
  assert.ok(r.yaml!.includes("mode: burn"));
  assert.ok(r.yaml!.includes("work/captions.ass"));
});
