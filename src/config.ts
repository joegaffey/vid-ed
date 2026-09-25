import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

export const VIDE_DIR = ".vided";

export const ConfigSchema = z.object({
  schema: z.literal("vided.config/1").default("vided.config/1"),
  project: z.string().default("untitled"),
  input_roots: z.array(z.string()).default(["input"]),
  profile: z.string().default("default"),
  tools: z
    .object({
      ffmpeg: z.string().optional(),
      ffprobe: z.string().optional(),
      whisper: z.string().optional(),
      piper: z.string().optional(),
    })
    .default({}),
  sampling: z
    .object({
      frames_per_minute: z.number().default(30),
      every_s: z.number().optional(),
      scene_threshold: z.number().default(0.25),
      max_width: z.number().int().default(512),
    })
    .default({ frames_per_minute: 30, scene_threshold: 0.25, max_width: 512 }),
  transcription: z
    .object({
      model: z.string().optional(),
      language: z.string().default("auto"),
      threads: z.number().int().default(4),
    })
    .default({ language: "auto", threads: 4 }),
  tts: z
    .object({
      engine: z.enum(["piper", "kokoro"]).default("piper"),
      voice: z.string().optional(),
    })
    .default({ engine: "piper" }),
  dedupe: z
    .object({
      phash_distance: z.number().int().default(6),
      target_frames_per_minute: z.number().default(6),
      min_frames_per_asset: z.number().int().default(2),
      max_frames_per_asset: z.number().int().default(60),
      vision_budget_total: z.number().int().default(200),
    })
    .default({
      phash_distance: 6,
      target_frames_per_minute: 6,
      min_frames_per_asset: 2,
      max_frames_per_asset: 60,
      vision_budget_total: 200,
    }),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface Paths {
  root: string;
  dir: string;
  config: string;
  manifest: string;
  assetsDir: string;
  cacheDir: string;
  framesDir: string;
  workDir: string;
  modelsDir: string;
}

export function projectPaths(root = process.cwd()): Paths {
  const abs = resolve(root);
  const dir = join(abs, VIDE_DIR);
  return {
    root: abs,
    dir,
    config: join(dir, "config.json"),
    manifest: join(dir, "manifest.json"),
    assetsDir: join(dir, "assets"),
    cacheDir: join(dir, "cache"),
    framesDir: join(dir, "frames"),
    workDir: join(dir, "work"),
    modelsDir: join(dir, "models"),
  };
}

export async function ensureProjectDirs(paths: Paths): Promise<void> {
  for (const d of [
    paths.dir,
    paths.assetsDir,
    paths.cacheDir,
    paths.framesDir,
    paths.workDir,
    paths.modelsDir,
  ]) {
    await mkdir(d, { recursive: true });
  }
}

export async function writeConfig(paths: Paths, config: Config): Promise<void> {
  await writeFile(paths.config, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function loadConfig(paths: Paths): Promise<Config> {
  if (!existsSync(paths.config)) {
    throw new Error(
      `No vided project found at ${paths.root}. Run \`vided init\` first.`,
    );
  }
  const raw = JSON.parse(await readFile(paths.config, "utf8"));
  return ConfigSchema.parse(raw);
}

export function configHash(config: Config): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function isProject(paths: Paths): boolean {
  return existsSync(paths.config);
}
