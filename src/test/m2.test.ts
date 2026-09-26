import assert from "node:assert/strict";
import { test } from "node:test";
import { assTime, buildAss, buildSlideAss, buildTitleAss, toAssColor } from "../captions.js";
import { explainEdl, lintEdl } from "../edl.js";
import { buildRenderPlan, clipDuration, parseResolution, positionExpr } from "../render.js";
import { resolved } from "./fixtures.js";

const sources: Record<string, { path: string; kind?: string; duration?: number }> = {
  clipA: { path: "/tmp/a.mp4", kind: "video", duration: 10 },
  clipB: { path: "/tmp/b.mp4", kind: "video", duration: 5 },
  vo: { path: "/tmp/vo.wav" },
  mu: { path: "/tmp/mu.mp3" },
  shot: { path: "/tmp/shot.png", kind: "image" },
};
const resolve = (s: string) => sources[s];

test("explainEdl accumulates positions with speed", () => {
  const edl = resolved({
    format: "720p30",
    clips: [
      { id: "v1", kind: "video", source: "clipA", format: "720p30", in: 0, out: 4 },
      { id: "v2", kind: "video", source: "clipB", format: "720p30", in: 1, out: 3, speed: 2 },
    ],
    visual: [{ id: "a", use: "v1" }, { id: "b", use: "v2" }],
  });
  const ex = explainEdl(edl, resolve);
  assert.equal(ex.clips[0]!.start, 0);
  assert.equal(ex.clips[0]!.end, 4);
  assert.equal(ex.clips[1]!.duration, 1);
  assert.equal(ex.duration, 5);
});

test("lintEdl flags unknown sources and duplicate ids", () => {
  const edl = resolved({
    format: "720p30",
    clips: [
      { id: "v1", kind: "video", source: "clipA", format: "720p30", out: 2 },
      { id: "v2", kind: "video", source: "missing", format: "720p30", out: 2 },
    ],
    visual: [{ id: "x", use: "v1" }, { id: "x", use: "v2" }],
  });
  const issues = lintEdl(edl, resolve);
  assert.ok(issues.some((i) => i.message.includes("not found")));
  assert.ok(issues.some((i) => i.message.includes("Duplicate")));
});

test("lintEdl warns when a clip exceeds source duration", () => {
  const edl = resolved({
    format: "720p30",
    clips: [{ id: "v1", kind: "video", source: "clipB", format: "720p30", in: 0, out: 99 }],
    visual: [{ id: "v", use: "v1" }],
  });
  assert.ok(lintEdl(edl, resolve).some((i) => i.level === "warning" && i.message.includes("exceeds")));
});

test("lintEdl warns on a format mismatch with the output", () => {
  const edl = resolved({
    format: "1080p30",
    clips: [{ id: "v1", kind: "video", source: "clipA", format: "720p30", out: 4 }],
    visual: [{ id: "v", use: "v1" }],
  });
  assert.ok(lintEdl(edl, resolve).some((i) => i.message.includes("differs from output")));
});

test("buildRenderPlan builds concat and a text overlay", () => {
  const edl = resolved({
    format: "720p30",
    clips: [
      { id: "v1", kind: "video", source: "clipA", format: "720p30", in: 0, out: 4 },
      { id: "v2", kind: "video", source: "clipB", format: "720p30", in: 1, out: 3, speed: 2 },
    ],
    visual: [{ id: "a", use: "v1" }, { id: "b", use: "v2" }],
    overlays: [{ type: "text", text: "Hi there", start: 0.5, end: 3 }],
  });
  const plan = buildRenderPlan(edl, { root: "/tmp", resolveSource: resolve, ffmpeg: "ffmpeg", workDir: "/tmp/work" });
  assert.ok(plan.filter.includes("concat=n=2:v=1:a=0"));
  assert.ok(plan.filter.includes("ass=/tmp/work/overlays.ass"));
  assert.ok(plan.artifacts[0]!.content.includes("Hi there"));
  assert.equal(plan.duration, 5);
});

test("buildRenderPlan mixes attached video audio with an audio-track clip", () => {
  const edl = resolved({
    format: "720p30",
    clips: [
      { id: "v1", kind: "video", source: "clipA", format: "720p30", in: 0, out: 4 },
      { id: "m1", kind: "audio", source: "mu", format: "audio48k", out: 20 },
    ],
    visual: [{ id: "a", use: "v1" }],
    audio: [{ id: "m", use: "m1", offset: 1, gain_db: -6 }],
  });
  const plan = buildRenderPlan(edl, { root: "/tmp", resolveSource: resolve, ffmpeg: "ffmpeg", workDir: "/tmp/work" });
  assert.ok(plan.filter.includes("amix=inputs=2"));
  assert.ok(plan.filter.includes("adelay=1000|1000"));
  assert.ok(plan.filter.includes("loudnorm=I=-14"));
  const ai = plan.args.indexOf("-ar");
  assert.equal(plan.args[ai + 1], "48000");
});

test("muted video clips contribute no audio", () => {
  const edl = resolved({
    format: "720p30",
    clips: [{ id: "v1", kind: "video", source: "clipA", format: "720p30", out: 4, muted: true }],
    visual: [{ id: "a", use: "v1" }],
  });
  const plan = buildRenderPlan(edl, { root: "/tmp", resolveSource: resolve, ffmpeg: "ffmpeg", workDir: "/tmp/work" });
  assert.ok(plan.args.includes("-an"));
});

test("parseResolution and positionExpr helpers", () => {
  assert.deepEqual(parseResolution("1920x1080"), [1920, 1080]);
  assert.throws(() => parseResolution("nope"));
  assert.deepEqual(positionExpr("top-right", { w: "overlay_w", h: "overlay_h" }), {
    x: "main_w-overlay_w-20",
    y: "20",
  });
  assert.equal(clipDuration({ in: 0, out: 6, speed: 2 }), 3);
});

test("title clips render via color + libass", () => {
  const edl = resolved({
    format: "720p30",
    clips: [{ id: "t1", kind: "title", source: "generated", format: "720p30", title: "Case Design", subtitle: "A 3D session", duration: 2 }],
    visual: [{ id: "intro", use: "t1" }],
  });
  const ex = explainEdl(edl, resolve);
  assert.equal(ex.clips[0]!.kind, "title");
  assert.equal(ex.clips[0]!.duration, 2);
  const plan = buildRenderPlan(edl, { root: "/tmp", resolveSource: resolve, ffmpeg: "ffmpeg", workDir: "/tmp/work" });
  assert.ok(plan.filter.includes("color=c=0x101820:s=1280x720"));
  assert.ok(plan.filter.includes("ass=/tmp/work/title_0.ass"));
  assert.ok(plan.artifacts[0]!.content.includes("Case Design"));
});

test("slide clips render mono body via libass", () => {
  const edl = resolved({
    format: "720p30",
    clips: [{ id: "s1", kind: "slide", source: "generated", format: "720p30", heading: "loop()", body: "Joystick.setXAxis(1);", variant: "mono", duration: 4 }],
    visual: [{ id: "code", use: "s1" }],
  });
  const plan = buildRenderPlan(edl, { root: "/tmp", resolveSource: resolve, ffmpeg: "ffmpeg", workDir: "/tmp/work" });
  assert.ok(plan.filter.includes("color=c=0x0d1117:s=1280x720"));
  assert.ok(plan.artifacts[0]!.content.includes("Joystick.setXAxis"));
});

test("image clips loop with zoom crop", () => {
  const edl = resolved({
    format: "720p30",
    clips: [{ id: "g1", kind: "image", source: "shot", format: "720p30", duration: 6, fit: "contain", zoom: { x: 0.1, y: 0.2, w: 0.8, h: 0.5 } }],
    visual: [{ id: "gist", use: "g1" }],
  });
  const plan = buildRenderPlan(edl, { root: "/tmp", resolveSource: resolve, ffmpeg: "ffmpeg", workDir: "/tmp/work" });
  const input = plan.inputs.find((i) => i.path === "/tmp/shot.png");
  assert.deepEqual(input?.options, ["-loop", "1", "-t", "6"]);
  assert.ok(plan.filter.includes("crop=iw*0.8:ih*0.5:iw*0.1:ih*0.2"));
  assert.ok(plan.filter.includes("pad=1280:720"));
});

test("ass helpers format time, colours and events", () => {
  assert.equal(assTime(3.5), "0:00:03.50");
  assert.equal(assTime(61.25), "0:01:01.25");
  assert.equal(toAssColor("white"), "&H00FFFFFF");
  assert.equal(toAssColor("#FF0000"), "&H000000FF");
  assert.equal(toAssColor("&H00AABBCC"), "&H00AABBCC");
  const ass = buildAss([{ start: 0, end: 1, text: "a:b", position: "bottom" }], { width: 640, height: 480 });
  assert.ok(ass.includes("PlayResX: 640"));
  assert.ok(ass.includes("a:b"));
});

test("toAssColor handles 8-digit CSS hex with inverted alpha", () => {
  assert.equal(toAssColor("#000000cc"), "&H33000000");
  assert.equal(toAssColor("#ff000080"), "&H7F0000FF");
});

test("buildTitleAss centres title and subtitle", () => {
  const ass = buildTitleAss({ width: 1280, height: 720, title: "Chapter 1", subtitle: "Intro", duration: 3 });
  assert.ok(ass.includes("PlayResX: 1280"));
  assert.ok(ass.includes("Chapter 1"));
});

test("buildSlideAss uses a monospace body for mono slides", () => {
  const ass = buildSlideAss({ width: 1280, height: 720, heading: "setup()", body: "pinMode(2, INPUT);", kind: "mono" });
  assert.ok(ass.includes("DejaVu Sans Mono"));
  assert.ok(ass.includes("setup()"));
});
