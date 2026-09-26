import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * A small build-graph for staleness: each node produces `outputs` from
 * `inputs`; if an input is newer than the output, the output is stale and the
 * node's op can be re-run.
 */
interface StageNode {
  id: string;
  label: string;
  op: string;
  args: string[];
  inputs: string[];
  outputs: string[];
}

const GRAPH: StageNode[] = [
  {
    id: "context-pack",
    label: "Context pack",
    op: "manifest",
    args: ["--context-pack", "work/context.md"],
    inputs: ["context.yaml", "brief.md", "manifest.json"],
    outputs: ["work/context.md"],
  },
  {
    id: "script",
    label: "Narration scaffold",
    op: "script",
    args: ["--out", "narration.yaml"],
    inputs: ["manifest.json", "context.yaml", "brief.md"],
    outputs: ["narration.yaml"],
  },
  {
    id: "tts",
    label: "Voice-over",
    op: "tts",
    args: ["narration.yaml"],
    inputs: ["narration.yaml", "context.yaml"],
    outputs: ["work/narration.wav"],
  },
  {
    id: "captions",
    label: "Captions",
    op: "captions",
    args: ["--from", "narration"],
    inputs: ["work/narration.timing.json", "work/narration.wav"],
    outputs: ["work/captions.srt"],
  },
  {
    id: "render",
    label: "Render",
    op: "render",
    args: ["edit.yaml"],
    inputs: ["edit.yaml", "work/narration.wav", "work/captions.ass"],
    outputs: ["out"],
  },
];

async function mtime(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function newestInDir(dir: string): Promise<number | undefined> {
  try {
    let newest: number | undefined;
    for (const name of await readdir(dir)) {
      const t = await mtime(join(dir, name));
      if (t !== undefined && (newest === undefined || t > newest)) newest = t;
    }
    return newest;
  } catch {
    return undefined;
  }
}

/** Resolve an output path to the mtime that represents it (file or newest in dir). */
async function outputMtime(root: string, rel: string): Promise<number | undefined> {
  const p = join(root, rel);
  const st = await stat(p).catch(() => undefined);
  if (!st) return undefined;
  return st.isDirectory() ? newestInDir(p) : st.mtimeMs;
}

export interface StaleNode {
  id: string;
  label: string;
  op: string;
  args: string[];
  output: string;
  staleInputs: string[];
}

export async function computeStaleness(root: string): Promise<StaleNode[]> {
  const stale: StaleNode[] = [];
  for (const node of GRAPH) {
    const times: number[] = [];
    for (const o of node.outputs) {
      const t = await outputMtime(root, o);
      if (t !== undefined) times.push(t);
    }
    if (!times.length) continue; // nothing produced yet — not stale
    const outTime = Math.min(...times);
    const staleInputs: string[] = [];
    for (const input of node.inputs) {
      const t = await mtime(join(root, input));
      if (t !== undefined && t > outTime + 1) staleInputs.push(input);
    }
    if (staleInputs.length) {
      stale.push({
        id: node.id,
        label: node.label,
        op: node.op,
        args: node.args,
        output: node.outputs[0]!,
        staleInputs,
      });
    }
  }
  return stale;
}
