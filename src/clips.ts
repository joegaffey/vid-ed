import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import type { Paths } from "./config.js";
import type { Manifest } from "./schemas/manifest.js";
import type { AssetRecord } from "./schemas/asset.js";
import {
  ClipsSchema,
  clipId,
  KNOWN_FORMATS,
  type Clip,
  type ClipInput,
  type Clips,
  type FormatName,
} from "./schemas/clips.js";

export const CLIPS_FILE = "clips.yaml";

/** Load the clip pool: `clips.yaml` at the root or in `.vided/`. */
export async function loadClips(paths: Paths): Promise<Clips | undefined> {
  for (const p of [join(paths.root, CLIPS_FILE), join(paths.dir, CLIPS_FILE)]) {
    if (existsSync(p)) {
      const raw = parseYaml(await readFile(p, "utf8"));
      return ClipsSchema.parse(raw ?? {});
    }
  }
  return undefined;
}

export async function saveClips(paths: Paths, clips: Clips): Promise<string> {
  const p = join(paths.root, CLIPS_FILE);
  await writeFile(p, toYaml(ClipsSchema.parse(clips)), "utf8");
  return p;
}

export function clipsById(clips: Clip[] | undefined): Map<string, Clip> {
  return new Map((clips ?? []).map((c) => [c.id, c]));
}

/** Clips are placeable media: video, image or audio inputs. */
export function hasPlaceableMedia(manifest: Manifest): boolean {
  return manifest.assets.some((a) => a.kind === "video" || a.kind === "image" || a.kind === "audio");
}

/**
 * Best matching known format for a media asset. Prefers the source's exact
 * resolution/fps; otherwise the largest known format that does not exceed the
 * source width (so previews never upscale), else the smallest.
 */
export function nearestFormat(asset: AssetRecord): FormatName {
  if (asset.kind === "audio") return "audio48k";
  const v = asset.technical.video;
  const w = v?.width;
  const h = v?.height;
  const fps = v?.fps;
  const all = (Object.entries(KNOWN_FORMATS) as Array<[FormatName, Record<string, unknown>]>).filter(
    ([, f]) => typeof f.width === "number",
  );
  if (!w || !h) return "1080p30";

  // Match orientation first, so a landscape source never maps to a portrait
  // format just because the portrait width is smaller.
  const orient = (a: number, b: number): string => (a > b ? "landscape" : a < b ? "portrait" : "square");
  const want = orient(w, h);
  const pool = all.filter(([, f]) => orient(f.width as number, f.height as number) === want);
  const candidates = pool.length ? pool : all;

  const exact = candidates.find(([, f]) => f.width === w && f.height === h && (!fps || f.fps === Math.round(fps)));
  if (exact) return exact[0];
  const notLarger = candidates
    .filter(([, f]) => (f.width as number) <= w)
    .sort((a, b) => (b[1].width as number) - (a[1].width as number));
  if (notLarger.length) return notLarger[0]![0];
  return candidates.slice().sort((a, b) => (a[1].width as number) - (b[1].width as number))[0]![0];
}

interface Candidate {
  source: string;
  in: number;
  out: number;
  poster?: number;
  priority: number;
}

function clampRange(start: number, end: number, duration: number | undefined): { in: number; out: number } | undefined {
  const a = Math.max(0, start);
  let b = duration !== undefined ? Math.min(end, duration) : end;
  if (b <= a) b = a + (duration !== undefined ? Math.min(1, duration - a) : 1);
  if (!(b > a)) return undefined;
  return { in: Number(a.toFixed(3)), out: Number(b.toFixed(3)) };
}

function videoCandidates(asset: AssetRecord, mergeGap: number, frameGap: number, pad: number): Candidate[] {
  const duration = asset.technical.duration_s;
  const out: Candidate[] = [];

  const segs = asset.extracted.transcript?.segments ?? [];
  let beat: { start: number; end: number } | undefined;
  const flush = () => {
    if (!beat) return;
    const r = clampRange(beat.start, beat.end, duration);
    if (r) out.push({ source: asset.path, ...r, priority: 0 });
    beat = undefined;
  };
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    if (beat && s.start - beat.end <= mergeGap) beat.end = s.end;
    else {
      flush();
      beat = { start: s.start, end: s.end };
    }
  }
  flush();

  const frames = asset.visual.frames.filter((f) => f.selected).sort((a, b) => a.t - b.t);
  let cluster: typeof frames = [];
  const flushCluster = () => {
    if (!cluster.length) return;
    const r = clampRange(cluster[0]!.t - pad, cluster[cluster.length - 1]!.t + pad, duration);
    if (r) out.push({ source: asset.path, ...r, poster: Number(cluster[0]!.t.toFixed(3)), priority: 1 });
    cluster = [];
  };
  for (const f of frames) {
    if (cluster.length && f.t - cluster[cluster.length - 1]!.t > frameGap) flushCluster();
    cluster.push(f);
  }
  flushCluster();

  for (const scene of asset.visual.scenes) {
    const r = clampRange(scene.start, scene.end, duration);
    if (r) out.push({ source: asset.path, ...r, priority: 2 });
  }

  return out;
}

function iou(a: { in: number; out: number }, b: { in: number; out: number }): number {
  const overlap = Math.min(a.out, b.out) - Math.max(a.in, b.in);
  if (overlap <= 0) return 0;
  const union = Math.max(a.out, b.out) - Math.min(a.in, b.in);
  return union > 0 ? overlap / union : 0;
}

const OVERLAP = 0.5;

/**
 * Deterministic seed pool from the manifest. Mechanical candidates only — the
 * agent/human curates. Video: transcript beats, frame clusters, scenes
 * (overlap-collapsed in that priority). Images and audio yield one clip each.
 */
export function deriveClips(
  manifest: Manifest,
  opts: { mergeGap?: number; frameGap?: number; pad?: number; assets?: string[]; min?: number } = {},
): Clip[] {
  const mergeGap = opts.mergeGap ?? 0.6;
  const frameGap = opts.frameGap ?? 3;
  const pad = opts.pad ?? 1;
  const min = opts.min ?? 0.5;
  const filter = opts.assets?.length ? new Set(opts.assets) : undefined;
  const clips: ClipInput[] = [];
  const used = new Set<string>();

  const uniqueId = (base: string): string => {
    let id = base;
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${base}-${n}`)) n++;
      id = `${base}-${n}`;
    }
    used.add(id);
    return id;
  };

  for (const asset of manifest.assets) {
    if (filter && !filter.has(asset.id) && !filter.has(asset.path)) continue;
    if (asset.kind === "video") {
      const candidates = videoCandidates(asset, mergeGap, frameGap, pad);
      candidates.sort((a, b) => a.priority - b.priority || a.in - b.in);
      const kept: Candidate[] = [];
      for (const c of candidates) {
        if (c.out - c.in < min) continue;
        if (kept.some((k) => k.source === c.source && iou(k, c) > OVERLAP)) continue;
        kept.push(c);
      }
      kept.sort((a, b) => a.in - b.in);
      for (const c of kept) {
        // Carry the context of the captured frames inside this range.
        const inside = asset.visual.frames.filter(
          (f) => f.selected && f.t >= c.in && f.t <= c.out,
        );
        const descs = inside.map((f) => f.description).filter((d): d is string => Boolean(d));
        const tags = [...new Set(inside.flatMap((f) => f.tags ?? []))];
        clips.push({
          id: uniqueId(clipId(c.source, c.in, c.out)),
          kind: "video",
          source: c.source,
          format: nearestFormat(asset),
          in: c.in,
          out: c.out,
          speed: 1,
          ...(tags.length ? { tags } : {}),
          ...(descs.length ? { note: descs.join(" ") } : {}),
          ...(c.poster !== undefined ? { poster: c.poster } : {}),
          origin: "derived",
        });
      }
    } else if (asset.kind === "image") {
      clips.push({
        id: uniqueId(clipId(asset.path, 0, 5)),
        kind: "image",
        source: asset.path,
        format: nearestFormat(asset),
        duration: 5,
        fit: "contain",
        origin: "derived",
      });
    } else if (asset.kind === "audio") {
      const dur = asset.technical.duration_s ?? 0;
      clips.push({
        id: uniqueId(clipId(asset.path, 0, dur)),
        kind: "audio",
        source: asset.path,
        format: "audio48k",
        in: 0,
        ...(dur ? { out: Number(dur.toFixed(3)) } : {}),
        gain_db: 0,
        origin: "derived",
      });
    }
  }

  return ClipsSchema.parse({ schema: "vided.clips/1", clips }).clips;
}
