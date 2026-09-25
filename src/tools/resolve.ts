import { execa } from "execa";
import type { Config } from "../config.js";

export type ToolName = "ffmpeg" | "ffprobe" | "whisper" | "piper";

export interface ToolStatus {
  name: ToolName;
  available: boolean;
  path?: string;
  version?: string;
  required: boolean;
  error?: string;
}

const DEFAULTS: Record<ToolName, string> = {
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
  whisper: "whisper-cli",
  piper: "piper",
};

const REQUIRED: Record<ToolName, boolean> = {
  ffmpeg: true,
  ffprobe: true,
  whisper: false,
  piper: false,
};

async function probeTool(name: ToolName, bin: string): Promise<ToolStatus> {
  let lastError = `could not run ${bin}`;
  for (const args of [["--version"], ["-version"], ["-h"]]) {
    try {
      const res = await execa(bin, args, { reject: false, stdin: "ignore", timeout: 5000 });
      if (res.code === "ENOENT" || (res.failed && res.exitCode === undefined && !res.timedOut)) {
        return { name, available: false, required: REQUIRED[name], error: `not found: ${bin}` };
      }
      if (res.timedOut) {
        lastError = `${bin} timed out`;
        continue;
      }
      const first = (res.stdout || res.stderr).split("\n")[0] ?? "";
      const version = first.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? first.trim();
      return { name, available: true, path: bin, version, required: REQUIRED[name] };
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") {
        return { name, available: false, required: REQUIRED[name], error: `not found: ${bin}` };
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { name, available: false, required: REQUIRED[name], error: lastError };
}

export async function resolveTools(config: Config): Promise<ToolStatus[]> {
  const names: ToolName[] = ["ffmpeg", "ffprobe", "whisper", "piper"];
  return Promise.all(
    names.map((n) => probeTool(n, config.tools[n] ?? DEFAULTS[n])),
  );
}

export async function requireTool(config: Config, name: ToolName): Promise<string> {
  const bin = config.tools[name] ?? DEFAULTS[name];
  const status = await probeTool(name, bin);
  if (!status.available) {
    throw new Error(
      `Tool "${name}" not found (tried "${bin}"). ` +
        `Install it or set tools.${name} in .vided/config.json.`,
    );
  }
  return bin;
}
