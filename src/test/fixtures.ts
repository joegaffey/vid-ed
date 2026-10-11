import { ClipsSchema, type Clip, type ClipInput } from "../schemas/clips.js";
import { EdlSchema } from "../schemas/edl.js";
import { resolveEdl, type ResolvedEdl } from "../edl.js";

function dur(clip: Clip): number {
  if (clip.kind === "video") return Math.max(0, (clip.out - clip.in) / clip.speed);
  if (clip.kind === "audio") return clip.out !== undefined ? clip.out - clip.in : (clip.duration ?? 0);
  return clip.duration;
}

/**
 * Build a resolved v4 EDL from a clip pool + item specs, for tests.
 * `visual`/`audio` sugar mapping the items onto one `v1`/`a1` track; omitted
 * `start` becomes the running cursor (visual, sequential) or 0 (audio).
 */
export function resolved(spec: {
  format?: string;
  clips: ClipInput[];
  visual?: Array<Record<string, unknown>>;
  audio?: Array<Record<string, unknown>>;
  tracks?: Array<Record<string, unknown>>;
  captions?: Record<string, unknown>;
}): ResolvedEdl {
  const clips = ClipsSchema.parse({ schema: "vided.clips/1", clips: spec.clips }).clips;
  const byId = new Map(clips.map((c) => [c.id, c]));

  const fill = (items: Array<Record<string, unknown>>, sequential: boolean): Array<Record<string, unknown>> => {
    let cursor = 0;
    return items.map((it) => {
      const clip = byId.get(it.use as string);
      const d = clip ? dur(clip) : 0;
      const raw = (it.start ?? it.offset) as number | undefined;
      const start = raw !== undefined ? raw : sequential ? cursor : 0;
      cursor = sequential ? start + d : Math.max(cursor, start + d);
      const { offset: _offset, ...rest } = it;
      return { ...rest, start };
    });
  };

  const tracks = spec.tracks ?? [
    { id: "v1", kind: "video", items: fill(spec.visual ?? [], true) },
    ...(spec.audio?.length ? [{ id: "a1", kind: "audio", items: fill(spec.audio, false) }] : []),
  ];

  const edl = EdlSchema.parse({
    schema: "vided.edl/4",
    ...(spec.format ? { output: { format: spec.format } } : {}),
    tracks,
    ...(spec.captions ? { captions: spec.captions } : {}),
  });
  const r = resolveEdl(edl, new Map(clips.map((c) => [c.id, c])));
  if (!r.ok || !r.resolved) throw new Error(r.errors.join("; "));
  return r.resolved;
}
