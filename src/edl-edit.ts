import { parseDocument } from "yaml";
import { EdlSchema } from "./schemas/edl.js";

export type EdlOp =
  | { op: "set"; id: string; patch: Record<string, unknown> }
  | { op: "trim"; id: string; in?: number; out?: number }
  | { op: "reorder"; id: string; delta: number }
  | { op: "remove"; id: string }
  | { op: "add-clip"; source: string; in?: number; out?: number };

export interface EdlEditResult {
  ok: boolean;
  yaml?: string;
  error?: string;
  issues?: string[];
}

/**
 * Apply editing operations to an EDL document, preserving its structure and
 * comments (mutating the YAML AST rather than re-serializing a plain object).
 * The result is validated against the EDL schema before being returned.
 */
export function applyEdlOps(text: string, ops: EdlOp[]): EdlEditResult {
  const doc = parseDocument(text);

  for (const op of ops) {
    const js = doc.toJS() as { timeline?: Array<{ id?: string }> } | null;
    const timeline = js?.timeline ?? [];
    const id = "id" in op ? op.id : undefined;
    const idx = timeline.findIndex((t) => t?.id === id);

    switch (op.op) {
      case "set":
        if (idx >= 0) {
          for (const [k, v] of Object.entries(op.patch)) doc.setIn(["timeline", idx, k], v);
        }
        break;
      case "trim":
        if (idx >= 0) {
          if (typeof op.in === "number") doc.setIn(["timeline", idx, "in"], op.in);
          if (typeof op.out === "number") doc.setIn(["timeline", idx, "out"], op.out);
        }
        break;
      case "reorder": {
        if (idx < 0) break;
        const seq = doc.getIn(["timeline"]) as { items: unknown[] } | undefined;
        if (!seq) break;
        const to = Math.max(0, Math.min(seq.items.length - 1, idx + op.delta));
        const [item] = seq.items.splice(idx, 1);
        if (item) seq.items.splice(to, 0, item);
        break;
      }
      case "remove":
        if (idx >= 0) doc.deleteIn(["timeline", idx]);
        break;
      case "add-clip":
        if (op.source) {
          doc.addIn(["timeline"], {
            id: `clip-${Date.now().toString(36)}`,
            source: op.source,
            in: op.in ?? 0,
            out: op.out ?? 5,
          });
        }
        break;
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
