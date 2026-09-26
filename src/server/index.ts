import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { loadConfig, projectPaths, type Config, type Paths } from "../config.js";
import {
  ContextInputSchema,
  ContextAssetInputSchema,
} from "../schemas/context-input.js";
import { loadContextInput, saveContextInput } from "../context.js";
import { readManifest } from "../manifest.js";
import { JobQueue, resolveCliEntry } from "./jobs.js";

/** Stages the studio may run through the CLI (plus the yt-dlp `download`). */
export const ALLOWED_OPS = new Set([
  "scan",
  "doctor",
  "status",
  "extract-text",
  "sample",
  "dedupe",
  "annotate",
  "manifest",
  "script",
  "tts",
  "captions",
  "compose",
  "render",
  "download",
]);

export interface StudioServerOptions {
  root: string;
  port: number;
  host: string;
}

export interface StudioServer {
  url: string;
  queue: JobQueue;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".ass": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Built client assets: `dist/studio` (from `npm run build:studio`). */
function resolveStudioDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "studio"), join(here, "..", "..", "dist", "studio")];
  return candidates.find((p) => existsSync(join(p, "index.html")));
}

function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res: ServerResponse, status: number, text: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function withinRoot(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

function sanitizeName(name: string): string {
  const base = basename(name).replace(/[^\w.\- ]+/g, "_").trim();
  return base || "upload.bin";
}

async function serveFile(req: IncomingMessage, res: ServerResponse, abs: string): Promise<void> {
  if (!existsSync(abs)) {
    sendJSON(res, 404, { error: "file not found" });
    return;
  }
  const st = await stat(abs);
  const type = contentType(abs);
  const range = req.headers.range;
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : st.size - 1;
    res.writeHead(206, {
      "content-type": type,
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${st.size}`,
      "content-length": end - start + 1,
    });
    createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes" });
  createReadStream(abs).pipe(res);
}

async function runCliOnce(root: string, args: string[]): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const { bin, prefix } = resolveCliEntry();
  const res = await execa(bin, [...prefix, "--dir", root, "--json", ...args], { reject: false });
  if (res.exitCode !== 0) {
    return { ok: false, error: (res.stderr || res.stdout).trim() || `exit ${res.exitCode}` };
  }
  try {
    return { ok: true, data: JSON.parse(res.stdout) };
  } catch {
    return { ok: false, error: "invalid JSON from CLI" };
  }
}

export async function createStudioServer(opts: StudioServerOptions): Promise<StudioServer> {
  const paths: Paths = projectPaths(opts.root);
  const config: Config = await loadConfig(paths);
  const inputDir = join(paths.root, config.input_roots[0] ?? "input");
  const outDir = join(paths.root, "out");
  const studioDir = resolveStudioDir();

  const buildCommand = (op: string, args: string[]): { bin: string; argv: string[] } => {
    if (op === "download") {
      const ffmpeg = config.tools.ffmpeg;
      return {
        bin: config.tools.ytdlp ?? "yt-dlp",
        argv: [
          "--no-playlist",
          "-P", inputDir,
          "-o", "%(title)s.%(ext)s",
          ...(ffmpeg ? ["--ffmpeg-location", ffmpeg] : []),
          ...args,
        ],
      };
    }
    const { bin, prefix } = resolveCliEntry();
    return { bin, argv: [...prefix, "--dir", paths.root, "--json", op, ...args] };
  };

  const queue = new JobQueue({
    projectDir: paths.root,
    allowedOps: ALLOWED_OPS,
    buildCommand,
  });

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      sendJSON(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${opts.host}`);
    const path = url.pathname;

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      if (!studioDir) {
        return sendText(res, 500, "studio assets missing — run `npm run build:studio`");
      }
      return serveFile(req, res, join(studioDir, "index.html"));
    }

    if (req.method === "GET" && path === "/api/status") {
      const result = await runCliOnce(paths.root, ["status"]);
      if (!result.ok) return sendJSON(res, 502, { error: result.error });
      return sendJSON(res, 200, result.data);
    }

    if (req.method === "GET" && path === "/api/manifest") {
      const manifest = await readManifest(paths);
      if (!manifest) return sendJSON(res, 404, { error: "no manifest" });
      return sendJSON(res, 200, manifest);
    }

    // --- context ---------------------------------------------------------
    if (req.method === "GET" && path === "/api/context") {
      const context = (await loadContextInput(paths)) ?? ContextInputSchema.parse({});
      return sendJSON(res, 200, context);
    }
    if (req.method === "PUT" && path === "/api/context") {
      const body = await readBody(req);
      const parsed = ContextInputSchema.safeParse(body);
      if (!parsed.success) return sendJSON(res, 400, { error: parsed.error.issues.map((i) => i.message) });
      await saveContextInput(paths, parsed.data);
      return sendJSON(res, 200, parsed.data);
    }
    const assetCtx = /^\/api\/context\/assets\/(.+)$/.exec(path);
    if (assetCtx && req.method === "PUT") {
      const key = decodeURIComponent(assetCtx[1]!);
      const body = await readBody(req);
      const current = (await loadContextInput(paths)) ?? ContextInputSchema.parse({});
      const merged = ContextAssetInputSchema.safeParse({ ...(current.assets[key] ?? {}), ...(body as object) });
      if (!merged.success) return sendJSON(res, 400, { error: merged.error.issues.map((i) => i.message) });
      current.assets[key] = merged.data;
      await saveContextInput(paths, current);
      return sendJSON(res, 200, merged.data);
    }

    // --- uploads ---------------------------------------------------------
    if (req.method === "POST" && path === "/api/uploads") {
      const name = sanitizeName(url.searchParams.get("name") ?? "upload.bin");
      await mkdir(inputDir, { recursive: true });
      const dest = join(inputDir, name);
      if (!withinRoot(paths.root, dest)) return sendJSON(res, 400, { error: "bad path" });
      await pipeline(req, createWriteStream(dest));
      const bytes = (await stat(dest)).size;
      const job = url.searchParams.get("scan") === "1" ? queue.enqueue("scan", []) : undefined;
      return sendJSON(res, 201, { ok: true, path: relative(paths.root, dest), bytes, scan_job: job?.id });
    }
    if (req.method === "POST" && path === "/api/uploads/url") {
      const body = (await readBody(req)) as { url?: unknown };
      if (typeof body.url !== "string" || !body.url) return sendJSON(res, 400, { error: "url is required" });
      return sendJSON(res, 202, queue.enqueue("download", [body.url]));
    }

    // --- assets: frames + media -----------------------------------------
    const framesList = /^\/api\/assets\/([^/]+)\/frames$/.exec(path);
    if (framesList && req.method === "GET") {
      const manifest = await readManifest(paths);
      const asset = manifest?.assets.find((a) => a.id === framesList[1]);
      if (!asset) return sendJSON(res, 404, { error: "no such asset" });
      const frames = asset.visual.frames.map((f) => ({
        t: f.t,
        selected: f.selected,
        scene: f.scene,
        description: f.description,
        tags: f.tags,
        url: `/api/frames/${asset.id}/${encodeURIComponent(basename(f.path))}`,
      }));
      return sendJSON(res, 200, { asset: asset.path, kind: asset.kind, frames });
    }
    const frameFile = /^\/api\/frames\/([^/]+)\/(.+)$/.exec(path);
    if (frameFile && req.method === "GET") {
      const manifest = await readManifest(paths);
      const asset = manifest?.assets.find((a) => a.id === frameFile[1]);
      const wanted = decodeURIComponent(frameFile[2]!);
      const frame = asset?.visual.frames.find((f) => basename(f.path) === wanted);
      if (!frame) return sendJSON(res, 404, { error: "no such frame" });
      const abs = join(paths.root, frame.path);
      if (!withinRoot(paths.root, abs)) return sendJSON(res, 400, { error: "bad path" });
      return serveFile(req, res, abs);
    }
    const media = /^\/api\/media\/([^/]+)$/.exec(path);
    if (media && req.method === "GET") {
      const manifest = await readManifest(paths);
      const asset = manifest?.assets.find((a) => a.id === media[1]);
      if (!asset) return sendJSON(res, 404, { error: "no such asset" });
      const abs = join(paths.root, asset.path);
      if (!withinRoot(paths.root, abs)) return sendJSON(res, 400, { error: "bad path" });
      return serveFile(req, res, abs);
    }

    // --- outputs ---------------------------------------------------------
    if (req.method === "GET" && path === "/api/outputs") {
      if (!existsSync(outDir)) return sendJSON(res, 200, []);
      const files = await readdir(outDir);
      const list = await Promise.all(
        files.map(async (name) => {
          const st = await stat(join(outDir, name));
          return { name, bytes: st.size, mtime: st.mtime.toISOString() };
        }),
      );
      return sendJSON(res, 200, list);
    }
    const outputFile = /^\/api\/outputs\/([^/]+)$/.exec(path);
    if (outputFile && req.method === "GET") {
      const abs = join(outDir, sanitizeName(decodeURIComponent(outputFile[1]!)));
      if (!withinRoot(paths.root, abs)) return sendJSON(res, 400, { error: "bad path" });
      return serveFile(req, res, abs);
    }

    // --- jobs ------------------------------------------------------------
    if (req.method === "GET" && path === "/api/jobs") {
      return sendJSON(res, 200, queue.list());
    }
    if (req.method === "POST" && path === "/api/jobs") {
      const body = (await readBody(req)) as { op?: unknown; args?: unknown };
      if (typeof body.op !== "string") return sendJSON(res, 400, { error: "op is required" });
      const args = Array.isArray(body.args) ? body.args.map(String) : [];
      try {
        return sendJSON(res, 201, queue.enqueue(body.op, args));
      } catch (err) {
        return sendJSON(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(path);
    if (jobMatch) {
      const id = jobMatch[1]!;
      const job = queue.get(id);
      if (!job) return sendJSON(res, 404, { error: "no such job" });
      if (req.method === "GET") return sendJSON(res, 200, job);
      if (req.method === "DELETE") {
        const ok = queue.cancel(id);
        return sendJSON(res, ok ? 200 : 409, { ok });
      }
    }

    const eventsMatch = /^\/api\/jobs\/([^/]+)\/events$/.exec(path);
    if (req.method === "GET" && eventsMatch) {
      const id = eventsMatch[1]!;
      if (!queue.get(id)) return sendJSON(res, 404, { error: "no such job" });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (type: string, job: unknown) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(job)}\n\n`);
      };
      const current = queue.get(id);
      if (current) send("status", current);
      const unsubscribe = queue.subscribe((e) => {
        if (e.job.id === id) send(e.type, e.job);
      });
      const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15000);
      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }

    if (req.method === "GET" && !path.startsWith("/api/") && studioDir) {
      const abs = join(studioDir, path.replace(/^\/+/, ""));
      if (withinRoot(studioDir, abs) && existsSync(abs)) return serveFile(req, res, abs);
    }

    sendJSON(res, 404, { error: "not found" });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });

  const url = `http://${opts.host}:${opts.port}`;
  return {
    url,
    queue,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
