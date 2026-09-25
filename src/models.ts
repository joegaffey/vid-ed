import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execa } from "execa";
import type { Paths } from "./config.js";

const RELEASE_BASE = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/";
export const VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

export function piperAsset(
  platform: string = process.platform,
  arch: string = process.arch,
): { file: string; ext: "tar.gz" | "zip" } {
  if (platform === "linux" && arch === "x64") return { file: "piper_linux_x86_64.tar.gz", ext: "tar.gz" };
  if (platform === "linux" && arch === "arm64") return { file: "piper_linux_aarch64.tar.gz", ext: "tar.gz" };
  if (platform === "darwin" && arch === "x64") return { file: "piper_macos_x64.tar.gz", ext: "tar.gz" };
  if (platform === "darwin" && arch === "arm64") return { file: "piper_macos_aarch64.tar.gz", ext: "tar.gz" };
  if (platform === "win32" && arch === "x64") return { file: "piper_windows_amd64.zip", ext: "zip" };
  throw new Error(`No prebuilt Piper for ${platform}/${arch}. Install it manually and set tools.piper.`);
}

export function piperPaths(paths: Paths): { dir: string; bin: string } {
  const dir = join(paths.dir, "tools", "piper");
  const bin = join(dir, process.platform === "win32" ? "piper.exe" : "piper");
  return { dir, bin };
}

export interface VoiceEntry {
  name: string;
  quality: string;
  language: { family: string; code: string };
  files: Record<string, { size_bytes?: number; md5_digest?: string }>;
}

export function voiceModelDir(paths: Paths): string {
  return join(paths.modelsDir, "piper");
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
}

export interface InstallResult {
  path: string;
  version?: string;
}

export async function installPiper(paths: Paths, opts: { force?: boolean } = {}): Promise<InstallResult> {
  const { dir, bin } = piperPaths(paths);
  if (existsSync(bin) && !opts.force) {
    const version = await piperVersion(bin);
    return { path: bin, version };
  }
  const asset = piperAsset();
  const tmp = join(paths.dir, "tools", `piper-download.${asset.ext}`);
  await mkdir(join(paths.dir, "tools"), { recursive: true });
  await download(RELEASE_BASE + asset.file, tmp);
  if (asset.ext === "zip") {
    await execa("unzip", ["-o", tmp, "-d", join(paths.dir, "tools")]);
  } else {
    await execa("tar", ["xzf", tmp, "-C", join(paths.dir, "tools")]);
  }
  await rm(tmp, { force: true });
  if (!existsSync(bin)) {
    throw new Error(`Piper extracted but binary not found at ${bin}.`);
  }
  return { path: bin, version: await piperVersion(bin) };
}

async function piperVersion(bin: string): Promise<string | undefined> {
  const res = await execa(bin, ["--version"], { reject: false, stdin: "ignore", timeout: 10000 });
  const first = (res.stdout || res.stderr).split("\n")[0] ?? "";
  return first.trim() || undefined;
}

let voiceIndex: Record<string, VoiceEntry> | undefined;

export async function fetchVoices(): Promise<Record<string, VoiceEntry>> {
  if (voiceIndex) return voiceIndex;
  const res = await fetch(`${VOICES_BASE}/voices.json`, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET voices.json -> HTTP ${res.status}`);
  voiceIndex = (await res.json()) as Record<string, VoiceEntry>;
  return voiceIndex;
}

export interface VoiceInstallResult {
  voice: string;
  dir: string;
  files: string[];
}

export async function installVoice(
  paths: Paths,
  voice: string,
  opts: { force?: boolean } = {},
): Promise<VoiceInstallResult> {
  const voices = await fetchVoices();
  const entry = voices[voice];
  if (!entry) {
    throw new Error(`Unknown voice "${voice}". Browse https://huggingface.co/rhasspy/piper-voices`);
  }
  const dir = voiceModelDir(paths);
  const files = Object.keys(entry.files).filter((f) => f.endsWith(".onnx") || f.endsWith(".onnx.json"));
  const written: string[] = [];
  for (const f of files) {
    const name = f.split("/").pop()!;
    const dest = join(dir, name);
    if (!existsSync(dest) || opts.force) {
      await download(`${VOICES_BASE}/${f}`, dest);
    }
    written.push(dest);
  }
  return { voice, dir, files: written };
}

export async function listInstalledVoices(paths: Paths): Promise<string[]> {
  const dir = voiceModelDir(paths);
  if (!existsSync(dir)) return [];
  const { readdir } = await import("node:fs/promises");
  return (await readdir(dir))
    .filter((f) => f.endsWith(".onnx"))
    .map((f) => f.replace(/\.onnx$/, ""))
    .sort();
}
