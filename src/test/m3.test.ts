import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cuesFromTiming,
  splitIntoCues,
  toSrt,
  toVtt,
  wrapText,
} from "../captions.js";
import { loadEdlFromString } from "../edl.js";
import { buildRenderPlan } from "../render.js";

test("wrapText wraps greedily at max chars", () => {
  const out = wrapText("one two three four five", 9);
  assert.deepEqual(out.split("\n"), ["one two", "three", "four five"]);
});

test("splitIntoCues divides time proportionally to text length", () => {
  const text = "aaaa bbbb cccc dddd"; // 19 chars
  const cues = splitIntoCues(text, 0, 10, 10, 100);
  assert.equal(cues.length, 2);
  assert.equal(cues[0]!.start, 0);
  assert.equal(cues[cues.length - 1]!.end, 10);
  assert.ok(cues[0]!.end > 0 && cues[0]!.end < 10);
});

test("cuesFromTiming maps each segment", () => {
  const cues = cuesFromTiming([{ text: "hello world", start: 1, end: 3 }]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]!.start, 1);
  assert.equal(cues[0]!.end, 3);
});

test("toSrt and toVtt format cues", () => {
  const cues = [{ start: 1.5, end: 3.25, text: "hi" }];
  const srt = toSrt(cues);
  assert.ok(srt.startsWith("1\n00:00:01,500 --> 00:00:03,250\nhi"));
  const vtt = toVtt(cues);
  assert.ok(vtt.startsWith("WEBVTT\n\n00:00:01.500 --> 00:00:03.250\nhi"));
});

const baseEdl = (captions: string) => `schema: vided.edl/1
timeline:
  - { id: a, source: clipA, out: 4 }
${captions}
`;

const resolver = (s: string) =>
  ({
    clipA: { path: "/tmp/a.mp4", kind: "video", duration: 10 },
    "work/captions.ass": { path: "/tmp/work/captions.ass" },
  })[s];

test("buildRenderPlan burns captions with the ass filter", () => {
  const { edl } = loadEdlFromString(
    baseEdl("captions:\n  mode: burn\n  file: work/captions.ass\n"),
  );
  const plan = buildRenderPlan(edl!, {
    root: "/tmp",
    resolveSource: resolver,
    ffmpeg: "ffmpeg",
  });
  assert.ok(plan.filter.includes("ass=/tmp/work/captions.ass"));
  assert.ok(plan.filter.endsWith("[vfinal]"));
});

test("buildRenderPlan muxes soft captions as mov_text", () => {
  const { edl } = loadEdlFromString(
    baseEdl("captions:\n  mode: soft\n  file: work/captions.ass\n"),
  );
  const plan = buildRenderPlan(edl!, {
    root: "/tmp",
    resolveSource: resolver,
    ffmpeg: "ffmpeg",
  });
  assert.ok(plan.args.includes("mov_text"));
  assert.ok(plan.args.some((a) => a.endsWith(":s")));
  assert.ok(plan.args.includes("default"));
});
