import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { EdlSchema, isSlide, isStill, isTitleCard, type Edl } from "./schemas/edl.js";
import { clipDuration, parseResolution, type ResolvedSource } from "./render.js";

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

export interface ExplainClip {
  id: string;
  type: "clip" | "title" | "slide" | "still";
  source?: string;
  title?: string;
  start: number;
  end: number;
  duration: number;
  speed?: number;
  path?: string;
}

export interface ExplainResult {
  schema: string;
  output: Edl["output"];
  duration: number;
  clip_count: number;
  clips: ExplainClip[];
  audio: { voiceover: boolean; music: boolean; ducking: boolean };
  captions: { mode: string; export: string[] };
  overlays: { total: number; images: number; text: number };
}

export function explainEdl(edl: Edl, resolve?: Resolve): ExplainResult {
  let cursor = 0;
  const clips: ExplainClip[] = edl.timeline.map((item) => {
    const duration =
      isTitleCard(item) || isSlide(item) || isStill(item) ? item.duration : clipDuration(item);
    const start = cursor;
    cursor += duration;
    if (isTitleCard(item) || isSlide(item) || isStill(item)) {
      const label = isSlide(item) ? item.slide : isTitleCard(item) ? item.title : item.image;
      const type = isSlide(item) ? "slide" : isTitleCard(item) ? "title" : "still";
      return {
        id: item.id,
        type,
        title: label,
        start: Number(start.toFixed(3)),
        end: Number(cursor.toFixed(3)),
        duration: Number(duration.toFixed(3)),
      };
    }
    const src = resolve?.(item.source);
    return {
      id: item.id,
      type: "clip",
      source: item.source,
      start: Number(start.toFixed(3)),
      end: Number(cursor.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      speed: item.speed,
      ...(src ? { path: src.path } : {}),
    };
  });
  const images = edl.overlays.filter((o) => o.type === "image").length;
  return {
    schema: edl.schema,
    output: edl.output,
    duration: Number(cursor.toFixed(3)),
    clip_count: clips.length,
    clips,
    audio: {
      voiceover: Boolean(edl.audio.voiceover),
      music: Boolean(edl.audio.music),
      ducking: Boolean(edl.audio.music?.duck_under_voiceover),
    },
    captions: { mode: edl.captions.mode, export: edl.captions.export },
    overlays: { total: edl.overlays.length, images, text: edl.overlays.length - images },
  };
}

export interface LintIssue {
  level: "error" | "warning";
  message: string;
  path?: string;
}

export function lintEdl(edl: Edl, resolve?: Resolve): LintIssue[] {
  const issues: LintIssue[] = [];

  try {
    parseResolution(edl.output.resolution);
  } catch (err) {
    issues.push({ level: "error", message: (err as Error).message, path: "output.resolution" });
  }

  const ids = new Set<string>();
  for (const item of edl.timeline) {
    if (ids.has(item.id)) {
      issues.push({ level: "error", message: `Duplicate timeline id "${item.id}".`, path: "timeline" });
    }
    ids.add(item.id);

    if (isTitleCard(item)) {
      if (!item.title.trim()) {
        issues.push({ level: "error", message: `Title card "${item.id}" has empty title.`, path: "timeline" });
      }
      if (item.duration <= 0) {
        issues.push({ level: "error", message: `Title card "${item.id}" has non-positive duration.`, path: "timeline" });
      }
      continue;
    }

    if (isSlide(item)) {
      if (!item.slide.trim()) {
        issues.push({ level: "error", message: `Slide "${item.id}" has empty heading.`, path: "timeline" });
      }
      if (item.duration <= 0) {
        issues.push({ level: "error", message: `Slide "${item.id}" has non-positive duration.`, path: "timeline" });
      }
      continue;
    }

    if (isStill(item)) {
      if (item.duration <= 0) {
        issues.push({ level: "error", message: `Still "${item.id}" has non-positive duration.`, path: "timeline" });
      }
      if (resolve && !resolve(item.image)) {
        issues.push({
          level: "error",
          message: `Still "${item.id}" image "${item.image}" not found.`,
          path: "timeline",
        });
      }
      continue;
    }

    const clip = item;
    if (clip.out <= clip.in) {
      issues.push({ level: "error", message: `Clip "${clip.id}" has out <= in.`, path: "timeline" });
    }
    const src = resolve?.(clip.source);
    if (resolve && !src) {
      issues.push({
        level: "error",
        message: `Clip "${clip.id}" source "${clip.source}" not found.`,
        path: "timeline",
      });
    } else if (src) {
      if (src.kind && src.kind !== "video" && src.kind !== "image") {
        issues.push({
          level: "warning",
          message: `Clip "${clip.id}" source is ${src.kind}, not video.`,
          path: "timeline",
        });
      }
      if (src.duration && clip.out > src.duration + 0.05) {
        issues.push({
          level: "warning",
          message: `Clip "${clip.id}" out (${clip.out}s) exceeds source duration (${src.duration.toFixed(2)}s).`,
          path: "timeline",
        });
      }
    }
  }

  for (const [name, ref] of [
    ["voiceover", edl.audio.voiceover],
    ["music", edl.audio.music],
  ] as const) {
    if (ref && resolve && !resolve(ref.source)) {
      issues.push({ level: "error", message: `${name} source "${ref.source}" not found.`, path: "audio" });
    }
  }

  for (const overlay of edl.overlays) {
    if (overlay.end <= overlay.start) {
      issues.push({ level: "warning", message: `Overlay ending at ${overlay.end}s starts after it ends.`, path: "overlays" });
    }
    if (overlay.type === "image" && resolve && !resolve(overlay.source)) {
      issues.push({
        level: "error",
        message: `Overlay source "${overlay.source}" not found.`,
        path: "overlays",
      });
    }
  }

  if (edl.captions.mode !== "none" && !edl.captions.file) {
    issues.push({
      level: "warning",
      message: `captions.mode is ${edl.captions.mode} but no captions.file is set.`,
      path: "captions",
    });
  } else if (edl.captions.mode !== "none" && edl.captions.file && resolve && !resolve(edl.captions.file)) {
    issues.push({
      level: "error",
      message: `Captions file "${edl.captions.file}" not found.`,
      path: "captions",
    });
  }

  return issues;
}
