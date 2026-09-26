import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { EdlSchema, type Edl } from "./schemas/edl.js";
import { KNOWN_FORMATS, type Clip, type FormatName, type Transform, type Transition } from "./schemas/clips.js";
import { clipDuration, parseResolution, type ResolvedSource } from "./av.js";

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

export interface ResolvedVisual {
  id: string;
  clip: Clip;
  speed: number;
  transform?: Transform;
  transition_in?: Transition;
  transition_out?: Transition;
}

export interface ResolvedAudio {
  id: string;
  clip: Clip;
  offset: number;
  gain_db: number;
  fade_in?: number;
  fade_out?: number;
}

export interface ResolvedEdl {
  output: Edl["output"];
  visual: ResolvedVisual[];
  audio: ResolvedAudio[];
  captions: Edl["captions"];
  overlays: Edl["overlays"];
}

export interface ResolveResult {
  ok: boolean;
  errors: string[];
  resolved?: ResolvedEdl;
}

const VISUAL_KINDS = new Set(["video", "image", "title", "slide"]);

/**
 * Look up every `use:` reference in the pool and validate kind↔track. Returns
 * a fully-concrete composition the renderer/explainer/linter consume.
 */
export function resolveEdl(edl: Edl, clips: Map<string, Clip>): ResolveResult {
  const errors: string[] = [];
  const visual: ResolvedVisual[] = [];
  const audio: ResolvedAudio[] = [];

  for (const item of edl.tracks.visual) {
    const clip = clips.get(item.use);
    if (!clip) {
      errors.push(`visual item "${item.id}" references unknown clip "${item.use}".`);
      continue;
    }
    if (!VISUAL_KINDS.has(clip.kind)) {
      errors.push(`visual item "${item.id}" uses a ${clip.kind} clip; visual track needs video/image/title/slide.`);
      continue;
    }
    visual.push({
      id: item.id,
      clip,
      speed: item.speed ?? (clip.kind === "video" ? clip.speed : 1),
      ...(item.transform ? { transform: item.transform } : {}),
      ...(item.transition_in ? { transition_in: item.transition_in } : {}),
      ...(item.transition_out ? { transition_out: item.transition_out } : {}),
    });
  }

  for (const item of edl.tracks.audio) {
    const clip = clips.get(item.use);
    if (!clip) {
      errors.push(`audio item "${item.id}" references unknown clip "${item.use}".`);
      continue;
    }
    if (clip.kind !== "audio") {
      errors.push(`audio item "${item.id}" uses a ${clip.kind} clip; audio track needs audio clips.`);
      continue;
    }
    audio.push({
      id: item.id,
      clip,
      offset: item.offset,
      gain_db: item.gain_db ?? (clip.kind === "audio" ? clip.gain_db : 0),
      ...(item.fade_in !== undefined ? { fade_in: item.fade_in } : {}),
      ...(item.fade_out !== undefined ? { fade_out: item.fade_out } : {}),
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], resolved: { output: edl.output, visual, audio, captions: edl.captions, overlays: edl.overlays } };
}

export function visualDuration(item: ResolvedVisual): number {
  const c = item.clip;
  if (c.kind === "video") return clipDuration({ in: c.in, out: c.out, speed: item.speed });
  if (c.kind === "audio") return 0;
  return c.duration;
}

export interface ExplainVisual {
  id: string;
  kind: string;
  source: string;
  start: number;
  end: number;
  duration: number;
  format: string;
  path?: string;
}

export interface ExplainResult {
  schema: string;
  output: Edl["output"];
  duration: number;
  clip_count: number;
  clips: ExplainVisual[];
  audio: { clips: number; attached: number };
  captions: { mode: string; export: string[] };
  overlays: { total: number; images: number; text: number };
}

export function explainEdl(edl: ResolvedEdl, resolve?: Resolve): ExplainResult {
  let cursor = 0;
  const clips: ExplainVisual[] = edl.visual.map((item) => {
    const duration = visualDuration(item);
    const start = cursor;
    cursor += duration;
    const src = item.clip.kind === "video" ? resolve?.(item.clip.source) : undefined;
    return {
      id: item.id,
      kind: item.clip.kind,
      source: item.clip.source,
      start: Number(start.toFixed(3)),
      end: Number(cursor.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      format: item.clip.format,
      ...(src ? { path: src.path } : {}),
    };
  });
  const images = edl.overlays.filter((o) => o.type === "image").length;
  const attached = edl.visual.filter((i) => i.clip.kind === "video" && !i.clip.muted).length;
  return {
    schema: "vided.edl/3",
    output: edl.output,
    duration: Number(cursor.toFixed(3)),
    clip_count: clips.length,
    clips,
    audio: { clips: edl.audio.length, attached },
    captions: { mode: edl.captions.mode, export: edl.captions.export },
    overlays: { total: edl.overlays.length, images, text: edl.overlays.length - images },
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
    parseResolution(`${outputResolution(edl)}`);
  } catch (err) {
    issues.push({ level: "error", message: (err as Error).message, path: "output.format" });
  }

  const ids = new Set<string>();
  for (const item of edl.visual) {
    if (ids.has(item.id)) issues.push({ level: "error", message: `Duplicate item id "${item.id}".`, path: "tracks.visual" });
    ids.add(item.id);

    const c = item.clip;
    if (c.format !== edl.output.format) {
      issues.push({
        level: "warning",
        message: `Clip "${item.id}" format ${c.format} differs from output ${edl.output.format}.`,
        path: "tracks.visual",
      });
    }
    if (c.kind === "video") {
      if (c.out <= c.in) issues.push({ level: "error", message: `Clip "${item.id}" has out <= in.`, path: "tracks.visual" });
      const src = resolve?.(c.source);
      if (resolve && !src) {
        issues.push({ level: "error", message: `Clip "${item.id}" source "${c.source}" not found.`, path: "tracks.visual" });
      } else if (src?.duration && c.out > src.duration + 0.05) {
        issues.push({ level: "warning", message: `Clip "${item.id}" out (${c.out}s) exceeds source duration (${src.duration.toFixed(2)}s).`, path: "tracks.visual" });
      }
    } else if (c.kind === "image" && resolve && !resolve(c.source)) {
      issues.push({ level: "error", message: `Clip "${item.id}" source "${c.source}" not found.`, path: "tracks.visual" });
    }
  }

  for (const item of edl.audio) {
    if (ids.has(item.id)) issues.push({ level: "error", message: `Duplicate item id "${item.id}".`, path: "tracks.audio" });
    ids.add(item.id);
    if (resolve && !resolve(item.clip.source)) {
      issues.push({ level: "error", message: `Audio clip "${item.id}" source "${item.clip.source}" not found.`, path: "tracks.audio" });
    }
  }

  for (const overlay of edl.overlays) {
    if (overlay.end <= overlay.start) {
      issues.push({ level: "warning", message: `Overlay ending at ${overlay.end}s starts after it ends.`, path: "overlays" });
    }
    if (overlay.type === "image" && resolve && !resolve(overlay.source)) {
      issues.push({ level: "error", message: `Overlay source "${overlay.source}" not found.`, path: "overlays" });
    }
  }

  if (edl.captions.mode !== "none" && !edl.captions.file) {
    issues.push({ level: "warning", message: `captions.mode is ${edl.captions.mode} but no captions.file is set.`, path: "captions" });
  } else if (edl.captions.mode !== "none" && edl.captions.file && resolve && !resolve(edl.captions.file)) {
    issues.push({ level: "error", message: `Captions file "${edl.captions.file}" not found.`, path: "captions" });
  }

  return issues;
}

/** Resolution string from the output format (used for ASS PlayRes, etc.). */
export function outputResolution(edl: ResolvedEdl): string {
  return formatResolution(edl.output.format);
}

export function formatResolution(name: FormatName): string {
  const f = KNOWN_FORMATS[name] as { width?: number; height?: number };
  return f.width && f.height ? `${f.width}x${f.height}` : "1920x1080";
}
