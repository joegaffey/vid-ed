import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadConfig, projectPaths } from "../config.js";
import { NarrationScriptSchema } from "../schemas/narration.js";
import { synthesizeNarration } from "../tts.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface TtsOptions extends OutputOptions {
  dir: string;
  script: string;
  voice?: string;
  engine?: string;
  output?: string;
  force?: boolean;
}

export async function cmdTts(opts: TtsOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);

  const raw = await readFile(resolve(paths.root, opts.script), "utf8").catch(() => null);
  if (raw === null) fail(`Cannot read narration script ${opts.script}.`);
  const parsed = NarrationScriptSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    fail(`Invalid narration script:\n  ${parsed.error.issues.map((i) => i.message).join("\n  ")}`);
  }

  const timing = await synthesizeNarration(config, paths, parsed.data, {
    voice: opts.voice,
    engine: opts.engine,
    output: opts.output,
    force: opts.force,
  });

  emit(
    {
      ok: true,
      audio: timing.audio,
      timing: timing.audio.replace(/\.wav$/, "") + ".timing.json",
      duration: timing.duration,
      segments: timing.segments.length,
    },
    () =>
      `Synthesised ${timing.segments.length} segments -> ${timing.audio} (${timing.duration}s).`,
    opts,
  );
}
