import { existsSync } from "node:fs";
import { loadConfig, projectPaths, writeConfig } from "../config.js";
import {
  fetchVoices,
  installPiper,
  installVoice,
  listInstalledVoices,
  piperPaths,
} from "../models.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface ModelsOptions extends OutputOptions {
  dir: string;
  install?: string;
  voice?: string;
  force?: boolean;
  list?: boolean;
}

export async function cmdModels(opts: ModelsOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const { bin } = piperPaths(paths);
  const install = opts.install?.toLowerCase();

  const wantsList = opts.list || (!install && !opts.voice);
  if (wantsList) {
    const voices = await listInstalledVoices(paths);
    const data = {
      piper: { installed: existsSync(bin), path: bin, configured: config.tools.piper ?? null },
      voices,
      voice_dir: paths.modelsDir + "/piper",
    };
    emit(
      data,
      () =>
        [
          `piper:  ${data.piper.installed ? bin : "not installed"} (config: ${config.tools.piper ?? "unset"})`,
          `voices: ${voices.length ? voices.join(", ") : "none"}`,
          `dir:    ${data.voice_dir}`,
        ].join("\n"),
      opts,
    );
    return;
  }

  const doPiper = install === "piper" || install === "all";
  const doVoice = install === "voice" || install === "all" || (!install && Boolean(opts.voice));
  if (install && !doPiper && !doVoice) {
    fail(`Unknown install target "${opts.install}". Use "piper", "voice", or "all".`);
  }

  const result: Record<string, unknown> = { ok: true };

  if (doPiper) {
    const r = await installPiper(paths, { force: opts.force });
    config.tools.piper = r.path;
    await writeConfig(paths, config);
    result.piper = r;
  }

  if (doVoice) {
    const voice = opts.voice;
    if (!voice) fail("Provide --voice <id> (e.g. en_US-amy-medium).");
    const r = await installVoice(paths, voice, { force: opts.force });
    config.tts.voice = voice;
    await writeConfig(paths, config);
    result.voice = r;
  }

  emit(
    result,
    () => {
      const lines: string[] = [];
      if (result.piper) {
        const p = result.piper as { path: string; version?: string };
        lines.push(`Installed piper ${p.version ?? ""} -> ${p.path}`);
      }
      if (result.voice) {
        const v = result.voice as { voice: string; dir: string };
        lines.push(`Installed voice ${v.voice} -> ${v.dir}`);
      }
      lines.push("config updated (.vided/config.json)");
      return lines.join("\n");
    },
    opts,
  );
}

export async function cmdVoicesSearch(query: string, opts: OutputOptions & { dir: string }): Promise<void> {
  const voices = await fetchVoices();
  const q = query.toLowerCase();
  const matches = Object.keys(voices)
    .filter((k) => k.toLowerCase().includes(q))
    .slice(0, 40);
  emit(
    { query, count: matches.length, voices: matches },
    () => (matches.length ? matches.join("\n") : `No voices matching "${query}".`),
    opts,
  );
}
