import { parseDocument } from "yaml";
import { EdlSchema } from "./schemas/edl.js";

export type EdlOp =
  | {
      op: "add";
      track?: "visual" | "audio";
      use: string;
      id?: string;
      speed?: number;
      transform?: Record<string, unknown>;
      transition_in?: Record<string, unknown>;
      transition_out?: Record<string, unknown>;
      offset?: number;
      gain_db?: number;
    }
  | { op: "remove"; id: string }
  | { op: "reorder"; id: string; delta: number }
  | { op: "set"; id: string; patch: Record<string, unknown> };

export interface EdlEditResult {
  ok: boolean;
  yaml?: string;
  error?: string;
  issues?: string[];
}

type Track = "visual" | "audio";

/**
 * Apply editing operations to an edit document, preserving structure and
 * comments (mutating the YAML AST). Items reference clips in clips.yaml by
 * `use`; trimming a clip's range is done on clips.yaml, not here.
 */
export function applyEdlOps(text: string, ops: EdlOp[]): EdlEditResult {
  const doc = parseDocument(text);
  const find = (id: string): { track: Track; idx: number } | undefined => {
    const js = doc.toJS() as { tracks?: { visual?: Array<{ id?: string }>; audio?: Array<{ id?: string }> } } | null;
    for (const track of ["visual", "audio"] as Track[]) {
      const idx = (js?.tracks?.[track] ?? []).findIndex((t) => t?.id === id);
      if (idx >= 0) return { track, idx };
    }
    return undefined;
  };

  for (const op of ops) {
    switch (op.op) {
      case "add": {
        const track: Track = op.track ?? "visual";
        const id = op.id ?? `${track === "audio" ? "a" : "v"}-${Date.now().toString(36)}`;
        const item =
          track === "audio"
            ? {
                id,
                use: op.use,
                ...(op.offset !== undefined ? { offset: op.offset } : {}),
                ...(op.gain_db !== undefined ? { gain_db: op.gain_db } : {}),
              }
            : {
                id,
                use: op.use,
                ...(op.speed !== undefined ? { speed: op.speed } : {}),
                ...(op.transform ? { transform: op.transform } : {}),
                ...(op.transition_in ? { transition_in: op.transition_in } : {}),
                ...(op.transition_out ? { transition_out: op.transition_out } : {}),
              };
        doc.addIn(["tracks", track], item);
        break;
      }
      case "remove": {
        const f = find(op.id);
        if (f) doc.deleteIn(["tracks", f.track, f.idx]);
        break;
      }
      case "reorder": {
        const f = find(op.id);
        if (!f) break;
        const seq = doc.getIn(["tracks", f.track]) as { items: unknown[] } | undefined;
        if (!seq) break;
        const to = Math.max(0, Math.min(seq.items.length - 1, f.idx + op.delta));
        const [item] = seq.items.splice(f.idx, 1);
        if (item) seq.items.splice(to, 0, item);
        break;
      }
      case "set": {
        const f = find(op.id);
        if (!f) break;
        for (const [k, v] of Object.entries(op.patch)) doc.setIn(["tracks", f.track, f.idx, k], v);
        break;
      }
    }
  }

  const parsed = EdlSchema.safeParse(doc.toJS());
  if (!parsed.success) {
    return {
      ok: false,
      error: "edit is invalid",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, yaml: doc.toString() };
}
