import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import type { Config } from "./config.js";
import type { Transcript, TranscriptSegment, TranscriptWord } from "./schemas/asset.js";
import { requireTool } from "./tools/resolve.js";

const SPECIAL_TOKEN = /^\[.*\]$|^\(.*\)$|^<\|.*\|>$/;

interface WhisperToken {
  text?: string;
  offsets?: { from?: number; to?: number };
}

interface WhisperEntry {
  text?: string;
  offsets?: { from?: number; to?: number };
  tokens?: WhisperToken[];
}

interface WhisperJson {
  result?: { language?: string };
  transcription?: WhisperEntry[];
}

/** Group whisper subword tokens into words using the leading-space convention. */
function tokensToWords(tokens: WhisperToken[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let current: TranscriptWord | null = null;
  for (const tok of tokens) {
    const raw = tok.text ?? "";
    if (!raw || SPECIAL_TOKEN.test(raw.trim())) continue;
    const start = (tok.offsets?.from ?? 0) / 1000;
    const end = (tok.offsets?.to ?? 0) / 1000;
    const isNewWord = /^\s/.test(raw);
    const text = raw.trim();
    if (!text) continue;
    if (isNewWord || !current) {
      if (current) words.push(current);
      current = { w: text, start, end };
    } else {
      current.w += text;
      current.end = end;
    }
  }
  if (current) words.push(current);
  return words;
}

export function parseWhisperJson(raw: string): Transcript {
  const data = JSON.parse(raw) as WhisperJson;
  const segments: TranscriptSegment[] = [];
  for (const entry of data.transcription ?? []) {
    const text = (entry.text ?? "").trim();
    if (!text || SPECIAL_TOKEN.test(text)) continue;
    const start = (entry.offsets?.from ?? 0) / 1000;
    const end = (entry.offsets?.to ?? 0) / 1000;
    const words = entry.tokens ? tokensToWords(entry.tokens) : undefined;
    segments.push({ start, end, text, ...(words && words.length ? { words } : {}) });
  }
  return {
    tool: "whisper.cpp",
    language: data.result?.language,
    segments,
  };
}

export async function demuxAudio(
  config: Config,
  input: string,
  outWav: string,
): Promise<void> {
  const ffmpeg = await requireTool(config, "ffmpeg");
  await execa(ffmpeg, [
    "-y", "-i", input,
    "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "pcm_s16le",
    outWav,
  ]);
}

export interface TranscribeOptions {
  model?: string;
  language?: string;
  threads?: number;
}

export async function transcribe(
  config: Config,
  input: string,
  opts: TranscribeOptions = {},
): Promise<Transcript> {
  const whisper = await requireTool(config, "whisper");
  const model = opts.model ?? config.transcription.model;
  if (!model) {
    throw new Error(
      "No whisper model configured. Set transcription.model in .vided/config.json.",
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "vided-whisper-"));
  const wav = join(dir, "audio.wav");
  const prefix = join(dir, "out");
  try {
    await demuxAudio(config, input, wav);
    await execa(whisper, [
      "-m", model,
      "-f", wav,
      "-l", opts.language ?? config.transcription.language,
      "-t", String(opts.threads ?? config.transcription.threads),
      "-oj", "-ojf",
      "-of", prefix,
      "-np",
    ]);
    const json = await readFile(prefix + ".json", "utf8");
    return parseWhisperJson(json);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SIDECAR_EXT = [".srt", ".vtt", ".txt", ".md"];

export function findSidecar(input: string): string | undefined {
  const base = input.replace(/\.[^.]+$/, "");
  for (const ext of SIDECAR_EXT) {
    if (existsSync(base + ext)) return base + ext;
  }
  return undefined;
}

export async function readSidecar(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function ocrImage(path: string, lang = "eng"): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang);
  try {
    const { data } = await worker.recognize(path);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}
