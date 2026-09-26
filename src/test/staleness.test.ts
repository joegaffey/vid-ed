import assert from "node:assert/strict";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { computeStaleness } from "../server/staleness.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vided-stale-"));
}

const old = new Date(Date.now() - 60_000);
const fresh = new Date();

test("a newer input marks the downstream node stale", async () => {
  const root = await tempRoot();
  await mkdir(join(root, "work"), { recursive: true });
  await writeFile(join(root, "context.yaml"), "brief: new\n");
  await writeFile(join(root, "work", "context.md"), "old pack\n");
  // context.yaml is fresh, the pack is old
  await utimes(join(root, "work", "context.md"), old, old);
  await utimes(join(root, "context.yaml"), fresh, fresh);
  const stale = await computeStaleness(root);
  assert.ok(stale.some((n) => n.id === "context-pack"));
  const node = stale.find((n) => n.id === "context-pack")!;
  assert.deepEqual(node.staleInputs, ["context.yaml"]);
});

test("an up-to-date output is not stale", async () => {
  const root = await tempRoot();
  await mkdir(join(root, "work"), { recursive: true });
  await writeFile(join(root, "context.yaml"), "brief: old\n");
  await writeFile(join(root, "work", "context.md"), "fresh pack\n");
  await utimes(join(root, "context.yaml"), old, old);
  await utimes(join(root, "work", "context.md"), fresh, fresh);
  const stale = await computeStaleness(root);
  assert.ok(!stale.some((n) => n.id === "context-pack"));
});

test("missing outputs are never stale", async () => {
  const root = await tempRoot();
  await writeFile(join(root, "narration.yaml"), "schema: vided.narration/1\n");
  const stale = await computeStaleness(root);
  assert.equal(stale.length, 0);
});
