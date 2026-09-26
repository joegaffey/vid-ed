import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveClips, hasPlaceableMedia } from "../clips.js";
import { loadEdlFromString, resolveEdl } from "../edl.js";
import { clipId, ClipsSchema, KNOWN_FORMATS } from "../schemas/clips.js";
import type { Manifest } from "../schemas/manifest.js";

test("clip schema: kinds, formats and defaults", () => {
  const clips = ClipsSchema.parse({
    schema: "vided.clips/1",
    clips: [
      { id: "v1", kind: "video", source: "a.mp4", format: "1080p30", out: 4 },
      { id: "i1", kind: "image", source: "p.png", format: "720p30" },
      { id: "a1", kind: "audio", source: "m.mp3", format: "audio48k", out: 30 },
      { id: "t1", kind: "title", source: "generated", format: "1080p30", title: "Hi" },
      { id: "s1", kind: "slide", source: "generated", format: "1080p30", heading: "loop()", variant: "code" },
    ],
  }).clips;
  assert.equal(clips[0]!.origin, "agent");
  assert.equal(clips[0]!.muted, false);
  assert.equal((clips[0] as { speed: number }).speed, 1);
  assert.equal((clips[4] as { variant: string }).variant, "mono");
  assert.ok("1080p30" in KNOWN_FORMATS);
});

test("clipId is stable", () => {
  assert.equal(clipId("a/b.mp4", 12.5, 20), "sel-b-12500-20000");
});

const MANIFEST = {
  assets: [
    {
      id: "v1",
      path: "in/a.mp4",
      kind: "video",
      technical: { duration_s: 60 },
      visual: {
        scenes: [
          { id: "s1", start: 0, end: 10 },
          { id: "s2", start: 10, end: 20 },
          { id: "s3", start: 50, end: 70 },
        ],
        frames: [
          { t: 2, selected: true },
          { t: 3, selected: true },
          { t: 30, selected: true },
          { t: 40, selected: false },
        ],
      },
      extracted: {
        transcript: {
          segments: [
            { start: 1, end: 2.2, text: "hello" },
            { start: 2.4, end: 4, text: "world" },
            { start: 20, end: 22, text: "later" },
          ],
        },
      },
    },
    { id: "i1", path: "in/pic.png", kind: "image", technical: {}, visual: { scenes: [], frames: [] }, extracted: { transcript: null } },
    { id: "a1", path: "in/song.mp3", kind: "audio", technical: { duration_s: 20 }, visual: { scenes: [], frames: [] }, extracted: { transcript: null } },
  ],
} as unknown as Manifest;

test("deriveClips: video beats/clusters/scenes plus image and audio clips", () => {
  const clips = deriveClips(MANIFEST);
  const video = clips.filter((c) => c.source === "in/a.mp4") as Array<{ in: number; out: number }>;
  assert.deepEqual(video.map((c) => [c.in, c.out]), [
    [0, 10],
    [1, 4],
    [10, 20],
    [20, 22],
    [29, 31],
    [50, 60],
  ]);
  assert.ok(clips.some((c) => c.kind === "image" && c.source === "in/pic.png"));
  assert.ok(clips.some((c) => c.kind === "audio" && c.source === "in/song.mp3"));
  assert.ok(clips.every((c) => c.origin === "derived"));
  assert.ok(clips.every((c) => c.format in KNOWN_FORMATS));
});

test("hasPlaceableMedia: video/image/audio yes, text-only no", () => {
  assert.equal(hasPlaceableMedia(MANIFEST), true);
  assert.equal(hasPlaceableMedia({ assets: [{ kind: "text" }] } as unknown as Manifest), false);
});

const POOL = ClipsSchema.parse({
  schema: "vided.clips/1",
  clips: [
    { id: "v1", kind: "video", source: "a.mp4", format: "1080p30", out: 4 },
    { id: "a1", kind: "audio", source: "m.mp3", format: "audio48k", out: 10 },
  ],
}).clips;
const pool = new Map(POOL.map((c) => [c.id, c]));

test("resolveEdl binds refs and validates kind↔track", () => {
  const r = loadEdlFromString(`schema: vided.edl/3
tracks:
  visual:
    - { id: v, use: v1 }
  audio:
    - { id: m, use: a1, offset: 2 }
`);
  assert.equal(r.ok, true);
  const res = resolveEdl(r.edl!, pool);
  assert.equal(res.ok, true);
  assert.equal(res.resolved!.visual[0]!.clip.source, "a.mp4");
  assert.equal(res.resolved!.audio[0]!.offset, 2);
});

test("resolveEdl errors on unknown refs and wrong-track kinds", () => {
  const r = loadEdlFromString(`schema: vided.edl/3
tracks:
  visual:
    - { id: v, use: a1 }
  audio:
    - { id: m, use: nope }
`);
  assert.equal(r.ok, true);
  const res = resolveEdl(r.edl!, pool);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("visual track needs")));
  assert.ok(res.errors.some((e) => e.includes("unknown clip")));
});
