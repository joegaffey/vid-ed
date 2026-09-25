import assert from "node:assert/strict";
import { test } from "node:test";
import { assTime, buildAss, buildSlideAss, buildTitleAss, toAssColor } from "../captions.js";
import { explainEdl, lintEdl, loadEdlFromString } from "../edl.js";
import { buildRenderPlan, clipDuration, parseResolution, positionExpr } from "../render.js";

const EDL = `schema: vided.edl/1
output:
  resolution: 640x480
  fps: 15
timeline:
  - id: a
    source: clipA
    in: 0
    out: 4
  - id: b
    source: clipB
    in: 1
    out: 3
    speed: 2
overlays:
  - type: text
    text: "Hi there"
    start: 0.5
    end: 3
`;

const sources: Record<string, { path: string; kind?: string; duration?: number }> = {
  clipA: { path: "/tmp/a.mp4", kind: "video", duration: 10 },
  clipB: { path: "/tmp/b.mp4", kind: "video", duration: 5 },
  img: { path: "/tmp/i.png", kind: "image" },
};
const resolve = (s: string) => sources[s];

test("loadEdlFromString validates and applies defaults", () => {
  const r = loadEdlFromString(EDL);
  assert.equal(r.ok, true);
  assert.equal(r.edl!.output.resolution, "640x480");
  const first = r.edl!.timeline[0]!;
  assert.ok(!("title" in first) && !("slide" in first) && !("image" in first));
  assert.equal(first.speed, 1);
});

test("loadEdlFromString reports schema errors", () => {
  const r = loadEdlFromString("schema: vided.edl/1\ntimeline: []\n");
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test("explainEdl accumulates timeline positions with speed", () => {
  const { edl } = loadEdlFromString(EDL);
  const ex = explainEdl(edl!, resolve);
  assert.equal(ex.clips[0]!.start, 0);
  assert.equal(ex.clips[0]!.end, 4);
  assert.equal(ex.clips[1]!.duration, 1);
  assert.equal(ex.duration, 5);
  assert.equal(ex.overlays.total, 1);
});

test("lintEdl flags unknown sources and duplicate ids", () => {
  const { edl } = loadEdlFromString(`schema: vided.edl/1
timeline:
  - { id: x, source: missing, out: 2 }
  - { id: x, source: clipA, out: 2 }
`);
  const issues = lintEdl(edl!, resolve);
  assert.ok(issues.some((i) => i.message.includes("not found")));
  assert.ok(issues.some((i) => i.message.includes("Duplicate")));
});

test("lintEdl warns when clip exceeds source duration", () => {
  const { edl } = loadEdlFromString(`schema: vided.edl/1
timeline:
  - { id: x, source: clipB, in: 0, out: 99 }
`);
  const issues = lintEdl(edl!, resolve);
  assert.ok(issues.some((i) => i.level === "warning" && i.message.includes("exceeds")));
});

test("buildRenderPlan builds concat, overlay ass and audio graph", () => {
  const { edl } = loadEdlFromString(`${EDL}
audio:
  voiceover: { source: vo, start: 0.5 }
  music: { source: mu, gain_db: -20, duck_under_voiceover: true, loop: true }
`);
  const plan = buildRenderPlan(edl!, {
    root: "/tmp",
    resolveSource: (s) =>
      ({ vo: { path: "/tmp/vo.wav" }, mu: { path: "/tmp/mu.mp3" } })[s] ?? resolve(s),
    ffmpeg: "ffmpeg",
    workDir: "/tmp/work",
  });
  assert.ok(plan.filter.includes("concat=n=2:v=1:a=0"));
  assert.ok(plan.filter.includes("ass=/tmp/work/overlays.ass"));
  assert.ok(plan.filter.includes("sidechaincompress"));
  assert.equal(plan.artifacts.length, 1);
  assert.ok(plan.artifacts[0]!.content.includes("Hi there"));
  assert.ok(plan.args.includes("-map"));
  assert.equal(plan.duration, 5);
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

test("ass helpers format time, colours and events", () => {
  assert.equal(assTime(3.5), "0:00:03.50");
  assert.equal(assTime(61.25), "0:01:01.25");
  assert.equal(toAssColor("white"), "&H00FFFFFF");
  assert.equal(toAssColor("#FF0000"), "&H000000FF");
  assert.equal(toAssColor("&H00AABBCC"), "&H00AABBCC");
  const ass = buildAss([{ start: 0, end: 1, text: "a:b", position: "bottom" }], {
    width: 640,
    height: 480,
  });
  assert.ok(ass.includes("PlayResX: 640"));
  assert.ok(ass.includes("a:b"));
});

test("toAssColor handles 8-digit CSS hex with inverted alpha", () => {
  assert.equal(toAssColor("#000000cc"), "&H33000000");
  assert.equal(toAssColor("#ff000080"), "&H7F0000FF");
});

test("buildAss leaves default overlays unchanged", () => {
  const ass = buildAss([{ start: 0, end: 1, text: "hi", position: "bottom" }], {
    width: 640,
    height: 480,
  });
  assert.equal((ass.match(/^Style: /gm) ?? []).length, 1);
  assert.ok(
    ass.includes(
      "Style: Default,DejaVu Sans,42,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,64,1",
    ),
  );
});

test("buildAss renders a background box (BorderStyle=3) when box is true", () => {
  const ass = buildAss(
    [
      {
        start: 0,
        end: 5,
        text: "Without a tool, the graph renders EMPTY",
        position: "bottom",
        box: true,
        boxColor: "#000000cc",
        outline: 0,
      },
    ],
    { width: 640, height: 480 },
  );
  // box colour (alpha inverted) and BorderStyle=3 with a visible min padding
  assert.ok(ass.includes("&H33000000"));
  assert.ok(ass.includes(",3,8,1,"));
  assert.equal((ass.match(/^Style: /gm) ?? []).length, 2);
});

test("buildRenderPlan emits boxed overlay ASS", () => {
  const { edl } = loadEdlFromString(`schema: vided.edl/1
timeline:
  - { id: a, source: clipA, out: 4 }
overlays:
  - type: text
    text: "Renders EMPTY"
    start: 0
    end: 3
    position: bottom
    style: { size: 44, color: "#ffffff", box: true, box_color: "#000000cc", outline: 0 }
`);
  const plan = buildRenderPlan(edl!, {
    root: "/tmp",
    resolveSource: resolve,
    ffmpeg: "ffmpeg",
    workDir: "/tmp/work",
  });
  assert.equal(plan.artifacts.length, 1);
  assert.ok(plan.artifacts[0]!.content.includes(",3,8,1,"));
  assert.ok(plan.artifacts[0]!.content.includes("&H33000000"));
});

const TITLE_EDL = `schema: vided.edl/1
output:
  resolution: 640x480
timeline:
  - id: intro
    title: "Case Design"
    subtitle: "A 3D session"
    duration: 2
  - id: a
    source: clipA
    out: 4
`;

test("title cards are timeline items with duration and no source", () => {
  const { edl } = loadEdlFromString(TITLE_EDL);
  const ex = explainEdl(edl!, resolve);
  assert.equal(ex.clips[0]!.type, "title");
  assert.equal(ex.clips[0]!.title, "Case Design");
  assert.equal(ex.clips[0]!.duration, 2);
  assert.equal(ex.clips[1]!.start, 2);
  assert.equal(ex.duration, 6);
});

test("lintEdl flags an empty title", () => {
  const { edl } = loadEdlFromString(`schema: vided.edl/1
timeline:
  - { id: t, title: "  ", duration: 2 }
`);
  assert.ok(lintEdl(edl!, resolve).some((i) => i.message.includes("empty title")));
});

test("buildRenderPlan renders a title card via color + libass", () => {
  const { edl } = loadEdlFromString(TITLE_EDL);
  const plan = buildRenderPlan(edl!, {
    root: "/tmp",
    resolveSource: resolve,
    ffmpeg: "ffmpeg",
    workDir: "/tmp/work",
  });
  assert.ok(plan.filter.includes("color=c=0x101820:s=640x480"));
  assert.ok(plan.filter.includes("ass=/tmp/work/title_0.ass"));
  assert.equal(plan.inputs.length, 1); // only the clip adds an input
  assert.equal(plan.duration, 6);
  assert.equal(plan.artifacts.length, 1);
  assert.ok(plan.artifacts[0]!.content.includes("Case Design"));
});

test("buildTitleAss centres title and subtitle", () => {
  const ass = buildTitleAss({
    width: 1280,
    height: 720,
    title: "Chapter 1",
    subtitle: "Intro",
    duration: 3,
  });
  assert.ok(ass.includes("PlayResX: 1280"));
  assert.ok(ass.includes("Chapter 1"));
  assert.ok(ass.includes("Intro"));
  assert.ok(ass.includes("{\\an5"));
});

const SLIDE_EDL = `schema: vided.edl/1
output:
  resolution: 1280x720
timeline:
  - id: code
    slide: "loop()"
    body: |
      void loop() {
        Joystick.setXAxis(SteeringValue);
      }
    kind: mono
    duration: 4
  - id: a
    source: clipA
    out: 4
`;

test("slides are timeline items with duration and no source", () => {
  const { edl } = loadEdlFromString(SLIDE_EDL);
  const ex = explainEdl(edl!, resolve);
  assert.equal(ex.clips[0]!.type, "slide");
  assert.equal(ex.clips[0]!.title, "loop()");
  assert.equal(ex.clips[1]!.start, 4);
  assert.equal(ex.duration, 8);
});

test("lintEdl flags an empty slide heading", () => {
  const { edl } = loadEdlFromString(`schema: vided.edl/1
timeline:
  - { id: s, slide: "  ", duration: 2 }
`);
  assert.ok(lintEdl(edl!, resolve).some((i) => i.message.includes("empty heading")));
});

test("buildRenderPlan renders a code slide via color + libass", () => {
  const { edl } = loadEdlFromString(SLIDE_EDL);
  const plan = buildRenderPlan(edl!, {
    root: "/tmp",
    resolveSource: resolve,
    ffmpeg: "ffmpeg",
    workDir: "/tmp/work",
  });
  assert.ok(plan.filter.includes("color=c=0x0d1117:s=1280x720"));
  assert.ok(plan.filter.includes("ass=/tmp/work/slide_0.ass"));
  assert.equal(plan.artifacts.length, 1);
  assert.ok(plan.artifacts[0]!.content.includes("Joystick.setXAxis"));
});

test("buildSlideAss uses a monospace body for mono slides", () => {
  const ass = buildSlideAss({
    width: 1280,
    height: 720,
    heading: "setup()",
    body: "pinMode(2, INPUT);",
    kind: "mono",
  });
  assert.ok(ass.includes("DejaVu Sans Mono"));
  assert.ok(ass.includes("setup()"));
  assert.ok(ass.includes("pinMode(2, INPUT);"));
});

test("slide kind accepts `code` as an alias for `mono`", () => {
  const { edl } = loadEdlFromString(`schema: vided.edl/1
timeline:
  - { id: s, slide: "x", kind: code, duration: 2 }
`);
  const item = edl!.timeline[0]!;
  assert.ok("slide" in item);
  assert.equal(item.kind, "mono");
});

const STILL_EDL = `schema: vided.edl/1
output:
  resolution: 1280x720
timeline:
  - id: gist
    image: shot.png
    duration: 6
    fit: contain
    zoom: { x: 0.1, y: 0.2, w: 0.8, h: 0.5 }
  - id: a
    source: clipA
    out: 4
`;

test("stills are timeline items held for a duration", () => {
  const { edl } = loadEdlFromString(STILL_EDL);
  const ex = explainEdl(edl!, (s) =>
    s === "clipA" ? { path: "/tmp/a.mp4", kind: "video" } : undefined,
  );
  assert.equal(ex.clips[0]!.type, "still");
  assert.equal(ex.clips[0]!.duration, 6);
  assert.equal(ex.clips[1]!.start, 6);
  assert.equal(ex.duration, 10);
});

test("buildRenderPlan loops a still image and supports zoom crop", () => {
  const { edl } = loadEdlFromString(STILL_EDL);
  const plan = buildRenderPlan(edl!, {
    root: "/tmp",
    resolveSource: (s) =>
      s === "shot.png" ? { path: "/tmp/shot.png", kind: "image" } : resolve(s),
    ffmpeg: "ffmpeg",
    workDir: "/tmp/work",
  });
  const stillInput = plan.inputs.find((inp) => inp.path === "/tmp/shot.png");
  assert.deepEqual(stillInput?.options, ["-loop", "1", "-t", "6"]);
  assert.ok(plan.filter.includes("crop=iw*0.8:ih*0.5:iw*0.1:ih*0.2"));
  assert.ok(plan.filter.includes("pad=1280:720"));
});

test("lintEdl flags a missing still image", () => {
  const { edl } = loadEdlFromString(`schema: vided.edl/1
timeline:
  - { id: s, image: nope.png, duration: 3 }
`);
  const issues = lintEdl(edl!, () => undefined);
  assert.ok(issues.some((i) => i.message.includes("not found")));
});
