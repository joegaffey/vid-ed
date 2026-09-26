import { loadConfig, projectPaths } from "../config.js";
import type { OutputOptions } from "../ui.js";
import { emit } from "../ui.js";

export interface StudioOptions extends OutputOptions {
  dir: string;
  port?: number;
  host?: string;
}

export async function cmdStudio(opts: StudioOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  await loadConfig(paths); // require an initialised project

  const { createStudioServer } = await import("../server/index.js");
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 5173;

  const server = await createStudioServer({ root: paths.root, port, host });

  emit(
    { ok: true, url: server.url, root: paths.root },
    () => `vided studio → ${server.url}\nproject: ${paths.root}\nCtrl+C to stop.`,
    opts,
  );

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
