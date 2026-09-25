import { loadConfig, projectPaths } from "../config.js";
import { resolveTools } from "../tools/resolve.js";
import type { OutputOptions } from "../ui.js";
import { emit } from "../ui.js";

export interface DoctorOptions extends OutputOptions {
  dir: string;
  installMissing?: boolean;
}

export async function cmdDoctor(opts: DoctorOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  const config = await loadConfig(paths);
  const tools = await resolveTools(config);
  const ok = tools.every((t) => t.available || !t.required);

  emit(
    { ok, tools },
    () =>
      tools
        .map((t) => {
          const mark = t.available ? "ok  " : t.required ? "FAIL" : "warn";
          const detail = t.available
            ? `${t.path} ${t.version ?? ""}`.trim()
            : `${t.error ?? "not found"}${t.required ? " (required)" : " (optional)"}`;
          return `${mark} ${t.name.padEnd(8)} ${detail}`;
        })
        .join("\n"),
    opts,
  );
  if (!ok) process.exit(1);
}
