import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Who last wrote an artifact. The agent (via CLI/edits) or the studio. */
export type Writer = "studio" | "agent";

export interface VersionEntry {
  ts: string;
  writer: Writer;
  hash: string;
  content: string;
  label?: string;
  params?: Record<string, unknown>;
}

export interface History {
  artifact: string;
  versions: VersionEntry[];
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Whole-artifact change history, stored under `.studio/history/`. */
export class HistoryStore {
  constructor(private readonly root: string) {}

  private dir(): string {
    return join(this.root, ".studio", "history");
  }

  private file(artifact: string): string {
    return join(this.dir(), artifact.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json");
  }

  async read(artifact: string): Promise<History> {
    const p = this.file(artifact);
    if (!existsSync(p)) return { artifact, versions: [] };
    try {
      return JSON.parse(await readFile(p, "utf8")) as History;
    } catch {
      return { artifact, versions: [] };
    }
  }

  /** Append a version, skipping only if identical to the current (last) one. */
  async append(
    artifact: string,
    entry: { content: string; writer: Writer; label?: string; params?: Record<string, unknown>; ts?: string },
  ): Promise<VersionEntry> {
    const history = await this.read(artifact);
    const hash = contentHash(entry.content);
    const last = history.versions[history.versions.length - 1];
    if (last && last.hash === hash) return last;
    const version: VersionEntry = {
      ts: entry.ts ?? new Date().toISOString(),
      writer: entry.writer,
      hash,
      content: entry.content,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.params ? { params: entry.params } : {}),
    };
    history.versions.push(version);
    await mkdir(this.dir(), { recursive: true });
    await writeFile(this.file(artifact), JSON.stringify(history, null, 2) + "\n", "utf8");
    return version;
  }

  async latest(artifact: string): Promise<VersionEntry | undefined> {
    const history = await this.read(artifact);
    return history.versions[history.versions.length - 1];
  }
}

/** Simple line diff (LCS) between two texts, `+`/`-`/` ` prefixed. */
export function diffLines(oldText: string, newText: string): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push("  " + a[i]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push("- " + a[i]);
      i++;
    } else {
      out.push("+ " + b[j]);
      j++;
    }
  }
  while (i < n) out.push("- " + a[i++]);
  while (j < m) out.push("+ " + b[j++]);
  return out.join("\n");
}

/** Artifacts the studio versions and watches. */
export const TRACKED_ARTIFACTS = ["clips.yaml", "context.yaml", "narration.yaml", "edit.yaml", "brief.md"];

/**
 * Regenerate `.vided/STUDIO_CHANGES.md`: the artifacts whose latest version was
 * written by the studio. When the agent later edits one, its entry disappears.
 */
export async function writeStudioChanges(
  root: string,
  store: HistoryStore,
): Promise<void> {
  const lines: string[] = ["# Studio changes", "", "Artifacts last modified by vid-ed studio:", ""];
  let any = false;
  for (const artifact of TRACKED_ARTIFACTS) {
    const latest = await store.latest(artifact);
    if (latest && latest.writer === "studio") {
      any = true;
      lines.push(`- \`${artifact}\` — ${latest.ts}${latest.label ? ` (${latest.label})` : ""}`);
    }
  }
  if (!any) lines.push("_None — the agent is the last writer of all tracked artifacts._");
  lines.push("");
  const dir = join(root, ".vided");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "STUDIO_CHANGES.md"), lines.join("\n"), "utf8");
}
