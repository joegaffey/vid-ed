import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execa } from "execa";
import type { Paths } from "./config.js";
import type { Manifest } from "./schemas/manifest.js";
import { CaptionsSchema, OutputSchema } from "./schemas/edl.js";
import type { ResolvedEdl } from "./edl.js";
import { buildRenderPlan } from "./render.js";
import { makeSourceResolver } from "./manifest.js";
import type { Clip } from "./schemas/clips.js";

/** Content hash of a clip definition — the preview cache key. */
export function clipHash(clip: Clip): string {
  return createHash("sha256").update(JSON.stringify(clip)).digest("hex").slice(0, 16);
}

export function previewPath(paths: Paths, clip: Clip): string {
  return join(paths.cacheDir, "preview", clipHash(clip) + ".mp4");
}

export interface PreviewResult {
  path: string;
  cached: boolean;
}

/** Render a single clip at its own declared format, cached by clip hash. */
export async function renderClipPreview(opts: {
  paths: Paths;
  manifest?: Manifest;
  ffmpeg: string;
  clip: Clip;
  force?: boolean;
}): Promise<PreviewResult> {
  const { paths, ffmpeg, clip } = opts;
  const out = previewPath(paths, clip);
  if (!opts.force && existsSync(out)) return { path: out, cached: true };

  const edl: ResolvedEdl = {
    output: OutputSchema.parse({ format: clip.format, path: out }),
    visual: [{ id: "preview", clip, speed: clip.kind === "video" ? clip.speed : 1 }],
    audio: [],
    captions: CaptionsSchema.parse({}),
    overlays: [],
  };
  const plan = buildRenderPlan(edl, {
    root: paths.root,
    resolveSource: makeSourceResolver(paths, opts.manifest),
    ffmpeg,
    workDir: paths.workDir,
    outputOverride: out,
  });

  await mkdir(dirname(out), { recursive: true });
  for (const artifact of plan.artifacts) {
    await mkdir(dirname(artifact.path), { recursive: true });
    await writeFile(artifact.path, artifact.content, "utf8");
  }
  const res = await execa(ffmpeg, plan.args, { reject: false, cwd: paths.root });
  if (res.exitCode !== 0) {
    await rm(out, { force: true });
    throw new Error(res.stderr || `ffmpeg exited ${res.exitCode}`);
  }
  return { path: out, cached: false };
}
