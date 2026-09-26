import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { configHash, loadConfig, projectPaths } from "../config.js";
import {
  assetId,
  extOf,
  ffprobe,
  hashFile,
  kindFromExt,
  MEDIA_EXTENSIONS,
  statFile,
} from "../probe.js";
import { buildManifest, readAsset, writeAsset, writeManifest } from "../manifest.js";
import type { AssetRecord } from "../schemas/asset.js";
import { SCHEMA_VERSION } from "../schemas/asset.js";
import { requireTool } from "../tools/resolve.js";
import type { OutputOptions } from "../ui.js";
import { emit } from "../ui.js";

export interface ScanOptions extends OutputOptions {
  dir: string;
  inputs: string[];
  fastHash?: boolean;
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === ".vided" || e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await rec(full);
      else if (e.isFile()) out.push(full);
    }
  }
  await rec(root);
  return out;
}

/**
 * Re-scanning re-probes an asset but must not discard derived or authored data
 * (frames, transcript, annotations, tags, notes) for an unchanged file.
 */
export function preserveDerived(
  existing: AssetRecord | undefined,
  probed: AssetRecord,
): AssetRecord {
  if (!existing || existing.content_hash !== probed.content_hash) return probed;
  return {
    ...probed,
    extracted: existing.extracted,
    visual: existing.visual,
    tags: existing.tags,
    ...(existing.summary ? { summary: existing.summary } : {}),
    ...(existing.title ? { title: existing.title } : {}),
    ...(existing.role ? { role: existing.role } : {}),
    ...(existing.notes ? { notes: existing.notes } : {}),
    status: existing.status,
  };
}

export async function cmdScan(opts: ScanOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  await requireTool(config, "ffprobe");

  const roots = (opts.inputs.length ? opts.inputs : config.input_roots).map((r) =>
    isAbsolute(r) ? r : resolve(paths.root, r),
  );

  const assets: AssetRecord[] = [];
  let skipped = 0;

  for (const root of roots) {
    let files: string[] = [];
    try {
      files = await walk(root);
    } catch {
      continue;
    }
    for (const file of files) {
      const ext = extOf(file);
      if (!MEDIA_EXTENSIONS.has(ext.toLowerCase())) {
        skipped++;
        continue;
      }
      const kind = kindFromExt(ext);
      const [contentHash, stats] = await Promise.all([hashFile(file), statFile(file)]);
      const id = assetId(contentHash);

      let technical = {};
      if (kind === "video" || kind === "audio" || kind === "image") {
        try {
          technical = await ffprobe(config, file);
        } catch {
          // ffprobe failed (e.g. corrupt); keep the asset with empty technical.
        }
      }

      const asset: AssetRecord = preserveDerived(
        await readAsset(paths, id).catch(() => undefined),
        {
          schema: SCHEMA_VERSION,
          id,
          path: relative(paths.root, file),
          kind,
          content_hash: contentHash,
          bytes: stats.bytes,
          mtime: stats.mtime,
          status: "probed",
          technical,
          extracted: { transcript: null, ocr: null, sidecar: null },
          visual: { scenes: [], frames: [] },
          tags: [],
          provenance: {
            tool: "vided",
            version: "0.1.0",
            generated_at: new Date().toISOString(),
          },
        },
      );
      await writeAsset(paths, asset);
      assets.push(asset);
    }
  }

  const manifest = buildManifest(assets, {
    project: config.project,
    input_roots: config.input_roots,
    config_hash: configHash(config),
  });
  await writeManifest(paths, manifest);

  emit(
    { ok: true, scanned: assets.length, skipped, totals: manifest.totals },
    () =>
      `Scanned ${assets.length} assets (${skipped} skipped). ` +
      `Total duration ${manifest.totals.duration_s}s.`,
    opts,
  );
}
