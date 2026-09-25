import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import type { Config } from "./config.js";
import { requireTool } from "./tools/resolve.js";

export interface RawFrame {
  t: number;
  path: string;
}

const SHOWINFO_PTS = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;

function scaleFilter(maxWidth: number): string {
  return `scale=w='min(iw,${maxWidth})':h=-1`;
}

export async function sceneFrames(
  config: Config,
  input: string,
  outDir: string,
  threshold: number,
  maxWidth: number,
): Promise<RawFrame[]> {
  const ffmpeg = await requireTool(config, "ffmpeg");
  await mkdir(outDir, { recursive: true });
  const pattern = join(outDir, "scene_%05d.jpg");
  const { stderr } = await execa(
    ffmpeg,
    [
      "-y", "-i", input,
      "-vf", `select='gt(scene,${threshold})',${scaleFilter(maxWidth)},showinfo`,
      "-fps_mode", "vfr",
      pattern,
    ],
    { reject: false },
  );

  const times: number[] = [];
  for (const m of stderr.matchAll(SHOWINFO_PTS)) times.push(Number(m[1]));

  const files = (await readdir(outDir))
    .filter((f) => f.startsWith("scene_") && f.endsWith(".jpg"))
    .sort();
  return files.map((f, i) => ({ t: times[i] ?? 0, path: join(outDir, f) }));
}

export async function frameAt(
  config: Config,
  input: string,
  t: number,
  outPath: string,
  maxWidth: number,
): Promise<RawFrame | undefined> {
  const ffmpeg = await requireTool(config, "ffmpeg");
  await mkdir(outPath.replace(/\/[^/]+$/, ""), { recursive: true });
  const res = await execa(
    ffmpeg,
    [
      "-y",
      "-ss", String(t),
      "-i", input,
      "-frames:v", "1",
      "-vf", scaleFilter(maxWidth),
      outPath,
    ],
    { reject: false },
  );
  if (res.exitCode !== 0) return undefined;
  return { t, path: outPath };
}

/** Extract one frame every `interval` seconds in a single ffmpeg pass. */
export async function uniformFrames(
  config: Config,
  input: string,
  outDir: string,
  interval: number,
  maxWidth: number,
): Promise<RawFrame[]> {
  const ffmpeg = await requireTool(config, "ffmpeg");
  await mkdir(outDir, { recursive: true });
  const pattern = join(outDir, "u_%05d.jpg");
  const { stderr } = await execa(
    ffmpeg,
    [
      "-y", "-i", input,
      "-vf", `fps=1/${interval},${scaleFilter(maxWidth)},showinfo`,
      "-fps_mode", "vfr",
      pattern,
    ],
    { reject: false },
  );
  const times: number[] = [];
  for (const m of stderr.matchAll(SHOWINFO_PTS)) times.push(Number(m[1]));
  const files = (await readdir(outDir))
    .filter((f) => f.startsWith("u_") && f.endsWith(".jpg"))
    .sort();
  return files.map((f, i) => ({ t: times[i] ?? i * interval, path: join(outDir, f) }));
}

export interface SampleResult {
  scenes: Array<{ id: string; start: number; end: number }>;
  frames: RawFrame[];
}

export async function sampleVideo(
  config: Config,
  input: string,
  outDir: string,
  durationS: number,
  opts: { threshold: number; everyS?: number; maxWidth: number },
): Promise<SampleResult> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const scene = await sceneFrames(config, input, outDir, opts.threshold, opts.maxWidth);

  const interval = opts.everyS;
  let uniform: RawFrame[] = [];
  if (interval && interval > 0) {
    uniform = await uniformFrames(config, input, outDir, interval, opts.maxWidth);
  } else if (durationS > 0) {
    const f = await frameAt(config, input, 0, join(outDir, "u_00000000.jpg"), opts.maxWidth);
    if (f) uniform.push(f);
  }

  const merged = mergeFrames(scene, uniform, 0.5);
  const cuts = buildCuts(scene.map((f) => f.t), durationS);
  const scenes = cuts.slice(0, -1).map((start, i) => ({
    id: `s${i}`,
    start,
    end: cuts[i + 1]!,
  }));

  return { scenes, frames: merged };
}

export function mergeFrames(scene: RawFrame[], uniform: RawFrame[], minGap: number): RawFrame[] {
  const all = [...scene, ...uniform].sort((a, b) => a.t - b.t);
  const out: RawFrame[] = [];
  for (const f of all) {
    const last = out[out.length - 1];
    if (last && Math.abs(f.t - last.t) < minGap) {
      if (scene.includes(f) && !scene.includes(last)) out[out.length - 1] = f;
      continue;
    }
    out.push(f);
  }
  return out;
}

export function buildCuts(sceneTimes: number[], durationS: number): number[] {
  const cuts = [0, ...sceneTimes.filter((t) => t > 0).sort((a, b) => a - b)];
  if (durationS > 0 && cuts[cuts.length - 1]! < durationS) cuts.push(durationS);
  return [...new Set(cuts)];
}

export function sceneOf(scenes: Array<{ id: string; start: number; end: number }>, t: number): string | undefined {
  return scenes.find((s) => t >= s.start && t < s.end)?.id ?? scenes[scenes.length - 1]?.id;
}
