import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import type { Paths } from "./config.js";
import type { Manifest } from "./schemas/manifest.js";
import type { AssetRecord } from "./schemas/asset.js";
import {
  ContextInputSchema,
  type ContextAssetInput,
  type ContextInput,
} from "./schemas/context-input.js";
import type { Clip } from "./schemas/clips.js";

export const CONTEXT_VERSION = "vided.context/1";
export const CONTEXT_INPUT_FILE = "context.yaml";

/** Structured input context: `context.yaml` at the root or in `.vided/`. */
export async function loadContextInput(paths: Paths): Promise<ContextInput | undefined> {
  for (const p of [join(paths.root, CONTEXT_INPUT_FILE), join(paths.dir, CONTEXT_INPUT_FILE)]) {
    if (existsSync(p)) {
      const raw = parseYaml(await readFile(p, "utf8"));
      return ContextInputSchema.parse(raw ?? {});
    }
  }
  return undefined;
}

export async function saveContextInput(paths: Paths, input: ContextInput): Promise<string> {
  const p = join(paths.root, CONTEXT_INPUT_FILE);
  await writeFile(p, toYaml(ContextInputSchema.parse(input)), "utf8");
  return p;
}

export function contextAssetMeta(
  context: ContextInput | undefined,
  asset: AssetRecord,
): ContextAssetInput | undefined {
  if (!context) return undefined;
  return context.assets[asset.id] ?? context.assets[asset.path];
}

export interface ContextFrame {
  t: number;
  scene?: string;
  description?: string;
  tags: string[];
  quality?: number;
}

export interface ContextClip {
  id: string;
  kind: string;
  in?: number;
  out?: number;
  duration?: number;
  tags?: string[];
  note?: string;
}

export interface ContextAsset {
  id: string;
  path: string;
  kind: string;
  duration_s?: number;
  tags: string[];
  summary?: string;
  title?: string;
  role?: string;
  notes?: string;
  language?: string;
  scenes: Array<{ id: string; start: number; end: number }>;
  transcript: Array<{ start: number; end: number; text: string }>;
  frames: ContextFrame[];
  clips?: ContextClip[];
}

export interface ContextJson {
  schema: typeof CONTEXT_VERSION;
  project: string;
  created_at: string;
  brief?: string;
  context?: Omit<ContextInput, "assets">;
  totals: Manifest["totals"];
  assets: ContextAsset[];
}

/** Project-level brief: `context.yaml` brief, then `brief.md`. */
export async function loadBrief(paths: Paths): Promise<string | undefined> {
  const context = await loadContextInput(paths);
  if (context?.brief?.trim()) return context.brief.trim();
  for (const p of [join(paths.root, "brief.md"), join(paths.dir, "brief.md")]) {
    if (existsSync(p)) {
      const text = (await readFile(p, "utf8")).trim();
      if (text) return text;
    }
  }
  return undefined;
}

/** Per-input notes: `context.yaml` notes, then `<media>.md` sidecars. */
export async function loadAssetNotes(
  paths: Paths,
  manifest: Manifest,
  context?: ContextInput,
): Promise<Record<string, string>> {
  const notes: Record<string, string> = {};
  for (const asset of manifest.assets) {
    const meta = contextAssetMeta(context, asset);
    if (meta?.notes?.trim()) {
      notes[asset.id] = meta.notes.trim();
      continue;
    }
    const media = join(paths.root, asset.path);
    const base = media.replace(/\.[^.]+$/, "");
    for (const p of [`${media}.md`, `${base}.notes.md`, `${base}.md`]) {
      if (existsSync(p)) {
        const text = (await readFile(p, "utf8")).trim();
        if (text) {
          notes[asset.id] = text;
          break;
        }
      }
    }
  }
  return notes;
}

function contextAsset(
  asset: AssetRecord,
  notes?: string,
  meta?: ContextAssetInput,
  clips?: ContextClip[],
): ContextAsset {
  const transcript = (asset.extracted.transcript?.segments ?? []).map((s) => ({
    start: Number(s.start.toFixed(2)),
    end: Number(s.end.toFixed(2)),
    text: s.text,
  }));
  const tags = [...new Set([...(asset.tags ?? []), ...(meta?.tags ?? [])])];
  const frames = asset.visual.frames
    .filter((f) => f.selected)
    .map((f) => ({
      t: Number(f.t.toFixed(2)),
      ...(f.scene ? { scene: f.scene } : {}),
      ...(f.description ? { description: f.description } : {}),
      tags: f.tags ?? [],
      ...(f.quality !== undefined ? { quality: f.quality } : {}),
    }));
  return {
    id: asset.id,
    path: asset.path,
    kind: asset.kind,
    duration_s: asset.technical.duration_s,
    tags,
    ...(asset.summary ? { summary: asset.summary } : {}),
    ...((meta?.title ?? asset.title) ? { title: meta?.title ?? asset.title } : {}),
    ...((meta?.role ?? asset.role) ? { role: meta?.role ?? asset.role } : {}),
    ...(notes ?? asset.notes ? { notes: notes ?? asset.notes } : {}),
    ...(asset.extracted.language ? { language: asset.extracted.language } : {}),
    scenes: asset.visual.scenes,
    transcript,
    frames,
    ...(clips?.length ? { clips } : {}),
  };
}

export function buildContextJson(
  manifest: Manifest,
  opts: {
    brief?: string;
    notes?: Record<string, string>;
    context?: ContextInput;
    clips?: Clip[];
  } = {},
): ContextJson {
  let contextRest: Omit<ContextInput, "assets"> | undefined;
  if (opts.context) {
    const { assets: _assets, ...rest } = opts.context;
    contextRest = rest;
  }
  const clipsBySource = new Map<string, ContextClip[]>();
  for (const c of opts.clips ?? []) {
    const list = clipsBySource.get(c.source) ?? [];
    list.push({
      id: c.id,
      kind: c.kind,
      ...(c.kind === "video" || c.kind === "audio" ? { in: c.in, out: c.out } : {}),
      ...(c.kind === "image" || c.kind === "title" || c.kind === "slide" ? { duration: c.duration } : {}),
      ...(c.tags && c.tags.length ? { tags: c.tags } : {}),
      ...(c.note ? { note: c.note } : {}),
    });
    clipsBySource.set(c.source, list);
  }
  return {
    schema: CONTEXT_VERSION,
    project: manifest.project,
    created_at: new Date().toISOString(),
    ...(opts.brief ? { brief: opts.brief } : {}),
    ...(contextRest ? { context: contextRest } : {}),
    totals: manifest.totals,
    assets: manifest.assets.map((a) =>
      contextAsset(
        a,
        opts.notes?.[a.id],
        contextAssetMeta(opts.context, a),
        clipsBySource.get(a.id) ?? clipsBySource.get(a.path),
      ),
    ),
  };
}

function renderAssetBlock(a: ContextAsset, share: number): string {
  const lines: string[] = [];
  const dur = a.duration_s !== undefined ? `${a.duration_s}s` : "?";
  const heading = a.title ? `${a.title} — ${a.path}` : a.path;
  lines.push(`## ${heading} — ${a.kind} ${dur} (id: ${a.id})`);
  if (a.role) lines.push(`role: ${a.role}`);
  if (a.tags.length) lines.push(`tags: ${a.tags.join(", ")}`);
  if (a.summary) lines.push(`summary: ${a.summary}`);
  if (a.notes) lines.push(`notes: ${a.notes.replace(/\n/g, " ")}`);
  if (a.scenes.length) {
    lines.push(`scenes: ${a.scenes.map((s) => `${s.start}-${s.end}`).join(", ")}`);
  }
  if (a.clips?.length) {
    lines.push("clips:");
    for (const c of a.clips) {
      const range = c.out !== undefined ? `${c.in ?? 0}-${c.out}` : c.duration !== undefined ? `${c.duration}s` : "";
      const tags = c.tags?.length ? ` [${c.tags.join(",")}]` : "";
      const note = c.note ? ` "${c.note}"` : "";
      lines.push(`  - ${c.id} [${c.kind}${range ? " " + range : ""}]${tags}${note}`);
    }
  }

  const transcript = [...a.transcript];
  const frames = [...a.frames];
  const budget = Math.max(0, share - lines.join("\n").length);

  const transcriptLines: string[] = [];
  let used = 0;
  for (const seg of transcript) {
    const line = `  [${seg.start}] ${seg.text}`;
    if (used + line.length > budget * 0.6) break;
    transcriptLines.push(line);
    used += line.length;
  }
  if (transcriptLines.length) {
    lines.push("transcript:");
    lines.push(...transcriptLines);
    if (transcriptLines.length < transcript.length) lines.push("  ...");
  }

  const frameLines: string[] = [];
  used = 0;
  for (const f of frames) {
    const desc = f.description ? ` "${f.description}"` : "";
    const tagPart = f.tags.length ? ` [${f.tags.join(",")}]` : "";
    const line = `  - t=${f.t}${f.scene ? ` scene=${f.scene}` : ""}${desc}${tagPart}`;
    if (used + line.length > budget * 0.4) break;
    frameLines.push(line);
    used += line.length;
  }
  if (frameLines.length) {
    lines.push("frames:");
    lines.push(...frameLines);
    if (frameLines.length < frames.length) lines.push("  ...");
  }

  return lines.join("\n");
}

export interface ContextPack {
  markdown: string;
  json: ContextJson;
  chars: number;
  truncated: boolean;
}

export function buildContextPack(
  manifest: Manifest,
  opts: {
    maxChars?: number;
    brief?: string;
    notes?: Record<string, string>;
    context?: ContextInput;
    clips?: Clip[];
  } = {},
): ContextPack {
  const maxChars = opts.maxChars ?? 12000;
  const json = buildContextJson(manifest, {
    brief: opts.brief,
    notes: opts.notes,
    context: opts.context,
    clips: opts.clips,
  });

  const headerParts = [
    `# vided context — ${manifest.project}`,
    `assets: ${manifest.totals.assets} | duration: ${manifest.totals.duration_s}s | selected frames: ${manifest.totals.unique_frames}`,
  ];
  if (opts.brief) headerParts.push("", "## Brief", opts.brief);
  const c = opts.context;
  if (c) {
    const directives: string[] = [];
    if (c.audience) directives.push(`audience: ${c.audience}`);
    if (c.tone) directives.push(`tone: ${c.tone}`);
    if (c.target_duration_s) directives.push(`target_duration_s: ${c.target_duration_s}`);
    if (c.must_include.length) directives.push(`must_include: ${c.must_include.join(", ")}`);
    if (c.avoid.length) directives.push(`avoid: ${c.avoid.join(", ")}`);
    if (Object.keys(c.pronunciation).length)
      directives.push(`pronunciation: ${JSON.stringify(c.pronunciation)}`);
    if (directives.length) headerParts.push("", "## Directives", ...directives);
  }
  const header = headerParts.join("\n");

  const blocks: string[] = [];
  let total = header.length;
  let truncated = false;
  const share = json.assets.length ? Math.floor(maxChars / json.assets.length) : maxChars;

  for (const asset of json.assets) {
    const block = renderAssetBlock(asset, share);
    if (total + block.length > maxChars) {
      truncated = true;
      break;
    }
    blocks.push(block);
    total += block.length + 2;
  }

  const markdown = [header, "", ...blocks].join("\n\n");
  return { markdown, json, chars: markdown.length, truncated };
}
