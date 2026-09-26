import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdlOps } from "../edl-edit.js";

const EDL = `schema: vided.edl/1
# a comment that should survive
output:
  resolution: 1280x720
timeline:
  - id: a
    source: clipA
    in: 0
    out: 4
  - id: b
    source: clipB
    in: 2
    out: 6
`;

test("trim updates the clip in/out and preserves comments", () => {
  const r = applyEdlOps(EDL, [{ op: "trim", id: "a", out: 2.5 }]);
  assert.equal(r.ok, true);
  assert.ok(r.yaml!.includes("out: 2.5"));
  assert.ok(r.yaml!.includes("# a comment that should survive"));
  // unaffected item untouched
  assert.ok(r.yaml!.includes("id: b"));
});

test("reorder moves an item and remove deletes it", () => {
  const moved = applyEdlOps(EDL, [{ op: "reorder", id: "b", delta: -1 }]);
  assert.equal(moved.ok, true);
  assert.ok(moved.yaml!.indexOf("id: b") < moved.yaml!.indexOf("id: a"));
  const removed = applyEdlOps(EDL, [{ op: "remove", id: "a" }]);
  assert.equal(removed.ok, true);
  assert.ok(!removed.yaml!.includes("id: a"));
});

test("add-clip appends a new timeline item", () => {
  const r = applyEdlOps(EDL, [{ op: "add-clip", source: "clipC", in: 0, out: 3 }]);
  assert.equal(r.ok, true);
  assert.ok(r.yaml!.includes("source: clipC"));
});

test("schema-invalid edits are rejected", () => {
  const r = applyEdlOps(EDL, [{ op: "set", id: "a", patch: { speed: -2 } }]);
  assert.equal(r.ok, false);
  assert.ok(r.issues && r.issues.length > 0);
});
