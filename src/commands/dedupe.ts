import { resolve } from "node:path";
import { loadConfig, projectPaths } from "../config.js";
import { Cache, cacheKey } from "../cache.js";
import { readManifest, refreshManifest, writeAsset } from "../manifest.js";
import { applyBudget, dedupeFrames, densityBudget, type HashableFrame } from "../dedupe.js";
import { hashImage } from "../hash.js";
import type { AssetRecord, VisualFrame } from "../schemas/asset.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface DedupeOptions extends OutputOptions {
  dir: string;
  assets?: string[];
  phashDistance?: number;
  budget?: number;
  totalBudget?: number;
  force?: boolean;
}

export async function cmdDedupe(opts: DedupeOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const manifest = await readManifest(paths);
  if (!manifest) fail("No manifest found. Run `vided scan` first.");

  const maxDist = opts.phashDistance ?? config.dedupe.phash_distance;
  const total = opts.totalBudget ?? config.dedupe.vision_budget_total;

  const cache = new Cache(paths.cacheDir);
  const selectedIds = opts.assets?.length ? new Set(opts.assets) : undefined;

  let hashed = 0;
  let cacheHits = 0;
  const warnings: string[] = [];
  const assets: AssetRecord[] = [];

  for (const asset of manifest.assets) {
    if (!selectedIds || selectedIds.has(asset.id)) {
      if (asset.visual.frames.length) {
        const frames: VisualFrame[] = [];
        for (const frame of asset.visual.frames) {
          if (frame.phash && frame.dhash && !opts.force) {
            frames.push(frame);
            continue;
          }
          const key = cacheKey([asset.content_hash, "framehash", frame.path]);
          let hashes = opts.force
            ? undefined
            : await cache.getJSON<{ phash: string; dhash: string }>(key);
          if (hashes) {
            cacheHits++;
          } else {
            hashes = await hashImage(resolve(paths.root, frame.path));
            await cache.putJSON(key, hashes);
            hashed++;
          }
          frames.push({ ...frame, phash: hashes.phash, dhash: hashes.dhash, selected: false });
        }
        const result = dedupeFrames(frames as HashableFrame[], maxDist);
        const perAsset =
          opts.budget ?? densityBudget(asset.technical.duration_s ?? 0, config.dedupe);
        if (frames.length < perAsset) {
          warnings.push(
            `${asset.path}: ${frames.length} candidates < target ${perAsset}; ` +
              `raise sampling.frames_per_minute to hit the target.`,
          );
        }
        const keep = new Set(applyBudget(result.representatives, perAsset));
        const marked = frames.map((f, i) => ({ ...f, selected: keep.has(i) }));
        assets.push({
          ...asset,
          visual: { ...asset.visual, frames: marked, vision_budget: { max_frames: perAsset, used: keep.size } },
          status: "sampled",
        });
        continue;
      }
    }
    assets.push(asset);
  }

  const globallyDeduped = globalDedupe(assets, maxDist);
  const budgeted = enforceTotalBudget(globallyDeduped, total);

  for (const asset of budgeted) await writeAsset(paths, asset);
  await refreshManifest(paths, config, budgeted);

  const selected = budgeted.reduce(
    (n, a) => n + a.visual.frames.filter((f) => f.selected).length,
    0,
  );
  emit(
    { ok: true, hashed, cache_hits: cacheHits, selected, warnings },
    () =>
      `Hashed ${hashed} frames (${cacheHits} cache hits). ${selected} unique frames selected.` +
      (warnings.length ? `\n${warnings.join("\n")}` : ""),
    opts,
  );
}

function globalDedupe(assets: AssetRecord[], maxDist: number): AssetRecord[] {
  const flat: Array<{ asset: number; frame: number }> = [];
  const hashable: HashableFrame[] = [];
  assets.forEach((a, ai) => {
    a.visual.frames.forEach((f, fi) => {
      if (!f.selected) return;
      flat.push({ asset: ai, frame: fi });
      hashable.push(f as HashableFrame);
    });
  });
  const { representatives } = dedupeFrames(hashable, maxDist);
  const keep = new Set(representatives);
  const out = assets.map((a) => ({ ...a, visual: { ...a.visual, frames: [...a.visual.frames] } }));
  flat.forEach((loc, i) => {
    if (!keep.has(i)) out[loc.asset]!.visual.frames[loc.frame] = {
      ...out[loc.asset]!.visual.frames[loc.frame]!,
      selected: false,
    };
  });
  return out;
}

function enforceTotalBudget(assets: AssetRecord[], total: number): AssetRecord[] {
  let count = 0;
  return assets.map((a) => ({
    ...a,
    visual: {
      ...a.visual,
      frames: a.visual.frames.map((f) => {
        if (!f.selected) return f;
        count++;
        return count <= total ? f : { ...f, selected: false };
      }),
    },
  }));
}
