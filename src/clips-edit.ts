import { parseDocument } from "yaml";
import { ClipsSchema } from "./schemas/clips.js";

export type ClipOp =
  | { op: "add"; clip: Record<string, unknown> }
  | { op: "set"; id: string; patch: Record<string, unknown> }
  | { op: "rm"; id: string };

export interface ClipEditResult {
  ok: boolean;
  yaml?: string;
  error?: string;
  issues?: string[];
}

/** AST-preserving edits to `clips.yaml` (keeps comments/structure). */
export function applyClipOps(text: string, ops: ClipOp[]): ClipEditResult {
  const doc = parseDocument(text);
  for (const op of ops) {
    const js = doc.toJS() as { clips?: Array<{ id?: string }> } | null;
    const arr = js?.clips ?? [];
    const id = "id" in op ? op.id : undefined;
    const idx = arr.findIndex((c) => c?.id === id);
    switch (op.op) {
      case "add":
        doc.addIn(["clips"], op.clip);
        break;
      case "set":
        if (idx >= 0) {
          for (const [k, v] of Object.entries(op.patch)) doc.setIn(["clips", idx, k], v);
        }
        break;
      case "rm":
        if (idx >= 0) doc.deleteIn(["clips", idx]);
        break;
    }
  }

  const parsed = ClipsSchema.safeParse(doc.toJS());
  if (!parsed.success) {
    return {
      ok: false,
      error: "clips are invalid",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, yaml: doc.toString() };
}
