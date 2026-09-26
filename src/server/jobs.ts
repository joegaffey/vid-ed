import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  op: string;
  args: string[];
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  logs: string[];
  error?: string;
}

export interface JobEvent {
  type: "status" | "log";
  job: Job;
}

const MAX_LOG_LINES = 500;

/** Locate the CLI entry to spawn: built `dist/cli.js`, else `src/cli.ts` via tsx. */
export function resolveCliEntry(): { bin: string; prefix: string[] } {
  const dir = dirname(fileURLToPath(import.meta.url));
  const js = join(dir, "..", "cli.js");
  if (existsSync(js)) return { bin: process.execPath, prefix: [js] };
  const ts = join(dir, "..", "cli.ts");
  if (existsSync(ts)) return { bin: "tsx", prefix: [ts] };
  throw new Error("Cannot locate the vided CLI entry (run `npm run build` first).");
}

export interface JobQueueOptions {
  projectDir: string;
  allowedOps: Set<string>;
  buildCommand: (op: string, args: string[]) => { bin: string; argv: string[] };
}

type Subprocess = ReturnType<typeof execa>;

export class JobQueue {
  private jobs = new Map<string, Job>();
  private order: string[] = [];
  private waiting: string[] = [];
  private running?: { id: string; sub: Subprocess };
  private listeners = new Set<(e: JobEvent) => void>();

  constructor(private readonly opts: JobQueueOptions) {}

  subscribe(fn: (e: JobEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): Job[] {
    return this.order.map((id) => this.jobs.get(id)!).filter(Boolean);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  enqueue(op: string, args: string[]): Job {
    if (!this.opts.allowedOps.has(op)) throw new Error(`Unknown op "${op}".`);
    const job: Job = {
      id: randomUUID().slice(0, 8),
      op,
      args,
      status: "queued",
      createdAt: new Date().toISOString(),
      logs: [],
    };
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    this.waiting.push(job.id);
    this.pump();
    return job;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === "queued") {
      this.waiting = this.waiting.filter((x) => x !== id);
      job.status = "cancelled";
      job.endedAt = new Date().toISOString();
      this.emit({ type: "status", job });
      return true;
    }
    if (job.status === "running" && this.running?.id === id) {
      this.running.sub.kill("SIGTERM");
      return true;
    }
    return false;
  }

  private emit(e: JobEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private appendLog(job: Job, chunk: Buffer | string): void {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      job.logs.push(line);
      if (job.logs.length > MAX_LOG_LINES) job.logs.shift();
      this.emit({ type: "log", job });
    }
  }

  private pump(): void {
    if (this.running) return;
    const id = this.waiting.shift();
    if (!id) return;
    const job = this.jobs.get(id);
    if (!job) return;

    job.status = "running";
    job.startedAt = new Date().toISOString();
    this.emit({ type: "status", job });

    const { bin, argv } = this.opts.buildCommand(job.op, job.args);
    const sub = execa(bin, argv, { reject: false });
    this.running = { id, sub };
    sub.stdout?.on("data", (d) => this.appendLog(job, d));
    sub.stderr?.on("data", (d) => this.appendLog(job, d));
    sub
      .then((res) => this.finish(job, res.exitCode ?? 0, res.signal ?? null))
      .catch((err: unknown) => this.finish(job, null, null, String(err)));
  }

  private finish(
    job: Job,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    error?: string,
  ): void {
    job.exitCode = exitCode;
    job.endedAt = new Date().toISOString();
    if (error) job.error = error;
    if (job.status !== "cancelled") {
      if (error) job.status = "failed";
      else if (signal) job.status = "cancelled";
      else job.status = exitCode === 0 ? "done" : "failed";
    }
    this.running = undefined;
    this.emit({ type: "status", job });
    this.pump();
  }
}
