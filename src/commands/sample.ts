import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadConfig, projectPaths } from "../config.js";
import { Cache, cacheKey } from "../cache.js";
import { readManifest, refreshManifest, writeAsset } from "../manifest.js";
import { sceneOf, sampleVideo } from "../frames.js";
import type { AssetRecord, VisualFrame } from "../schemas/asset.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface SampleOptions extends OutputOptions {
  dir: string;
  assets?: string[];
  threshold?: number;
  every?: number;
  rate?: number;
  maxWidth?: number;
  force?: boolean;
}

export async function cmdSample(opts: SampleOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const manifest = await readManifest(paths);
  if (!manifest) fail("No manifest found. Run `vided scan` first.");

  const threshold = opts.threshold ?? config.sampling.scene_threshold;
  const maxWidth = opts.maxWidth ?? config.sampling.max_width;
  const rate = opts.rate ?? config.sampling.frames_per_minute;
  const everyS =
    opts.every ?? config.sampling.every_s ?? (rate > 0 ? 60 / rate : undefined);

  const cache = new Cache(paths.cacheDir);
  const selected = opts.assets?.length
    ? manifest.assets.filter((a) => opts.assets!.includes(a.id))
    : manifest.assets.filter((a) => a.kind === "video");

  const assets: AssetRecord[] = [...manifest.assets];
  let processed = 0;
  let cacheHits = 0;
  let totalFrames = 0;

  for (const asset of selected) {
    const duration = asset.technical.duration_s ?? 0;
    if (duration <= 0) continue;
    const key = cacheKey([
      asset.content_hash, "sample", "jpg", threshold, everyS ?? "none", maxWidth,
    ]);
    let visual = opts.force ? undefined : await cache.getJSON<AssetRecord["visual"]>(key);
    if (visual) {
      const firstPath = visual.frames[0]?.path;
      if (!firstPath || !existsSync(resolve(paths.root, firstPath))) visual = undefined;
    }

    if (!visual) {
      const outDir = resolve(paths.framesDir, asset.id);
      const result = await sampleVideo(config, resolve(paths.root, asset.path), outDir, duration, {
        threshold,
        everyS,
        maxWidth,
      });
      const frames: VisualFrame[] = result.frames.map((f) => ({
        t: Number(f.t.toFixed(3)),
        path: relative(paths.root, f.path),
        scene: sceneOf(result.scenes, f.t),
        selected: false,
        tags: [],
      }));
      visual = { scenes: result.scenes, frames, vision_budget: undefined };
      await cache.putJSON(key, visual);
    } else {
      cacheHits++;
    }

    const idx = assets.findIndex((a) => a.id === asset.id);
    const updated: AssetRecord = { ...asset, visual, status: "sampled" };
    await writeAsset(paths, updated);
    assets[idx] = updated;
    processed++;
    totalFrames += visual.frames.length;
  }

  await refreshManifest(paths, config, assets);
  emit(
    { ok: true, processed, frames: totalFrames, cache_hits: cacheHits },
    () => `Sampled ${processed} videos -> ${totalFrames} candidate frames (${cacheHits} cache hits).`,
    opts,
  );
}
