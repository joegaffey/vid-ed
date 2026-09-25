import { loadConfig, projectPaths } from "../config.js";
import { readManifest } from "../manifest.js";
import { resolveTools } from "../tools/resolve.js";
import type { OutputOptions } from "../ui.js";
import { emit } from "../ui.js";

export interface StatusOptions extends OutputOptions {
  dir: string;
}

const TOKENS_PER_FRAME = 400;

export async function cmdStatus(opts: StatusOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const manifest = await readManifest(paths);
  const tools = await resolveTools(config);

  const byKind: Record<string, number> = {};
  for (const a of manifest?.assets ?? []) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;

  let candidate = 0;
  let selected = 0;
  let annotated = 0;
  for (const a of manifest?.assets ?? []) {
    for (const f of a.visual.frames) {
      candidate++;
      if (f.selected) selected++;
      if (f.description) annotated++;
    }
  }

  const data = {
    project: config.project,
    root: paths.root,
    assets: manifest?.totals.assets ?? 0,
    duration_s: manifest?.totals.duration_s ?? 0,
    unique_frames: manifest?.totals.unique_frames ?? 0,
    by_kind: byKind,
    cost: {
      candidate_frames: candidate,
      selected_frames: selected,
      annotated_frames: annotated,
      estimated_vision_tokens: selected * TOKENS_PER_FRAME,
      tokens_saved_by_dedupe: Math.max(0, candidate - selected) * TOKENS_PER_FRAME,
    },
    tools: Object.fromEntries(tools.map((t) => [t.name, t.available])),
    manifest_present: Boolean(manifest),
  };

  emit(
    data,
    () =>
      [
        `project:        ${data.project}`,
        `assets:         ${data.assets} (${JSON.stringify(byKind)})`,
        `duration:       ${data.duration_s}s`,
        `frames:         ${candidate} candidate -> ${selected} selected -> ${annotated} annotated`,
        `vision:         ~${data.cost.estimated_vision_tokens} tokens (saved ~${data.cost.tokens_saved_by_dedupe})`,
        `tools:          ${Object.entries(data.tools)
          .map(([k, v]) => `${k}=${v ? "ok" : "missing"}`)
          .join(" ")}`,
      ].join("\n"),
    opts,
  );
}
