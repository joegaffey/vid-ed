import assert from "node:assert/strict";
import { test } from "node:test";
import { hammingDistance } from "../hash.js";
import { clusterFrames, dedupeFrames, applyBudget, densityBudget } from "../dedupe.js";
import { buildCuts, fpsFlagForMajor, mergeFrames, sceneOf } from "../frames.js";
import { parseWhisperJson } from "../text.js";

test("hammingDistance counts differing bits", () => {
  assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistance("0000000000000000", "0000000000000001"), 1);
  assert.equal(hammingDistance("ffffffffffffffff", "0000000000000000"), 64);
});

test("clusterFrames groups near-identical hashes", () => {
  const frames = [
    { t: 0, phash: "0000000000000000" },
    { t: 1, phash: "0000000000000001" },
    { t: 2, phash: "ffffffffffffffff" },
  ];
  const groups = clusterFrames(frames, 2);
  assert.equal(groups.length, 2);
  const sizes = groups.map((g) => g.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

test("dedupeFrames keeps one representative per cluster and applyBudget caps", () => {
  const frames = [
    { t: 0, phash: "0000000000000000" },
    { t: 1, phash: "0000000000000000" },
    { t: 2, phash: "ffffffffffffffff" },
    { t: 3, phash: "fffffffffffffffe" },
  ];
  const { representatives } = dedupeFrames(frames, 1);
  assert.deepEqual(representatives, [0, 2]);
  assert.deepEqual(applyBudget(representatives, 1), [0]);
});

test("applyBudget spreads selections across the timeline", () => {
  const reps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.deepEqual(applyBudget(reps, 3), [0, 5, 9]);
  assert.deepEqual(applyBudget(reps, 10), reps);
  assert.deepEqual(applyBudget(reps, 0), []);
});

test("densityBudget scales with duration and clamps", () => {
  const cfg = { target_frames_per_minute: 6, min_frames_per_asset: 2, max_frames_per_asset: 60 };
  assert.equal(densityBudget(30, cfg), 3); // 0.5 min * 6
  assert.equal(densityBudget(467, cfg), 47); // ~7.8 min * 6
  assert.equal(densityBudget(5, cfg), 2); // clamped up to min
  assert.equal(densityBudget(3600, cfg), 60); // clamped down to max
});

test("parseWhisperJson maps offsets and tokens to words", () => {
  const json = JSON.stringify({
    result: { language: "en" },
    transcription: [
      {
        offsets: { from: 0, to: 3200 },
        text: " Welcome to the demo.",
        tokens: [
          { text: " Wel", offsets: { from: 0, to: 500 } },
          { text: "come", offsets: { from: 500, to: 900 } },
          { text: " to", offsets: { from: 900, to: 1200 } },
        ],
      },
      { offsets: { from: 3200, to: 4000 }, text: "[BLANK_AUDIO]" },
    ],
  });
  const t = parseWhisperJson(json);
  assert.equal(t.language, "en");
  assert.equal(t.segments.length, 1);
  assert.equal(t.segments[0]!.start, 0);
  assert.equal(t.segments[0]!.end, 3.2);
  assert.deepEqual(
    t.segments[0]!.words?.map((w) => w.w),
    ["Welcome", "to"],
  );
});

test("buildCuts and sceneOf segment a timeline", () => {
  const cuts = buildCuts([0, 5, 10], 12);
  assert.deepEqual(cuts, [0, 5, 10, 12]);
  const scenes = cuts.slice(0, -1).map((start, i) => ({ id: `s${i}`, start, end: cuts[i + 1]! }));
  assert.equal(sceneOf(scenes, 6), "s1");
  assert.equal(sceneOf(scenes, 11.9), "s2");
});

test("mergeFrames drops uniform frames near scene cuts, preferring scene", () => {
  const scene = [{ t: 5, path: "s5.webp" }];
  const uniform = [
    { t: 0, path: "u0.webp" },
    { t: 5.2, path: "u5.webp" },
    { t: 10, path: "u10.webp" },
  ];
  const merged = mergeFrames(scene, uniform, 0.5);
  assert.deepEqual(
    merged.map((f) => f.path),
    ["u0.webp", "s5.webp", "u10.webp"],
  );
});

test("fpsFlagForMajor picks a flag compatible with the ffmpeg version", () => {
  assert.deepEqual(fpsFlagForMajor(7), ["-fps_mode", "vfr"]);
  assert.deepEqual(fpsFlagForMajor(5), ["-fps_mode", "vfr"]);
  assert.deepEqual(fpsFlagForMajor(4), ["-vsync", "vfr"]);
  assert.deepEqual(fpsFlagForMajor(undefined), ["-vsync", "vfr"]);
});
