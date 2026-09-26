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
  await writeFile(join(root, "context.yaml"), "schema: vided.context.input/1\nbrief: hello\n");
  await writeFile(
    join(root, "clips.yaml"),
    'schema: vided.clips/1\nclips:\n  - { id: c1, kind: video, source: clipA, format: "720p30", in: 0, out: 4 }\n',
  );
  await writeFile(
    join(root, "edit.yaml"),
    'schema: vided.edl/3\ntracks:\n  visual:\n    - { id: a, use: c1 }\n  audio: []\n',
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
        content: "schema: vided.context.input/1\nbrief: changed\n",
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
    assert.ok(String(diff.diff).includes("brief:"));

    // revert to the first version
    const reverted = (await (
      await post(base, "/api/revert", { artifact: "context.yaml", hash: versions.versions[0]!.hash })
    ).json()) as { ok?: boolean };
    assert.equal(reverted.ok, true);
    assert.ok((await readFile(join(root, "context.yaml"), "utf8")).includes("hello"));

    // EDL edit (set placement) returns structure-preserving YAML
    const edl = (await (
      await post(base, "/api/edl/edit", { ops: [{ op: "set", id: "a", patch: { speed: 2 } }] })
    ).json()) as { yaml: string };
    assert.equal(edl.yaml.includes("speed: 2"), true);

    // invalid EDL edit is rejected
    const bad = await post(base, "/api/edl/edit", { ops: [{ op: "set", id: "a", patch: { speed: -1 } }] });
    assert.equal(bad.status, 400);

    // per-render metadata: 404 for unknown names, file facts otherwise (ffprobe optional)
    assert.equal((await fetch(base + "/api/render-info/nope.mp4")).status, 404);
    await mkdir(join(root, "out"), { recursive: true });
    await writeFile(join(root, "out", "final.mp4"), "not really a video");
    const info = (await getJSON(base + "/api/render-info/final.mp4")) as { name: string; bytes: number };
    assert.equal(info.name, "final.mp4");
    assert.ok(info.bytes > 0);

    // staleness responds
    assert.ok(Array.isArray(await getJSON(base + "/api/staleness")));
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
