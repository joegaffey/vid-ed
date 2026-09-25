import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Paths } from "./config.js";
import type { Manifest } from "./schemas/manifest.js";
import type { AssetRecord } from "./schemas/asset.js";

export const CONTEXT_VERSION = "vided.context/1";

export interface ContextFrame {
  t: number;
  scene?: string;
  description?: string;
  tags: string[];
  quality?: number;
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
}

export interface ContextJson {
  schema: typeof CONTEXT_VERSION;
  project: string;
  created_at: string;
  brief?: string;
  totals: Manifest["totals"];
  assets: ContextAsset[];
}

/** Project-level brief: `brief.md` at the root, or `.vided/brief.md`. */
export async function loadBrief(paths: Paths): Promise<string | undefined> {
  for (const p of [join(paths.root, "brief.md"), join(paths.dir, "brief.md")]) {
    if (existsSync(p)) {
      const text = (await readFile(p, "utf8")).trim();
      if (text) return text;
    }
  }
  return undefined;
}

/** Per-input notes from `<media>.md`, `<base>.notes.md` or `<base>.md`. */
export async function loadAssetNotes(
  paths: Paths,
  manifest: Manifest,
): Promise<Record<string, string>> {
  const notes: Record<string, string> = {};
  for (const asset of manifest.assets) {
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

function contextAsset(asset: AssetRecord, notes?: string): ContextAsset {
  const transcript = (asset.extracted.transcript?.segments ?? []).map((s) => ({
    start: Number(s.start.toFixed(2)),
    end: Number(s.end.toFixed(2)),
    text: s.text,
  }));
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
    tags: asset.tags,
    ...(asset.summary ? { summary: asset.summary } : {}),
    ...(asset.title ? { title: asset.title } : {}),
    ...(asset.role ? { role: asset.role } : {}),
    ...(notes ?? asset.notes ? { notes: notes ?? asset.notes } : {}),
    ...(asset.extracted.language ? { language: asset.extracted.language } : {}),
    scenes: asset.visual.scenes,
    transcript,
    frames,
  };
}

export function buildContextJson(
  manifest: Manifest,
  opts: { brief?: string; notes?: Record<string, string> } = {},
): ContextJson {
  return {
    schema: CONTEXT_VERSION,
    project: manifest.project,
    created_at: new Date().toISOString(),
    ...(opts.brief ? { brief: opts.brief } : {}),
    totals: manifest.totals,
    assets: manifest.assets.map((a) => contextAsset(a, opts.notes?.[a.id])),
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
  opts: { maxChars?: number; brief?: string; notes?: Record<string, string> } = {},
): ContextPack {
  const maxChars = opts.maxChars ?? 12000;
  const json = buildContextJson(manifest, { brief: opts.brief, notes: opts.notes });

  const headerParts = [
    `# vided context — ${manifest.project}`,
    `assets: ${manifest.totals.assets} | duration: ${manifest.totals.duration_s}s | selected frames: ${manifest.totals.unique_frames}`,
  ];
  if (opts.brief) headerParts.push("", "## Brief", opts.brief);
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
