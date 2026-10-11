import { parseDocument, YAMLSeq } from "yaml";
import { EdlSchema } from "./schemas/edl.js";

export type EdlOp =
  | {
      op: "add";
      /** Target track id; created (with `kind`) if it does not exist. */
      track?: string;
      kind?: "video" | "audio";
      use: string;
      id?: string;
      start?: number;
      speed?: number;
      transform?: Record<string, unknown>;
      position?: string;
      opacity?: number;
      transition_in?: Record<string, unknown>;
      transition_out?: Record<string, unknown>;
      gain_db?: number;
      fade_in?: number;
      fade_out?: number;
    }
  | { op: "remove"; id: string }
  | { op: "set"; id: string; patch: Record<string, unknown> }
  | { op: "reorder"; id: string; delta: number }
  | { op: "add-track"; id: string; kind: "video" | "audio" }
  | { op: "remove-track"; id: string }
  | { op: "set-captions"; patch: Record<string, unknown> };

export interface EdlEditResult {
  ok: boolean;
  yaml?: string;
  error?: string;
  issues?: string[];
}

interface TrackData {
  id?: string;
  kind?: string;
  items?: Array<{ id?: string }>;
}

/**
 * Apply editing operations to an edit document, preserving structure and
 * comments (mutating the YAML AST). Items reference clips in clips.yaml by
 * `use:`; trims live on the clip, placement (`start`) lives here.
 */
export function applyEdlOps(text: string, ops: EdlOp[]): EdlEditResult {
  const doc = parseDocument(text);
  const tracks = (): TrackData[] => (doc.toJS() as { tracks?: TrackData[] } | null)?.tracks ?? [];

  const trackIndex = (id: string): number => tracks().findIndex((t) => t?.id === id);
  const find = (id: string): { track: number; item: number } | undefined => {
    const ts = tracks();
    for (let t = 0; t < ts.length; t++) {
      const items = ts[t]?.items ?? [];
      for (let i = 0; i < items.length; i++) if (items[i]?.id === id) return { track: t, item: i };
    }
    return undefined;
  };

  for (const op of ops) {
    if (op.op === "set-captions") {
      for (const [k, v] of Object.entries(op.patch)) doc.setIn(["captions", k], v);
      continue;
    }
    if (op.op === "add-track") {
      if (trackIndex(op.id) < 0) {
        const seq = doc.getIn(["tracks"]);
        if (seq instanceof YAMLSeq) seq.add(doc.createNode({ id: op.id, kind: op.kind, items: [] }));
        else doc.setIn(["tracks"], doc.createNode([{ id: op.id, kind: op.kind, items: [] }]));
      }
      continue;
    }
    if (op.op === "remove-track") {
      const idx = trackIndex(op.id);
      if (idx >= 0) doc.deleteIn(["tracks", idx]);
      continue;
    }
    if (op.op === "set") {
      const f = find(op.id);
      if (f) for (const [k, v] of Object.entries(op.patch)) doc.setIn(["tracks", f.track, "items", f.item, k], v);
      continue;
    }
    if (op.op === "remove") {
      const f = find(op.id);
      if (f) doc.deleteIn(["tracks", f.track, "items", f.item]);
      continue;
    }
    if (op.op === "reorder") {
      const f = find(op.id);
      if (!f) continue;
      const items = (tracks()[f.track]?.items ?? []).slice();
      const to = Math.max(0, Math.min(items.length - 1, f.item + op.delta));
      const [moved] = items.splice(f.item, 1);
      if (moved) items.splice(to, 0, moved);
      doc.setIn(["tracks", f.track, "items"], doc.createNode(items));
      continue;
    }
    // op === "add"
    const kind = op.kind ?? "video";
    let t = op.track !== undefined ? trackIndex(op.track) : -1;
    if (t < 0) {
      const id = op.track ?? `${kind === "audio" ? "a" : "v"}${Date.now().toString(36)}`;
      if (trackIndex(id) < 0) {
        const seq = doc.getIn(["tracks"]);
        if (seq instanceof YAMLSeq) seq.add(doc.createNode({ id, kind, items: [] }));
        else doc.setIn(["tracks"], doc.createNode([{ id, kind, items: [] }]));
      }
      t = trackIndex(id);
    }
    const id = op.id ?? `${kind === "audio" ? "a" : "v"}-${Date.now().toString(36)}`;
    const item =
      kind === "audio"
        ? {
            id,
            use: op.use,
            ...(op.start !== undefined ? { start: op.start } : {}),
            ...(op.gain_db !== undefined ? { gain_db: op.gain_db } : {}),
            ...(op.fade_in !== undefined ? { fade_in: op.fade_in } : {}),
            ...(op.fade_out !== undefined ? { fade_out: op.fade_out } : {}),
          }
        : {
            id,
            use: op.use,
            ...(op.start !== undefined ? { start: op.start } : {}),
            ...(op.speed !== undefined ? { speed: op.speed } : {}),
            ...(op.position ? { position: op.position } : {}),
            ...(op.opacity !== undefined ? { opacity: op.opacity } : {}),
            ...(op.transform ? { transform: op.transform } : {}),
            ...(op.transition_in ? { transition_in: op.transition_in } : {}),
            ...(op.transition_out ? { transition_out: op.transition_out } : {}),
          };
    const items = doc.getIn(["tracks", t, "items"]);
    if (items instanceof YAMLSeq) items.add(doc.createNode(item));
    else doc.setIn(["tracks", t, "items"], doc.createNode([item]));
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
