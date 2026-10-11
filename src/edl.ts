import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { EdlSchema, type Edl, type Position } from "./schemas/edl.js";
import {
  KNOWN_FORMATS,
  type AudioClip,
  type Clip,
  type FormatName,
  type Transform,
  type Transition,
} from "./schemas/clips.js";
import { clipDuration, type ResolvedSource } from "./av.js";

export type Resolve = (source: string) => ResolvedSource | undefined;

export interface EdlLoadResult {
  ok: boolean;
  edl?: Edl;
  errors: string[];
}

export function loadEdlFromString(raw: string): EdlLoadResult {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    return { ok: false, errors: [`YAML parse error: ${(err as Error).message}`] };
  }
  const parsed = EdlSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  return { ok: true, edl: parsed.data, errors: [] };
}

export async function loadEdlFile(path: string): Promise<EdlLoadResult> {
  try {
    return loadEdlFromString(await readFile(path, "utf8"));
  } catch (err) {
    return { ok: false, errors: [`Cannot read ${path}: ${(err as Error).message}`] };
  }
}

export interface ResolvedVideoItem {
  kind: "video";
  id: string;
  clip: Clip;
  trackId: string;
  start: number;
  duration: number;
  speed: number;
  transform?: Transform;
  position: Position;
  opacity: number;
  transition_in?: Transition;
  transition_out?: Transition;
}

export interface ResolvedAudioItem {
  kind: "audio";
  id: string;
  clip: AudioClip;
  trackId: string;
  start: number;
  duration: number;
  gain_db: number;
  fade_in?: number;
  fade_out?: number;
}

export type ResolvedItem = ResolvedVideoItem | ResolvedAudioItem;

export interface ResolvedTrack {
  id: string;
  kind: "video" | "audio";
  items: ResolvedItem[];
}

export interface ResolvedEdl {
  output: Edl["output"];
  tracks: ResolvedTrack[];
  captions: Edl["captions"];
}

export interface ResolveResult {
  ok: boolean;
  errors: string[];
  resolved?: ResolvedEdl;
}

/** Video tracks accept video/image/title/slide/text clips. */
const VISUAL_KINDS = new Set(["video", "image", "title", "slide", "text"]);

/** Best-effort duration of an audio clip, given an optional source resolver. */
export function audioClipDuration(clip: AudioClip, resolve?: Resolve): number {
  const start = clip.in ?? 0;
  if (clip.out !== undefined) return Math.max(0, clip.out - start);
  if (clip.duration !== undefined) return clip.duration;
  const src = resolve?.(clip.source);
  if (src?.duration !== undefined) return Math.max(0, src.duration - start);
  return 0;
}

export function itemDuration(item: ResolvedItem, resolve?: Resolve): number {
  if (item.kind === "audio") return item.duration || audioClipDuration(item.clip, resolve);
  const c = item.clip;
  if (c.kind === "video") return clipDuration({ in: c.in, out: c.out, speed: item.speed });
  return (c as { duration?: number }).duration ?? 0;
}

/**
 * Bind every `use:` reference in the pool, validate kind↔track, resolve the
 * absolute `start` of each item (a track's first item defaults to 0) and compute
 * durations. Returns a concrete composition the renderer/explainer/linter use.
 */
export function resolveEdl(edl: Edl, clips: Map<string, Clip>, resolve?: Resolve): ResolveResult {
  const errors: string[] = [];
  const tracks: ResolvedTrack[] = [];

  for (const track of edl.tracks) {
    const items: ResolvedItem[] = [];
    if (track.kind === "video") {
      track.items.forEach((item, i) => {
        const clip = clips.get(item.use);
        if (!clip) {
          errors.push(`video item "${item.id}" references unknown clip "${item.use}".`);
          return;
        }
        const start = item.start ?? (i === 0 ? 0 : undefined);
        if (start === undefined) {
          errors.push(`video item "${item.id}" needs a start (only a track's first item may omit it).`);
          return;
        }
        if (!VISUAL_KINDS.has(clip.kind)) {
          errors.push(`video item "${item.id}" uses a ${clip.kind} clip; video track needs video/image/title/slide/text.`);
          return;
        }
        const speed = item.speed ?? (clip.kind === "video" ? clip.speed : 1);
        const duration = clip.kind === "video" ? clipDuration({ in: clip.in, out: clip.out, speed }) : (clip as { duration: number }).duration;
        items.push({
          kind: "video",
          id: item.id,
          clip,
          trackId: track.id,
          start,
          duration,
          speed,
          position: item.position,
          opacity: item.opacity,
          ...(item.transform ? { transform: item.transform } : {}),
          ...(item.transition_in ? { transition_in: item.transition_in } : {}),
          ...(item.transition_out ? { transition_out: item.transition_out } : {}),
        });
      });
    } else {
      track.items.forEach((item, i) => {
        const clip = clips.get(item.use);
        if (!clip) {
          errors.push(`audio item "${item.id}" references unknown clip "${item.use}".`);
          return;
        }
        const start = item.start ?? (i === 0 ? 0 : undefined);
        if (start === undefined) {
          errors.push(`audio item "${item.id}" needs a start (only a track's first item may omit it).`);
          return;
        }
        if (clip.kind !== "audio") {
          errors.push(`audio item "${item.id}" uses a ${clip.kind} clip; audio track needs audio clips.`);
          return;
        }
        items.push({
          kind: "audio",
          id: item.id,
          clip,
          trackId: track.id,
          start,
          duration: audioClipDuration(clip, resolve),
          gain_db: item.gain_db ?? clip.gain_db,
          ...(item.fade_in !== undefined ? { fade_in: item.fade_in } : {}),
          ...(item.fade_out !== undefined ? { fade_out: item.fade_out } : {}),
        });
      });
    }
    tracks.push({ id: track.id, kind: track.kind, items });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], resolved: { output: edl.output, tracks, captions: edl.captions } };
}

/** Total timeline length: explicit `output.duration` or the max item end. */
export function timelineDuration(edl: ResolvedEdl, resolve?: Resolve): number {
  if (edl.output.duration !== undefined) return edl.output.duration;
  let end = 0;
  for (const track of edl.tracks) {
    for (const item of track.items) end = Math.max(end, item.start + itemDuration(item, resolve));
  }
  return end;
}

export interface ExplainItem {
  id: string;
  kind: string;
  source: string;
  start: number;
  end: number;
  duration: number;
  format: string;
  path?: string;
  track: string;
}

export interface ExplainAudioItem {
  id: string;
  source: string;
  start: number;
  end: number;
  duration: number;
}

export interface ExplainResult {
  schema: string;
  output: Edl["output"];
  duration: number;
  clip_count: number;
  tracks: Array<{ id: string; kind: string; items: ExplainItem[] }>;
  audio: { clips: number; attached: number; end?: number; fits?: boolean; items: ExplainAudioItem[] };
  captions: { mode: string; export: string[] };
}

export function explainEdl(edl: ResolvedEdl, resolve?: Resolve): ExplainResult {
  const tracks: ExplainResult["tracks"] = [];
  let clipCount = 0;
  let attached = 0;

  for (const track of edl.tracks) {
    const items: ExplainItem[] = track.items.map((item) => {
      clipCount++;
      const duration = itemDuration(item, resolve);
      const src = item.clip.kind === "video" ? resolve?.(item.clip.source) : undefined;
      if (track.kind === "video" && item.clip.kind === "video" && !item.clip.muted) attached++;
      return {
        id: item.id,
        kind: item.clip.kind,
        source: item.clip.source,
        start: Number(item.start.toFixed(3)),
        end: Number((item.start + duration).toFixed(3)),
        duration: Number(duration.toFixed(3)),
        format: item.clip.format,
        track: track.id,
        ...(src ? { path: src.path } : {}),
      };
    });
    tracks.push({ id: track.id, kind: track.kind, items });
  }

  const duration = Number(timelineDuration(edl, resolve).toFixed(3));

  let audioEnd: number | undefined;
  const audioItems: ExplainAudioItem[] = [];
  for (const track of edl.tracks) {
    if (track.kind !== "audio") continue;
    for (const item of track.items) {
      const dur = itemDuration(item, resolve);
      if (dur <= 0 && !resolve) continue;
      audioItems.push({
        id: item.id,
        source: item.clip.source,
        start: Number(item.start.toFixed(3)),
        end: Number((item.start + dur).toFixed(3)),
        duration: Number(dur.toFixed(3)),
      });
      audioEnd = Math.max(audioEnd ?? 0, item.start + dur);
    }
  }

  return {
    schema: "vided.edl/4",
    output: edl.output,
    duration,
    clip_count: clipCount,
    tracks,
    audio: {
      clips: audioItems.length,
      attached,
      items: audioItems,
      ...(audioEnd !== undefined
        ? { end: Number(audioEnd.toFixed(3)), fits: audioEnd <= duration + 1e-6 }
        : {}),
    },
    captions: { mode: edl.captions.mode, export: edl.captions.export },
  };
}

export interface LintIssue {
  level: "error" | "warning";
  message: string;
  path?: string;
}

export function lintEdl(edl: ResolvedEdl, resolve?: Resolve): LintIssue[] {
  const issues: LintIssue[] = [];

  try {
    formatResolution(edl.output.format);
  } catch (err) {
    issues.push({ level: "error", message: (err as Error).message, path: "output.format" });
  }

  const ids = new Set<string>();
  for (const track of edl.tracks) {
    let prevEnd = 0;
    track.items.forEach((item, i) => {
      const path = `tracks.${track.id}[${i}]`;
      if (ids.has(item.id)) issues.push({ level: "error", message: `Duplicate item id "${item.id}".`, path });
      ids.add(item.id);

      const duration = itemDuration(item, resolve);
      if (item.start < 0) issues.push({ level: "error", message: `Item "${item.id}" has a negative start.`, path });
      if (item.start + 1e-6 < prevEnd) {
        issues.push({ level: "error", message: `Item "${item.id}" overlaps the previous item on track "${track.id}".`, path });
      }
      prevEnd = Math.max(prevEnd, item.start + duration);

      const fadeIn = item.kind === "audio" ? item.fade_in : item.transition_in?.duration;
      const fadeOut = item.kind === "audio" ? item.fade_out : item.transition_out?.duration;
      if (fadeIn && fadeIn > duration) issues.push({ level: "warning", message: `Item "${item.id}" fade_in is longer than the item.`, path });
      if (fadeOut && fadeOut > duration) issues.push({ level: "warning", message: `Item "${item.id}" fade_out is longer than the item.`, path });

      const c = item.clip;
      if (c.format !== edl.output.format) {
        issues.push({ level: "warning", message: `Clip "${item.id}" format ${c.format} differs from output ${edl.output.format}.`, path });
      }
      if (c.kind === "video") {
        if (c.out <= c.in) issues.push({ level: "error", message: `Clip "${item.id}" has out <= in.`, path });
        const src = resolve?.(c.source);
        if (resolve && !src) {
          issues.push({ level: "error", message: `Clip "${item.id}" source "${c.source}" not found.`, path });
        } else if (src?.duration && c.out > src.duration + 0.05) {
          issues.push({ level: "warning", message: `Clip "${item.id}" out (${c.out}s) exceeds source duration (${src.duration.toFixed(2)}s).`, path });
        }
      } else if (c.source !== "generated" && resolve && !resolve(c.source)) {
        issues.push({ level: "error", message: `Clip "${item.id}" source "${c.source}" not found.`, path });
      }
    });
  }

  if (edl.output.duration !== undefined) {
    let maxEnd = 0;
    for (const track of edl.tracks) {
      for (const item of track.items) maxEnd = Math.max(maxEnd, item.start + itemDuration(item, resolve));
    }
    if (maxEnd > edl.output.duration + 1e-6) {
      issues.push({
        level: "warning",
        message: `Some items end at ${maxEnd.toFixed(2)}s, past output.duration ${edl.output.duration}s.`,
        path: "output.duration",
      });
    }
  }

  if (edl.captions.mode !== "none" && !edl.captions.file) {
    issues.push({ level: "warning", message: `captions.mode is ${edl.captions.mode} but no captions.file is set.`, path: "captions" });
  } else if (edl.captions.mode !== "none" && edl.captions.file && resolve && !resolve(edl.captions.file)) {
    issues.push({ level: "error", message: `Captions file "${edl.captions.file}" not found.`, path: "captions" });
  }

  return issues;
}

/** Resolution string from a canonical format name (used for ASS PlayRes, etc.). */
export function formatResolution(name: FormatName): string {
  const f = KNOWN_FORMATS[name] as { width?: number; height?: number };
  if (!f.width || !f.height) throw new Error(`Format "${name}" has no video resolution.`);
  return `${f.width}x${f.height}`;
}
