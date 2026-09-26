import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { execa } from "execa";
import { loadConfig, projectPaths } from "../config.js";
import { makeSourceResolver, readManifest } from "../manifest.js";
import { clipsById, loadClips } from "../clips.js";
import { lintEdl, loadEdlFile, resolveEdl } from "../edl.js";
import { buildRenderPlan } from "../render.js";
import { renderClipPreview } from "../preview.js";
import { requireTool } from "../tools/resolve.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface RenderOptions extends OutputOptions {
  dir: string;
  file?: string;
  clip?: string;
  dryRun?: boolean;
  preview?: boolean;
  output?: string;
}

export async function cmdRender(opts: RenderOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const ffmpeg = await requireTool(config, "ffmpeg");
  const manifest = await readManifest(paths);
  const resolver = makeSourceResolver(paths, manifest);

  if (opts.clip) {
    const pool = await loadClips(paths);
    const clip = pool?.clips.find((c) => c.id === opts.clip);
    if (!clip) fail(`No clip "${opts.clip}" in ${paths.root}/clips.yaml.`);
    const r = await renderClipPreview({ paths, manifest, ffmpeg, clip });
    emit(
      { ok: true, clip: clip.id, output: r.path, cached: r.cached },
      () => `${r.cached ? "cached" : "rendered"} ${clip.id} -> ${r.path}`,
      opts,
    );
    return;
  }

  if (!opts.file) fail("Provide an edit file, or --clip <id> to preview a clip.");
  const pool = await loadClips(paths);
  const file = isAbsolute(opts.file) ? opts.file : join(paths.root, opts.file);
  const loaded = await loadEdlFile(file);
  if (!loaded.ok || !loaded.edl) fail(`Invalid edit file:\n  ${loaded.errors.join("\n  ")}`);
  const resolved = resolveEdl(loaded.edl, clipsById(pool?.clips));
  if (!resolved.ok || !resolved.resolved) fail(`Unresolved edit:\n  ${resolved.errors.join("\n  ")}`);
  const edl = resolved.resolved;

  const lintErrors = lintEdl(edl, resolver).filter((i) => i.level === "error");
  if (lintErrors.length) fail(`Edit has errors:\n  ${lintErrors.map((i) => i.message).join("\n  ")}`);

  const rawOut = opts.output ?? edl.output.path;
  const outputPath = isAbsolute(rawOut) ? rawOut : resolve(paths.root, rawOut);

  const plan = buildRenderPlan(edl, {
    root: paths.root,
    resolveSource: resolver,
    ffmpeg,
    workDir: paths.workDir,
    preview: opts.preview,
    outputOverride: outputPath,
  });

  if (opts.dryRun) {
    emit(
      {
        ok: true,
        dry_run: true,
        output: outputPath,
        duration: plan.duration,
        warnings: plan.warnings,
        artifacts: plan.artifacts.map((a) => a.path),
        command: [ffmpeg, ...plan.args],
      },
      () => `${ffmpeg} ${plan.args.join(" ")}`,
      opts,
    );
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  for (const artifact of plan.artifacts) {
    await mkdir(dirname(artifact.path), { recursive: true });
    await writeFile(artifact.path, artifact.content, "utf8");
  }
  const res = await execa(ffmpeg, plan.args, { reject: false, cwd: paths.root });
  if (res.exitCode !== 0) {
    process.stderr.write(res.stderr + "\n");
    fail(`ffmpeg failed with exit code ${res.exitCode}.`);
  }

  emit(
    {
      ok: true,
      output: outputPath,
      duration: plan.duration,
      warnings: plan.warnings,
      command: [ffmpeg, ...plan.args],
    },
    () => `Rendered ${plan.duration}s -> ${outputPath}`,
    opts,
  );
}
