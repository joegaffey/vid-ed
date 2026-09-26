import { projectPaths } from "../config.js";
import { readManifest, makeSourceResolver } from "../manifest.js";
import { loadClips, clipsById } from "../clips.js";
import { explainEdl, lintEdl, loadEdlFile, resolveEdl } from "../edl.js";
import type { OutputOptions } from "../ui.js";
import { emit } from "../ui.js";

export interface ComposeOptions extends OutputOptions {
  dir: string;
  file: string;
  check?: boolean;
  explain?: boolean;
  lint?: boolean;
}

export async function cmdCompose(opts: ComposeOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const manifest = await readManifest(paths);
  const resolver = makeSourceResolver(paths, manifest);
  const clips = clipsById((await loadClips(paths))?.clips);

  const result = await loadEdlFile(opts.file);
  const doCheck = opts.check || (!opts.explain && !opts.lint);
  const doExplain = opts.explain || (!opts.check && !opts.lint);
  const doLint = opts.lint || (!opts.check && !opts.explain);

  const resolved = result.edl ? resolveEdl(result.edl, clips) : undefined;
  const parseErrors = result.errors;
  const resolveErrors = resolved?.errors ?? [];
  const errors = [...parseErrors, ...resolveErrors];

  const out: Record<string, unknown> = { ok: errors.length === 0 };
  if (doCheck) out.check = { ok: errors.length === 0, errors };

  let hasErrors = errors.length > 0;
  if (resolved?.ok && resolved.resolved) {
    if (doExplain) out.explain = explainEdl(resolved.resolved, resolver);
    if (doLint) {
      const issues = lintEdl(resolved.resolved, resolver);
      out.lint = {
        ok: !issues.some((i) => i.level === "error"),
        errors: issues.filter((i) => i.level === "error"),
        warnings: issues.filter((i) => i.level === "warning"),
      };
      if (issues.some((i) => i.level === "error")) hasErrors = true;
    }
  } else if (doLint) {
    out.lint = { ok: false, errors: [{ level: "error", message: "EDL did not resolve." }], warnings: [] };
  }

  const human = (): string => {
    const lines: string[] = [];
    if (errors.length) {
      lines.push("check: FAILED");
      for (const e of errors) lines.push(`  - ${e}`);
      return lines.join("\n");
    }
    lines.push("check: ok");
    if (out.explain) {
      const ex = out.explain as ReturnType<typeof explainEdl>;
      lines.push(`timeline: ${ex.clip_count} clips, ${ex.duration}s @ ${ex.output.format}`);
      for (const c of ex.clips) {
        lines.push(`  ${c.start}s -> ${c.end}s  ${c.id} (${c.kind}: ${c.source} [${c.format}])`);
      }
      lines.push(`audio: clips=${ex.audio.clips} attached=${ex.audio.attached}`);
      lines.push(`overlays: ${ex.overlays.total}`);
    }
    if (out.lint) {
      const l = out.lint as { errors: unknown[]; warnings: unknown[] };
      for (const e of l.errors) lines.push(`error: ${(e as { message: string }).message}`);
      for (const w of l.warnings) lines.push(`warn:  ${(w as { message: string }).message}`);
    }
    return lines.join("\n");
  };

  emit(out, human, opts);
  if (hasErrors) process.exit(1);
}
