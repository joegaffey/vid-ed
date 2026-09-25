import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { loadConfig, projectPaths } from "../config.js";
import { readManifest, refreshManifest, writeAsset } from "../manifest.js";
import type { AssetRecord } from "../schemas/asset.js";
import {
  PACKET_VERSION,
  RESULTS_VERSION,
  VisionResultsSchema,
  type PacketFrame,
  type VisionPacket,
} from "../schemas/vision.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface AnnotateOptions extends OutputOptions {
  dir: string;
  packetOut?: string;
  ingest?: string;
  assets?: string[];
  window?: number;
}

function resolvePath(root: string, p: string): string {
  return isAbsolute(p) ? p : join(root, p);
}

export async function cmdAnnotate(opts: AnnotateOptions): Promise<void> {
  if (Boolean(opts.packetOut) === Boolean(opts.ingest)) {
    fail("Provide exactly one of --packet-out <file> or --ingest <file>.");
  }
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const manifest = await readManifest(paths);
  if (!manifest) fail("No manifest found. Run `vided scan` first.");

  if (opts.packetOut) {
    await emitPacket(opts, paths.root, manifest, opts.packetOut);
  } else {
    await ingestResults(opts, paths, config, manifest);
  }
}

export function buildPacket(
  assets: AssetRecord[],
  opts: { window: number; filter?: Set<string> },
): PacketFrame[] {
  const frames: PacketFrame[] = [];
  for (const asset of assets) {
    if (opts.filter && !opts.filter.has(asset.id)) continue;
    for (const frame of asset.visual.frames) {
      if (!frame.selected) continue;
      const scene = asset.visual.scenes.find((s) => s.id === frame.scene);
      const [lo, hi] = scene
        ? [scene.start, scene.end]
        : [frame.t - opts.window, frame.t + opts.window];
      const transcript = (asset.extracted.transcript?.segments ?? [])
        .filter((s) => s.end >= lo && s.start <= hi)
        .map((s) => s.text)
        .join(" ")
        .trim();
      frames.push({
        asset: asset.id,
        asset_path: asset.path,
        frame: frame.path,
        t: frame.t,
        ...(frame.scene ? { scene: frame.scene } : {}),
        ...(scene ? { scene_start: scene.start, scene_end: scene.end } : {}),
        ...(transcript ? { transcript } : {}),
        ocr: asset.extracted.ocr,
        description: frame.description ?? null,
      });
    }
  }
  return frames;
}

async function emitPacket(
  opts: AnnotateOptions,
  root: string,
  manifest: NonNullable<Awaited<ReturnType<typeof readManifest>>>,
  packetOut: string,
): Promise<void> {
  const window = opts.window ?? 2;
  const filter = opts.assets?.length ? new Set(opts.assets) : undefined;
  const frames = buildPacket(manifest.assets, { window, filter });

  const packet: VisionPacket = {
    schema: PACKET_VERSION,
    created_at: new Date().toISOString(),
    frames,
  };
  const out = resolvePath(root, packetOut);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(packet, null, 2) + "\n", "utf8");
  emit(
    { ok: true, packet: out, frames: frames.length },
    () => `Wrote vision packet with ${frames.length} frames -> ${out}`,
    opts,
  );
}

async function ingestResults(
  opts: AnnotateOptions,
  paths: ReturnType<typeof projectPaths>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  manifest: NonNullable<Awaited<ReturnType<typeof readManifest>>>,
): Promise<void> {
  const ingestPath = resolvePath(paths.root, opts.ingest!);
  const raw = await readFile(ingestPath, "utf8").catch(() => null);
  if (raw === null) fail(`Cannot read results file ${ingestPath}.`);
  const parsed = VisionResultsSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    fail(`Invalid results file:\n  ${parsed.error.issues.map((i) => i.message).join("\n  ")}`);
  }
  if (parsed.data.schema !== RESULTS_VERSION) fail("Unexpected results schema version.");

  const assets: AssetRecord[] = manifest.assets.map((a) => ({
    ...a,
    tags: [...a.tags],
    visual: { ...a.visual, frames: a.visual.frames.map((f) => ({ ...f, tags: [...(f.tags ?? [])] })) },
  }));

  const index = new Map<string, { asset: number; frame: number }>();
  assets.forEach((a, ai) =>
    a.visual.frames.forEach((f, fi) => index.set(f.path, { asset: ai, frame: fi })),
  );

  let applied = 0;
  const unknown: string[] = [];
  for (const result of parsed.data.frames) {
    const loc = index.get(result.frame);
    if (!loc) {
      unknown.push(result.frame);
      continue;
    }
    const asset = assets[loc.asset]!;
    const frame = asset.visual.frames[loc.frame]!;
    frame.description = result.description;
    frame.tags = [...new Set([...(frame.tags ?? []), ...result.tags])];
    if (result.quality !== undefined) frame.quality = result.quality;
    if (result.in !== undefined) frame.suggested_in = result.in;
    if (result.out !== undefined) frame.suggested_out = result.out;
    asset.tags = [...new Set([...asset.tags, ...result.tags])];
    asset.status = "annotated";
    applied++;
  }

  for (const asset of assets) await writeAsset(paths, asset);
  await refreshManifest(paths, config, assets);

  emit(
    { ok: true, applied, unknown },
    () =>
      `Merged ${applied} frame annotations` +
      (unknown.length ? `; ${unknown.length} unknown frames skipped.` : "."),
    opts,
  );
}
