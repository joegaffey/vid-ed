import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { loadConfig, projectPaths } from "../config.js";
import { readAllAssets, refreshManifest } from "../manifest.js";
import { loadBrief, loadAssetNotes, loadContextInput, buildContextPack } from "../context.js";
import { CLIPS_FILE, hasPlaceableMedia, loadClips } from "../clips.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface ManifestOptions extends OutputOptions {
  dir: string;
  contextPack?: string;
  maxChars?: number;
}

export async function cmdManifest(opts: ManifestOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const assets = await readAllAssets(paths);
  if (!assets.length) fail("No assets found. Run `vided scan` first.");
  const manifest = await refreshManifest(paths, config, assets);

  const result: Record<string, unknown> = {
    ok: true,
    manifest: paths.manifest,
    totals: manifest.totals,
  };

  if (opts.contextPack) {
    const context = await loadContextInput(paths);
    const brief = await loadBrief(paths);
    const notes = await loadAssetNotes(paths, manifest, context);
    const clips = await loadClips(paths);
    if (hasPlaceableMedia(manifest) && !clips) {
      fail(`No ${CLIPS_FILE} found (project has placeable media). Run \`vided clips\` first.`);
    }
    const pack = buildContextPack(manifest, {
      maxChars: opts.maxChars,
      brief,
      notes,
      context,
      clips: clips?.clips,
    });
    const mdPath = isAbsolute(opts.contextPack)
      ? opts.contextPack
      : join(paths.root, opts.contextPack);
    const jsonPath = mdPath.replace(/\.md$/, "") + ".json";
    await mkdir(dirname(mdPath), { recursive: true });
    await writeFile(mdPath, pack.markdown, "utf8");
    await writeFile(jsonPath, JSON.stringify(pack.json, null, 2) + "\n", "utf8");
    result.context_pack = {
      markdown: mdPath,
      json: jsonPath,
      chars: pack.chars,
      truncated: pack.truncated,
      brief: Boolean(brief),
      noted_assets: Object.keys(notes).length,
      clips: clips?.clips.length ?? 0,
    };
  }

  emit(
    result,
    () => {
      const lines = [
        `manifest: ${manifest.totals.assets} assets, ${manifest.totals.duration_s}s, ` +
          `${manifest.totals.unique_frames} selected frames`,
      ];
      if (result.context_pack) {
        const cp = result.context_pack as { markdown: string; chars: number; truncated: boolean };
        lines.push(`context:  ${cp.markdown} (${cp.chars} chars${cp.truncated ? ", truncated" : ""})`);
      }
      return lines.join("\n");
    },
    opts,
  );
}
