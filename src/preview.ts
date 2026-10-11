import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execa } from "execa";
import type { Paths } from "./config.js";
import type { Manifest } from "./schemas/manifest.js";
import { CaptionsSchema, OutputSchema } from "./schemas/edl.js";
import { audioClipDuration, type ResolvedEdl, type ResolvedItem } from "./edl.js";
import { buildRenderPlan } from "./render.js";
import { makeSourceResolver } from "./manifest.js";
import { clipDuration } from "./av.js";
import type { AudioClip, Clip } from "./schemas/clips.js";

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
  // A non-empty preview is a cache hit; a zero-byte file (e.g. left by an
  // interrupted render) is not — re-render it.
  if (!opts.force && existsSync(out) && statSync(out).size > 0) return { path: out, cached: true };

  // Render to a temp file (keeping the extension, so ffmpeg can infer the
  // muxer) and rename on success — a killed render can't leave a partial result.
  const tmp = out.replace(/(\.[^./]+)$/, ".part$1");
  const isAudio = clip.kind === "audio";
  const item: ResolvedItem = isAudio
    ? {
        kind: "audio",
        id: "preview",
        clip: clip as AudioClip,
        trackId: "a1",
        start: 0,
        duration: audioClipDuration(clip as AudioClip),
        gain_db: (clip as AudioClip).gain_db,
      }
    : {
        kind: "video",
        id: "preview",
        clip,
        trackId: "v1",
        start: 0,
        duration: clip.kind === "video" ? clipDuration({ in: clip.in, out: clip.out, speed: clip.speed }) : clip.duration,
        speed: clip.kind === "video" ? clip.speed : 1,
        position: "center",
        opacity: 1,
      };
  const edl: ResolvedEdl = {
    output: OutputSchema.parse({ format: clip.format, path: tmp }),
    tracks: [{ id: isAudio ? "a1" : "v1", kind: isAudio ? "audio" : "video", items: [item] }],
    captions: CaptionsSchema.parse({}),
  };
  const plan = buildRenderPlan(edl, {
    root: paths.root,
    resolveSource: makeSourceResolver(paths, opts.manifest),
    ffmpeg,
    workDir: paths.workDir,
    outputOverride: tmp,
  });

  await mkdir(dirname(out), { recursive: true });
  for (const artifact of plan.artifacts) {
    await mkdir(dirname(artifact.path), { recursive: true });
    await writeFile(artifact.path, artifact.content, "utf8");
  }
  const res = await execa(ffmpeg, plan.args, { reject: false, cwd: paths.root });
  if (res.exitCode !== 0) {
    await rm(tmp, { force: true });
    throw new Error(res.stderr || `ffmpeg exited ${res.exitCode}`);
  }
  await rename(tmp, out);
  return { path: out, cached: false };
}
