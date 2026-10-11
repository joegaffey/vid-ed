import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStudioServer, type StudioServer } from "../server/index.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vided-api-"));
  await mkdir(join(root, ".vided"), { recursive: true });
  await writeFile(join(root, ".vided", "config.json"), "{}\n");
  await writeFile(join(root, "context.yaml"), "schema: vided.context.input/1\ntone: warm\n");
  await writeFile(
    join(root, "clips.yaml"),
    'schema: vided.clips/1\nclips:\n  - { id: c1, kind: video, source: clipA, format: "720p30", in: 0, out: 4 }\n',
  );
  await writeFile(
    join(root, "edit.yaml"),
    'schema: vided.edl/4\ntracks:\n  - id: v1\n    kind: video\n    items:\n      - { id: a, use: c1, start: 0 }\n',
  );
  return root;
}

async function startServer(root: string): Promise<StudioServer> {
  let lastErr: unknown;
  for (let i = 0; i < 8; i++) {
    const port = 49152 + Math.floor(Math.random() * 15000);
    try {
      return await createStudioServer({ root, port, host: "127.0.0.1" });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("could not bind a port");
}

const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const getJSON = async (url: string) => (await fetch(url)).json();

test("studio API: history, apply, diff, revert, edl edit, staleness", async () => {
  const root = await fixture();
  const server = await startServer(root);
  const base = server.url;
  try {
    // history is seeded (agent) for tracked artifacts
    const seeded = (await getJSON(base + "/api/history")) as Array<{ artifact: string; writer: string }>;
    assert.ok(seeded.find((h) => h.artifact === "context.yaml" && h.writer === "agent"));

    // apply a studio edit
    const applied = (await (
      await post(base, "/api/apply", {
        artifact: "context.yaml",
        content: "schema: vided.context.input/1\ntone: cool\n",
        label: "test",
      })
    ).json()) as { ok?: boolean };
    assert.equal(applied.ok, true);

    // the latest version is attributed to the studio
    const versions = (await getJSON(base + "/api/history/" + encodeURIComponent("context.yaml"))) as {
      versions: Array<{ writer: string; hash: string }>;
    };
    assert.equal(versions.versions.at(-1)!.writer, "studio");
    assert.ok(versions.versions.length >= 2);

    // diff against the original version
    const diff = (await (
      await post(base, "/api/diff", { artifact: "context.yaml", hash: versions.versions[0]!.hash })
    ).json()) as { changed?: boolean; diff?: string };
    assert.equal(diff.changed, true);
    assert.ok(String(diff.diff).includes("tone:"));

    // revert to the first version
    const reverted = (await (
      await post(base, "/api/revert", { artifact: "context.yaml", hash: versions.versions[0]!.hash })
    ).json()) as { ok?: boolean };
    assert.equal(reverted.ok, true);
    assert.ok((await readFile(join(root, "context.yaml"), "utf8")).includes("warm"));

    // EDL edit (set placement) returns structure-preserving YAML
    const edl = (await (
      await post(base, "/api/edl/edit", { ops: [{ op: "set", id: "a", patch: { speed: 2 } }] })
    ).json()) as { yaml: string };
    assert.equal(edl.yaml.includes("speed: 2"), true);

    // invalid EDL edit is rejected
    const bad = await post(base, "/api/edl/edit", { ops: [{ op: "set", id: "a", patch: { speed: -1 } }] });
    assert.equal(bad.status, 400);

    // /api/edl exposes the v4 shape: tracks[] with absolute starts
    const view = (await getJSON(base + "/api/edl")) as {
      tracks?: Array<{ id: string; kind: string; items: Array<{ start: number }> }>;
    };
    assert.ok(Array.isArray(view.tracks));
    assert.equal(view.tracks![0]!.kind, "video");
    assert.equal(view.tracks![0]!.items[0]!.start, 0);

    // per-render metadata: 404 for unknown names, file facts otherwise (ffprobe optional)
    assert.equal((await fetch(base + "/api/render-info/nope.mp4")).status, 404);
    await mkdir(join(root, "out"), { recursive: true });
    await writeFile(join(root, "out", "final.mp4"), "not really a video");
    const info = (await getJSON(base + "/api/render-info/final.mp4")) as { name: string; bytes: number };
    assert.equal(info.name, "final.mp4");
    assert.ok(info.bytes > 0);

    // staleness responds
    assert.ok(Array.isArray(await getJSON(base + "/api/staleness")));

    // a clip-preview request must never take the server down (double-response guard)
    const pv = await fetch(base + "/api/clips/preview?id=c1");
    assert.ok([200, 404, 500].includes(pv.status));
    await pv.arrayBuffer().catch(() => {});
    assert.ok(Array.isArray(await getJSON(base + "/api/jobs")));

    // the context pack is an editable, versioned artifact (work/context.md)
    const appliedPack = await post(base, "/api/apply", { artifact: "work/context.md", content: "# pack\nhello world\n", label: "test" });
    assert.equal(appliedPack.status, 200);
    const pack = (await getJSON(base + "/api/context-pack")) as { exists: boolean; markdown: string };
    assert.equal(pack.exists, true);
    assert.ok(pack.markdown.includes("hello world"));
    const changesPack = (await getJSON(base + "/api/changes")) as Array<{ artifact: string; writer: string }>;
    assert.ok(changesPack.find((c) => c.artifact === "work/context.md" && c.writer === "studio"));

    // narration script is editable + versioned (narration.yaml)
    assert.equal(((await getJSON(base + "/api/narration")) as { exists: boolean }).exists, false);
    const putNarr = await fetch(base + "/api/narration", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: "en_US-amy-medium", segments: [{ id: "s1", text: "hello", gap_after: 0.2 }] }),
    });
    assert.equal(putNarr.status, 200);
    const narr = (await getJSON(base + "/api/narration")) as { exists: boolean; segments: Array<{ id: string; text: string }> };
    assert.equal(narr.exists, true);
    assert.equal(narr.segments[0]!.text, "hello");
    const changesNarr = (await getJSON(base + "/api/changes")) as Array<{ artifact: string; writer: string }>;
    assert.ok(changesNarr.find((c) => c.artifact === "narration.yaml" && c.writer === "studio"));
  } finally {
    await server.close();
  }
});

test("studio API: external edit is recorded as writer agent", async () => {
  const root = await fixture();
  const server = await startServer(root);
  const base = server.url;
  try {
    await writeFile(join(root, "narration.yaml"), "schema: vided.narration/1\nsegments:\n  - text: hi\n");
    // watcher polls every 2s
    await new Promise((r) => setTimeout(r, 2600));
    const h = (await getJSON(base + "/api/history/" + encodeURIComponent("narration.yaml"))) as {
      versions: Array<{ writer: string }>;
    };
    assert.equal(h.versions.at(-1)!.writer, "agent");
    const notice = await readFile(join(root, ".vided", "STUDIO_CHANGES.md"), "utf8");
    assert.ok(!notice.includes("narration.yaml")); // agent wrote it, so no studio entry
  } finally {
    await server.close();
  }
});

test("studio API: the brief lives in brief.md", async () => {
  const root = await fixture();
  await writeFile(join(root, "brief.md"), "hello\n");
  const server = await startServer(root);
  const base = server.url;
  try {
    const before = (await getJSON(base + "/api/context")) as { brief: string; brief_source: string | null };
    assert.equal(before.brief, "hello");
    assert.equal(before.brief_source, "brief.md");

    const res = await fetch(base + "/api/context", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...before, brief: "new brief" }),
    });
    assert.equal(res.status, 200);
    assert.ok((await readFile(join(root, "brief.md"), "utf8")).includes("new brief"));

    const after = (await getJSON(base + "/api/context")) as { brief: string; brief_source: string | null };
    assert.equal(after.brief, "new brief");
    assert.equal(after.brief_source, "brief.md");
  } finally {
    await server.close();
  }
});
