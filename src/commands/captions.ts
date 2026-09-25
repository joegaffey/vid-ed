import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { projectPaths } from "../config.js";
import { readManifest } from "../manifest.js";
import {
  buildAssFromCues,
  cuesFromTiming,
  toSrt,
  toVtt,
  type Cue,
} from "../captions.js";
import { NarrationTimingSchema } from "../schemas/narration.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface CaptionsOptions extends OutputOptions {
  dir: string;
  from: "narration" | "transcript";
  asset?: string;
  timing?: string;
  formats: string[];
  out?: string;
  width?: number;
  height?: number;
}

export async function cmdCaptions(opts: CaptionsOptions): Promise<void> {
  const paths = projectPaths(opts.dir);

  let cues: Cue[];
  if (opts.from === "narration") {
    const timingPath = opts.timing
      ? resolveMaybe(paths.root, opts.timing)
      : join(paths.root, "work", "narration.timing.json");
    const raw = await readFile(timingPath, "utf8").catch(() => null);
    if (raw === null) fail(`Cannot read narration timing ${timingPath}. Run \`vided tts\` first.`);
    const timing = NarrationTimingSchema.parse(JSON.parse(raw));
    cues = cuesFromTiming(timing.segments);
  } else {
    const manifest = await readManifest(paths);
    if (!manifest) fail("No manifest found. Run `vided scan` first.");
    const asset = opts.asset
      ? manifest.assets.find((a) => a.id === opts.asset)
      : manifest.assets.find((a) => a.extracted.transcript?.segments.length);
    if (!asset) fail("No asset with a transcript found. Run `vided extract-text` first.");
    if (!asset.extracted.transcript) fail(`Asset ${asset.id} has no transcript.`);
    cues = cuesFromTiming(asset.extracted.transcript.segments);
  }

  const outBase = opts.out
    ? resolveMaybe(paths.root, opts.out)
    : join(paths.root, "work", "captions");
  const formats = opts.formats.length ? opts.formats : ["srt", "vtt"];
  const written: Record<string, string> = {};

  for (const format of formats) {
    const path = `${outBase}.${format}`;
    await mkdir(dirname(path), { recursive: true });
    let content: string;
    if (format === "srt") content = toSrt(cues);
    else if (format === "vtt") content = toVtt(cues);
    else if (format === "ass") {
      content = buildAssFromCues(cues, {
        width: opts.width ?? 1920,
        height: opts.height ?? 1080,
      });
    } else {
      fail(`Unsupported caption format "${format}".`);
    }
    await writeFile(path, content, "utf8");
    written[format] = path;
  }

  emit(
    { ok: true, cues: cues.length, files: written },
    () => `Wrote ${cues.length} cues -> ${Object.values(written).join(", ")}`,
    opts,
  );
}

function resolveMaybe(root: string, p: string): string {
  return isAbsolute(p) ? p : join(root, p);
}
