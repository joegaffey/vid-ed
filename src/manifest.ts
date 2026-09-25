import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { configHash, type Config, type Paths } from "./config.js";
import type { AssetRecord } from "./schemas/asset.js";
import { AssetRecordSchema } from "./schemas/asset.js";
import { ManifestSchema, type Manifest } from "./schemas/manifest.js";

export async function writeAsset(paths: Paths, asset: AssetRecord): Promise<void> {
  await mkdir(paths.assetsDir, { recursive: true });
  await writeFile(
    join(paths.assetsDir, `${asset.id}.json`),
    JSON.stringify(asset, null, 2) + "\n",
    "utf8",
  );
}

export async function readAsset(paths: Paths, id: string): Promise<AssetRecord> {
  const raw = JSON.parse(await readFile(join(paths.assetsDir, `${id}.json`), "utf8"));
  return AssetRecordSchema.parse(raw);
}

export function buildManifest(
  assets: AssetRecord[],
  meta: { project: string; input_roots: string[]; config_hash: string },
): Manifest {
  return ManifestSchema.parse({
    schema: "vided.manifest/1",
    project: meta.project,
    created_at: new Date().toISOString(),
    input_roots: meta.input_roots,
    config_hash: meta.config_hash,
    assets,
    totals: {
      assets: assets.length,
      duration_s: Number(
        assets.reduce((n, a) => n + (a.technical.duration_s ?? 0), 0).toFixed(3),
      ),
      unique_frames: assets.reduce(
        (n, a) => n + a.visual.frames.filter((f) => f.selected).length,
        0,
      ),
    },
  });
}

export async function writeManifest(paths: Paths, manifest: Manifest): Promise<void> {
  await writeFile(paths.manifest, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

export async function readManifest(paths: Paths): Promise<Manifest | undefined> {
  if (!existsSync(paths.manifest)) return undefined;
  const raw = JSON.parse(await readFile(paths.manifest, "utf8"));
  return ManifestSchema.parse(raw);
}

export async function readAllAssets(paths: Paths): Promise<AssetRecord[]> {
  if (!existsSync(paths.assetsDir)) return [];
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(paths.assetsDir)).filter((f) => f.endsWith(".json")).sort();
  const assets: AssetRecord[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(paths.assetsDir, file), "utf8"));
    assets.push(AssetRecordSchema.parse(raw));
  }
  return assets;
}

export async function refreshManifest(
  paths: Paths,
  config: Config,
  assets: AssetRecord[],
): Promise<Manifest> {
  const manifest = buildManifest(assets, {
    project: config.project,
    input_roots: config.input_roots,
    config_hash: configHash(config),
  });
  await writeManifest(paths, manifest);
  return manifest;
}

export function makeSourceResolver(
  paths: Paths,
  manifest?: Manifest,
): (source: string) => { path: string; kind?: string; duration?: number } | undefined {
  const byId = new Map((manifest?.assets ?? []).map((a) => [a.id, a]));
  return (source: string) => {
    const asset = byId.get(source);
    if (asset) {
      return {
        path: join(paths.root, asset.path),
        kind: asset.kind,
        duration: asset.technical.duration_s,
      };
    }
    const p = isAbsolute(source) ? source : join(paths.root, source);
    if (existsSync(p)) return { path: p };
    return undefined;
  };
}
