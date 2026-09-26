import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HistoryStore, diffLines, writeStudioChanges } from "../server/history.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vided-history-"));
}

test("HistoryStore appends, dedupes the current version, and tracks latest", async () => {
  const root = await tempRoot();
  const store = new HistoryStore(root);
  const a = await store.append("context.yaml", { content: "a: 1\n", writer: "agent" });
  const b = await store.append("context.yaml", { content: "a: 2\n", writer: "studio", label: "edit" });
  const dup = await store.append("context.yaml", { content: "a: 2\n", writer: "studio" });
  assert.equal(dup.hash, b.hash);
  const h = await store.read("context.yaml");
  assert.equal(h.versions.length, 2);
  const latest = await store.latest("context.yaml");
  assert.equal(latest!.hash, b.hash);
  assert.equal(latest!.writer, "studio");
  assert.equal(latest!.label, "edit");
  assert.notEqual(a.hash, b.hash);
});

test("writeStudioChanges lists only studio-written artifacts", async () => {
  const root = await tempRoot();
  await mkdir(join(root, ".vided"), { recursive: true });
  const store = new HistoryStore(root);
  await store.append("context.yaml", { content: "brief: hi\n", writer: "studio", label: "edit" });
  await store.append("edit.yaml", { content: "schema: vided.edl/1\n", writer: "agent" });
  await writeStudioChanges(root, store);
  const md = await readFile(join(root, ".vided", "STUDIO_CHANGES.md"), "utf8");
  assert.ok(md.includes("`context.yaml`"));
  assert.ok(!md.includes("`edit.yaml`"));
});

test("diffLines marks additions and removals", async () => {
  const d = diffLines("a\nb\nc\n", "a\nx\nc\n");
  assert.ok(d.includes("- b"));
  assert.ok(d.includes("+ x"));
  assert.ok(d.includes("  a"));
});
