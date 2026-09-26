import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { projectPaths } from "../config.js";
import { execa } from "execa";
import { JobQueue, resolveCliEntry } from "./jobs.js";
import { INDEX_HTML } from "./ui.js";

/** Stages the studio may run through the CLI. */
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

function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
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
  const paths = projectPaths(opts.root);
  const queue = new JobQueue({ projectDir: paths.root, allowedOps: ALLOWED_OPS });

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      sendJSON(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${opts.host}`);
    const path = url.pathname;

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      return sendText(res, 200, INDEX_HTML, "text/html; charset=utf-8");
    }

    if (req.method === "GET" && path === "/api/status") {
      const result = await runCliOnce(paths.root, ["status"]);
      if (!result.ok) return sendJSON(res, 502, { error: result.error });
      return sendJSON(res, 200, result.data);
    }

    if (req.method === "GET" && path === "/api/manifest") {
      if (!existsSync(paths.manifest)) return sendJSON(res, 404, { error: "no manifest" });
      return sendText(res, 200, await readFile(paths.manifest, "utf8"), "application/json; charset=utf-8");
    }

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
