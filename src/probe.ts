import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { execa } from "execa";
import type { AssetKind, Technical } from "./schemas/asset.js";
import { requireTool } from "./tools/resolve.js";
import type { Config } from "./config.js";

export const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg", ".wmv", ".flv",
  ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma",
  ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".heic", ".gif",
  ".srt", ".vtt", ".txt", ".md", ".json",
]);

export function kindFromExt(ext: string): AssetKind {
  const e = ext.toLowerCase();
  if ([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg", ".wmv", ".flv"].includes(e))
    return "video";
  if ([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"].includes(e))
    return "audio";
  if ([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".heic", ".gif"].includes(e))
    return "image";
  if ([".srt", ".vtt", ".txt", ".md", ".json"].includes(e)) return "text";
  return "unknown";
}

export async function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(path);
    s.on("data", (c) => h.update(c));
    s.on("error", reject);
    s.on("end", () => resolve("sha256:" + h.digest("hex")));
  });
}

export function assetId(contentHash: string): string {
  return contentHash.replace(/^sha256:/, "").slice(0, 12);
}

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  tags?: Record<string, string>;
  side_data_list?: Array<{ rotation?: number }>;
}

interface ProbeResult {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    size?: string;
    format_name?: string;
    format_long_name?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

function parseFps(rate?: string): number | undefined {
  if (!rate || rate === "0/0") return undefined;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return undefined;
  return Number((n / d).toFixed(3));
}

export async function ffprobe(
  config: Config,
  path: string,
): Promise<Technical> {
  const ffprobeBin = await requireTool(config, "ffprobe");
  const { stdout } = await execa(ffprobeBin, [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    path,
  ]);
  const data = JSON.parse(stdout) as ProbeResult;
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const fmt = data.format ?? {};

  const rotation =
    v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
    (v?.tags?.rotate ? Number(v.tags.rotate) : undefined);

  const technical: Technical = {
    container: fmt.format_name,
    format_long_name: fmt.format_long_name,
    duration_s: fmt.duration ? Number(fmt.duration) : undefined,
    size_bytes: fmt.size ? Number(fmt.size) : undefined,
    creation_time: fmt.tags?.creation_time ?? v?.tags?.creation_time,
  };

  if (v) {
    technical.video = {
      index: v.index,
      codec: v.codec_name,
      profile: v.profile,
      width: v.width,
      height: v.height,
      fps: parseFps(v.avg_frame_rate) ?? parseFps(v.r_frame_rate),
      bitrate: v.bit_rate ? Number(v.bit_rate) : undefined,
      rotation,
    };
  }
  if (a) {
    technical.audio = {
      index: a.index,
      codec: a.codec_name,
      sample_rate: a.sample_rate ? Number(a.sample_rate) : undefined,
      channels: a.channels,
      bitrate: a.bit_rate ? Number(a.bit_rate) : undefined,
    };
  }
  return technical;
}

export async function statFile(path: string): Promise<{ bytes: number; mtime: string }> {
  const s = await stat(path);
  return { bytes: s.size, mtime: s.mtime.toISOString() };
}

export function extOf(path: string): string {
  return extname(path);
}
