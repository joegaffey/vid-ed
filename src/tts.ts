import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { execa } from "execa";
import { Cache, cacheKey } from "./cache.js";
import type { Config, Paths } from "./config.js";
import { requireTool } from "./tools/resolve.js";
import type { NarrationScript, NarrationTiming, TimingSegment } from "./schemas/narration.js";
import { TIMING_VERSION } from "./schemas/narration.js";

export function resolvePiperModel(paths: Paths, config: Config, voice?: string): string {
  if (voice && (isAbsolute(voice) || voice.endsWith(".onnx"))) {
    const p = isAbsolute(voice) ? voice : join(paths.root, voice);
    if (existsSync(p)) return p;
  }
  const name = voice ?? config.tts.voice;
  if (!name) {
    throw new Error("No TTS voice configured. Set tts.voice in config or pass --voice.");
  }
  const p = join(paths.modelsDir, "piper", `${name}.onnx`);
  if (!existsSync(p)) {
    throw new Error(
      `Piper model not found at ${p}. Download the voice (e.g. ` +
        `${name}.onnx + ${name}.onnx.json) into .vided/models/piper/.`,
    );
  }
  return p;
}

async function probeDuration(config: Config, file: string): Promise<number> {
  const ffprobe = await requireTool(config, "ffprobe");
  const { stdout } = await execa(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    file,
  ]);
  return Number(stdout.trim());
}

async function probeAudioFormat(
  config: Config,
  file: string,
): Promise<{ sampleRate: number; channels: number }> {
  const ffprobe = await requireTool(config, "ffprobe");
  const { stdout } = await execa(ffprobe, [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,channels",
    "-of", "json",
    file,
  ]);
  const stream = JSON.parse(stdout).streams?.[0] ?? {};
  return {
    sampleRate: Number(stream.sample_rate) || 22050,
    channels: Number(stream.channels) || 1,
  };
}

async function synthesizeSegment(
  config: Config,
  paths: Paths,
  text: string,
  model: string,
  cache: Cache,
  force: boolean,
): Promise<string> {
  const key = cacheKey([text, model, "piper"]);
  const target = cache.path(key + ".wav");
  if (!force && existsSync(target)) return target;
  const piper = await requireTool(config, "piper");
  await mkdir(dirname(target), { recursive: true });
  const res = await execa(
    piper,
    ["--model", model, "--output_file", target],
    { input: text, reject: false },
  );
  if (res.exitCode !== 0) {
    throw new Error(`piper failed for segment: ${res.stderr.split("\n").slice(-3).join(" ")}`);
  }
  return target;
}

async function generateSilence(
  config: Config,
  seconds: number,
  format: { sampleRate: number; channels: number },
  cache: Cache,
): Promise<string> {
  const key = cacheKey(["silence", seconds.toFixed(3), format.sampleRate, format.channels]);
  const target = cache.path(key + ".wav");
  if (existsSync(target)) return target;
  const ffmpeg = await requireTool(config, "ffmpeg");
  await mkdir(dirname(target), { recursive: true });
  const layout = format.channels > 1 ? "stereo" : "mono";
  await execa(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", `anullsrc=r=${format.sampleRate}:cl=${layout}`,
    "-t", seconds.toFixed(3),
    "-c:a", "pcm_s16le",
    target,
  ]);
  return target;
}

async function concatAudio(config: Config, files: string[], out: string): Promise<void> {
  const ffmpeg = await requireTool(config, "ffmpeg");
  await mkdir(dirname(out), { recursive: true });
  const args = ["-y"];
  for (const f of files) args.push("-i", f);
  const labels = files.map((_, i) => `[${i}:a]`).join("");
  args.push(
    "-filter_complex", `${labels}concat=n=${files.length}:v=0:a=1[aout]`,
    "-map", "[aout]",
    "-c:a", "pcm_s16le",
    out,
  );
  const res = await execa(ffmpeg, args, { reject: false });
  if (res.exitCode !== 0) {
    throw new Error(`audio concat failed: ${res.stderr.split("\n").slice(-3).join(" ")}`);
  }
}

export interface TtsOptions {
  voice?: string;
  engine?: string;
  output?: string;
  force?: boolean;
}

export async function synthesizeNarration(
  config: Config,
  paths: Paths,
  script: NarrationScript,
  opts: TtsOptions = {},
): Promise<NarrationTiming> {
  const engine = opts.engine ?? script.engine ?? config.tts.engine;
  if (engine !== "piper") {
    throw new Error(`TTS engine "${engine}" is not implemented yet (only "piper").`);
  }
  const voice = opts.voice ?? script.voice ?? config.tts.voice;
  const model = resolvePiperModel(paths, config, voice);
  const cache = new Cache(paths.cacheDir);

  const segmentWavs: string[] = [];
  const durations: number[] = [];
  let format = { sampleRate: 22050, channels: 1 };
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i]!;
    const wav = await synthesizeSegment(config, paths, seg.text, model, cache, Boolean(opts.force));
    if (i === 0) format = await probeAudioFormat(config, wav);
    segmentWavs.push(wav);
    durations.push(await probeDuration(config, wav));
  }

  const sequence: string[] = [];
  const segments: TimingSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i]!;
    if (seg.start !== undefined && seg.start > cursor + 0.001) {
      const lead = await generateSilence(config, seg.start - cursor, format, cache);
      sequence.push(lead);
      cursor = seg.start;
    }
    const start = cursor;
    const end = start + durations[i]!;
    sequence.push(segmentWavs[i]!);
    cursor = end;
    segments.push({
      id: seg.id ?? `s${i}`,
      text: seg.text,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      gap_after: seg.gap_after,
    });
    if (seg.gap_after > 0) {
      const gap = await generateSilence(config, seg.gap_after, format, cache);
      sequence.push(gap);
      cursor += seg.gap_after;
    }
  }

  const out = opts.output
    ? (isAbsolute(opts.output) ? opts.output : join(paths.root, opts.output))
    : join(paths.root, "work", "narration.wav");
  await concatAudio(config, sequence, out);
  const duration = await probeDuration(config, out);

  const timing: NarrationTiming = {
    schema: TIMING_VERSION,
    engine,
    voice,
    audio: out,
    duration: Number(duration.toFixed(3)),
    segments,
  };
  const timingPath = out.replace(/\.wav$/, "") + ".timing.json";
  await writeFile(timingPath, JSON.stringify(timing, null, 2) + "\n", "utf8");
  return timing;
}
