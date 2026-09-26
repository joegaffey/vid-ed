import { ClipsSchema, type ClipInput } from "../schemas/clips.js";
import { EdlSchema } from "../schemas/edl.js";
import { resolveEdl, type ResolvedEdl } from "../edl.js";

/** Build a resolved EDL from a clip pool + track references, for tests. */
export function resolved(spec: {
  format?: string;
  clips: ClipInput[];
  visual: Array<Record<string, unknown>>;
  audio?: Array<Record<string, unknown>>;
  captions?: Record<string, unknown>;
  overlays?: Array<Record<string, unknown>>;
}): ResolvedEdl {
  const clips = ClipsSchema.parse({ schema: "vided.clips/1", clips: spec.clips }).clips;
  const edl = EdlSchema.parse({
    schema: "vided.edl/3",
    ...(spec.format ? { output: { format: spec.format } } : {}),
    tracks: { visual: spec.visual, audio: spec.audio ?? [] },
    ...(spec.captions ? { captions: spec.captions } : {}),
    ...(spec.overlays ? { overlays: spec.overlays } : {}),
  });
  const r = resolveEdl(edl, new Map(clips.map((c) => [c.id, c])));
  if (!r.ok || !r.resolved) throw new Error(r.errors.join("; "));
  return r.resolved;
}
