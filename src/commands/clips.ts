import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { stringify as toYaml } from "yaml";
import { projectPaths } from "../config.js";
import { makeSourceResolver, readManifest } from "../manifest.js";
import { CLIPS_FILE, deriveClips, hasPlaceableMedia, loadClips } from "../clips.js";
import { ClipsSchema, GENERATED_SOURCE, type Clip, type ClipInput } from "../schemas/clips.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface ClipsOptions extends OutputOptions {
  dir: string;
  out: string;
  assets?: string[];
  force?: boolean;
  check?: boolean;
  add?: string[];
  remove?: string[];
  set?: string[];
  mergeGap?: number;
  frameGap?: number;
  pad?: number;
}

function validate(
  clips: Clip[],
  resolve: (source: string) => { duration?: number } | undefined,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const c of clips) {
    if (ids.has(c.id)) errors.push(`duplicate clip id "${c.id}".`);
    ids.add(c.id);
    if (c.source !== GENERATED_SOURCE) {
      const src = resolve(c.source);
      if (!src) errors.push(`clip "${c.id}" source "${c.source}" not found.`);
      else if (c.kind === "video" && src.duration !== undefined && c.out > src.duration + 0.05) {
        warnings.push(`clip "${c.id}" out (${c.out}s) exceeds source duration (${src.duration.toFixed(2)}s).`);
      }
    } else if (c.kind !== "title" && c.kind !== "slide") {
      warnings.push(`clip "${c.id}" is kind ${c.kind} but source is "${GENERATED_SOURCE}".`);
    }
    if (c.kind === "video" && c.out <= c.in) errors.push(`clip "${c.id}" has out <= in.`);
    if (c.kind === "audio" && c.out !== undefined && c.out <= c.in) errors.push(`clip "${c.id}" has out <= in.`);
  }
  return { errors, warnings };
}

export async function cmdClips(opts: ClipsOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const manifest = await readManifest(paths);
  if (!manifest) fail("No manifest found. Run `vided scan` first.");
  const resolve = makeSourceResolver(paths, manifest);
  const outPath = isAbsolute(opts.out) ? opts.out : join(paths.root, opts.out);

  if (opts.check) {
    const clips = await loadClips(paths);
    if (!clips) fail(`No ${CLIPS_FILE} found. Run \`vided clips\` first.`);
    const { errors, warnings } = validate(clips.clips, resolve);
    emit(
      { ok: errors.length === 0, count: clips.clips.length, errors, warnings },
      () => {
        const lines = [`${clips.clips.length} clips`];
        for (const e of errors) lines.push(`error: ${e}`);
        for (const w of warnings) lines.push(`warn:  ${w}`);
        return lines.join("\n");
      },
      opts,
    );
    if (errors.length) process.exit(1);
    return;
  }

  // Mutation / seeding: load or start empty, apply ops, then write.
  let existing: ClipInput[] = [];
  try {
    existing = (await loadClips(paths))?.clips ?? [];
  } catch {
    existing = [];
  }
  let clips: ClipInput[] = existing;

  // Mutate in a predictable order: remove, then set, then add (so an add is
  // never clobbered by a co-supplied remove).
  if (opts.remove?.length) {
    const rm = new Set(opts.remove);
    clips = clips.filter((c) => !rm.has(c.id));
  }
  if (opts.set) {
    for (const spec of opts.set) {
      const eq = spec.indexOf("=");
      if (eq < 0) fail(`--set expects <id>=<json patch>.`);
      const id = spec.slice(0, eq);
      const patch = JSON.parse(spec.slice(eq + 1));
      let found = false;
      clips = clips.map((c) => {
        if (c.id !== id) return c;
        found = true;
        return { ...c, ...patch };
      });
      if (!found) fail(`No clip "${id}" to set.`);
    }
  }
  if (opts.add?.length) {
    for (const spec of opts.add) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(spec);
      } catch (err) {
        fail(`--add expects JSON: ${(err as Error).message}`);
      }
      clips = [...clips, ClipsSchema.parse({ schema: "vided.clips/1", clips: [parsed] }).clips[0]!];
    }
  }

  const mutating = Boolean(opts.add?.length || opts.set || opts.remove?.length);
  if (!mutating) {
    if (!hasPlaceableMedia(manifest)) {
      emit({ ok: true, clips: 0, out: outPath }, () => "No placeable media — nothing to derive.", opts);
      return;
    }
    if (existsSync(outPath) && !opts.force) {
      emit(
        { ok: true, out: outPath, existed: true },
        () => `${outPath} already exists (use --force to regenerate derived clips).`,
        opts,
      );
      return;
    }
    const derived = deriveClips(manifest, {
      assets: opts.assets,
      mergeGap: opts.mergeGap,
      frameGap: opts.frameGap,
      pad: opts.pad,
    });
    const authored = clips.filter((c) => (c as { origin?: string }).origin !== "derived");
    const authoredIds = new Set(authored.map((c) => c.id));
    clips = [...authored, ...derived.filter((c) => !authoredIds.has(c.id))];
  }

  const parsed = ClipsSchema.parse({ schema: "vided.clips/1", clips });
  await mkdir(dirname(outPath), { recursive: true });
  const header = [
    "# vided clips — the pool every edit composes from.",
    "# Each clip declares an output `format` from the canonical set (see AGENTS.md).",
    "# kind: video | image | audio | title | slide; generated kinds use source: generated.",
    "",
  ].join("\n");
  await writeFile(outPath, header + toYaml(parsed), "utf8");

  const { errors, warnings } = validate(parsed.clips, resolve);
  emit(
    { ok: errors.length === 0, out: outPath, clips: parsed.clips.length, errors, warnings },
    () => {
      const lines = [`Wrote ${parsed.clips.length} clips -> ${outPath}`];
      for (const e of errors) lines.push(`error: ${e}`);
      for (const w of warnings) lines.push(`warn:  ${w}`);
      return lines.join("\n");
    },
    opts,
  );
  if (errors.length) process.exit(1);
}
