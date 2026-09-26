import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cuesFromTiming,
  splitIntoCues,
  toSrt,
  toVtt,
  wrapText,
} from "../captions.js";
import { buildRenderPlan } from "../render.js";
import { resolved } from "./fixtures.js";

test("wrapText wraps greedily at max chars", () => {
  const out = wrapText("one two three four five", 9);
  assert.deepEqual(out.split("\n"), ["one two", "three", "four five"]);
});

test("splitIntoCues divides time proportionally to text length", () => {
  const text = "aaaa bbbb cccc dddd";
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

const resolver = (s: string) =>
  ({
    clipA: { path: "/tmp/a.mp4", kind: "video", duration: 10 },
    "work/captions.ass": { path: "/tmp/work/captions.ass" },
  })[s];

const baseEdl = (mode: string) =>
  resolved({
    format: "720p30",
    clips: [{ id: "v1", kind: "video", source: "clipA", format: "720p30", out: 4 }],
    visual: [{ id: "a", use: "v1" }],
    captions: { mode, file: "work/captions.ass" },
  });

test("buildRenderPlan burns captions with the ass filter", () => {
  const plan = buildRenderPlan(baseEdl("burn"), {
    root: "/tmp",
    resolveSource: resolver,
    ffmpeg: "ffmpeg",
  });
  assert.ok(plan.filter.includes("ass=/tmp/work/captions.ass"));
  assert.ok(plan.filter.includes("[vfinal]"));
});

test("buildRenderPlan muxes soft captions as mov_text", () => {
  const plan = buildRenderPlan(baseEdl("soft"), {
    root: "/tmp",
    resolveSource: resolver,
    ffmpeg: "ffmpeg",
  });
  assert.ok(plan.args.includes("mov_text"));
  assert.ok(plan.args.some((a) => a.endsWith(":s")));
  assert.ok(plan.args.includes("default"));
});
