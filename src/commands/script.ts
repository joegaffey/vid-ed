import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { stringify as toYaml } from "yaml";
import { loadConfig, projectPaths } from "../config.js";
import { readManifest } from "../manifest.js";
import { loadBrief, loadAssetNotes } from "../context.js";
import { NarrationScriptSchema, type NarrationScript } from "../schemas/narration.js";
import type { Manifest } from "../schemas/manifest.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface ScriptOptions extends OutputOptions {
  dir: string;
  out: string;
  assets?: string[];
  gap?: number;
  voice?: string;
}

export interface ScaffoldSegment {
  id: string;
  text: string;
  start: number;
  gap_after: number;
  note?: string;
}

/**
 * Deterministic scaffold: one narration segment per annotated (described,
 * selected) frame, in time order, with `start` at the frame timestamp.
 * Per-input notes are carried through as `note`. The agent rewrites the prose;
 * the timing mapping is mechanical.
 */
export function buildScaffold(
  manifest: Manifest,
  opts: { assets?: string[]; gap?: number; voice?: string; notes?: Record<string, string> },
): NarrationScript {
  const gap = opts.gap ?? 0.3;
  const filter = opts.assets?.length ? new Set(opts.assets) : undefined;
  const segments: ScaffoldSegment[] = [];

  for (const asset of manifest.assets) {
    if (filter && !filter.has(asset.id)) continue;
    const note = opts.notes?.[asset.id] ?? asset.notes;
    const frames = asset.visual.frames
      .filter((f) => f.selected && f.description)
      .sort((a, b) => a.t - b.t);
    frames.forEach((f, i) => {
      segments.push({
        id: `${asset.id}-f${i}`,
        text: f.description!,
        start: Number(f.t.toFixed(3)),
        gap_after: gap,
        ...(note ? { note } : {}),
      });
    });
  }

  return NarrationScriptSchema.parse({
    schema: "vided.narration/1",
    ...(opts.voice ? { voice: opts.voice } : {}),
    segments,
  });
}

export async function cmdScript(opts: ScriptOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const manifest = await readManifest(paths);
  if (!manifest) fail("No manifest found. Run `vided scan` first.");

  const brief = await loadBrief(paths);
  const notes = await loadAssetNotes(paths, manifest);
  const script = buildScaffold(manifest, {
    assets: opts.assets,
    gap: opts.gap,
    voice: opts.voice ?? config.tts.voice,
    notes,
  });
  if (!script.segments.length) {
    fail("No annotated frames found. Run `vided annotate --ingest` first.");
  }

  const out = isAbsolute(opts.out) ? opts.out : join(paths.root, opts.out);
  await mkdir(dirname(out), { recursive: true });
  const header = [
    "# vided narration scaffold — one segment per annotated frame.",
    "# Edit the prose, merge beats, and adjust `start`/`gap_after` as needed.",
    "# Then: vided tts narration.yaml",
    ...(brief ? ["#", "# Project brief:", ...brief.split("\n").map((l) => `#   ${l}`)] : []),
    "",
  ].join("\n");
  await writeFile(out, header + toYaml(script), "utf8");

  emit(
    { ok: true, out, segments: script.segments.length, brief: Boolean(brief), noted_assets: Object.keys(notes).length },
    () => `Wrote narration scaffold with ${script.segments.length} segments -> ${out}`,
    opts,
  );
}
