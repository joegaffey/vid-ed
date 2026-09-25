import { loadConfig, projectPaths } from "../config.js";
import { Cache, cacheKey } from "../cache.js";
import { readManifest, refreshManifest, writeAsset } from "../manifest.js";
import type { AssetRecord, Transcript } from "../schemas/asset.js";
import { findSidecar, ocrImage, readSidecar, transcribe } from "../text.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";
import { resolve } from "node:path";

export interface ExtractTextOptions extends OutputOptions {
  dir: string;
  assets?: string[];
  ocr?: boolean;
  model?: string;
  language?: string;
  force?: boolean;
}

export async function cmdExtractText(opts: ExtractTextOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const manifest = await readManifest(paths);
  if (!manifest) fail("No manifest found. Run `vided scan` first.");

  const cache = new Cache(paths.cacheDir);
  const selected = opts.assets?.length
    ? manifest.assets.filter((a) => opts.assets!.includes(a.id))
    : manifest.assets;

  const assets: AssetRecord[] = [...manifest.assets];
  let processed = 0;
  let cacheHits = 0;

  for (const asset of selected) {
    const idx = assets.findIndex((a) => a.id === asset.id);
    const updated: AssetRecord = { ...asset, extracted: { ...asset.extracted } };

    if (asset.kind === "video" || asset.kind === "audio") {
      const model = opts.model ?? config.transcription.model ?? "";
      const language = opts.language ?? config.transcription.language;
      const key = cacheKey([asset.content_hash, "transcribe", model, language]);
      let transcript = opts.force ? undefined : await cache.getJSON<Transcript>(key);
      if (transcript) {
        cacheHits++;
      } else {
        transcript = await transcribe(config, resolve(paths.root, asset.path), {
          model: opts.model,
          language: opts.language,
        });
        await cache.putJSON(key, transcript);
      }
      updated.extracted.transcript = transcript;
      updated.extracted.language = transcript.language;
      const sidecar = findSidecar(resolve(paths.root, asset.path));
      if (sidecar) updated.extracted.sidecar = await readSidecar(sidecar);
    } else if (asset.kind === "image" && opts.ocr) {
      const key = cacheKey([asset.content_hash, "ocr"]);
      let text = opts.force ? undefined : await cache.getText(key);
      if (text !== undefined) {
        cacheHits++;
      } else {
        text = await ocrImage(resolve(paths.root, asset.path));
        await cache.putText(key, text);
      }
      updated.extracted.ocr = text;
    } else if (asset.kind === "text") {
      updated.extracted.sidecar = await readSidecar(resolve(paths.root, asset.path));
    } else {
      continue;
    }

    updated.status = "extracted";
    await writeAsset(paths, updated);
    assets[idx] = updated;
    processed++;
  }

  await refreshManifest(paths, config, assets);
  emit(
    { ok: true, processed, cache_hits: cacheHits },
    () => `Extracted text for ${processed} assets (${cacheHits} cache hits).`,
    opts,
  );
}
