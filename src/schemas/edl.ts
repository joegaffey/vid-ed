import { z } from "zod";
import { FormatSchema, TransformSchema, TransitionSchema } from "./clips.js";

export const SCHEMA_VERSION = "vided.edl/4";

export { TransformSchema, TransitionSchema };

export const OutputSchema = z.object({
  format: FormatSchema.default("1080p30"),
  path: z.string().default("out/final.mp4"),
  loudness_lufs: z.number().default(-14),
  crf: z.number().default(23),
  preset: z.string().default("medium"),
  audio_bitrate: z.string().default("192k"),
  /** Optional total timeline length; default = max item end across tracks. */
  duration: z.number().positive().optional(),
});

/** Placement anchors used when a video item is not full-frame. */
export const PositionSchema = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
  "top",
  "bottom",
]);

/**
 * A placement on a video track. `start` is absolute seconds on the shared
 * timeline; a track's first item may omit it (defaults to 0), later items must
 * declare it (enforced in `resolveEdl`). Clip `in`/`out` stay source-relative.
 */
export const VideoItemSchema = z.object({
  id: z.string(),
  use: z.string(),
  start: z.number().min(0).optional(),
  speed: z.number().positive().optional(),
  transform: TransformSchema.optional(),
  position: PositionSchema.default("center"),
  opacity: z.number().min(0).max(1).default(1),
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

/** A placement on an audio track. `start` is absolute seconds (see above). */
export const AudioItemSchema = z.object({
  id: z.string(),
  use: z.string(),
  start: z.number().min(0).optional(),
  gain_db: z.number().optional(),
  fade_in: z.number().nonnegative().optional(),
  fade_out: z.number().nonnegative().optional(),
});

export const VideoTrackSchema = z.object({
  id: z.string(),
  kind: z.literal("video"),
  items: z.array(VideoItemSchema),
});

export const AudioTrackSchema = z.object({
  id: z.string(),
  kind: z.literal("audio"),
  items: z.array(AudioItemSchema),
});

export const TrackSchema = z.discriminatedUnion("kind", [
  VideoTrackSchema,
  AudioTrackSchema,
]);

/** Ordered tracks; later video tracks composite on top. Ids must be unique. */
export const TracksSchema = z
  .array(TrackSchema)
  .min(1)
  .superRefine((tracks, ctx) => {
    const seen = new Set<string>();
    tracks.forEach((t, i) => {
      if (seen.has(t.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate track id "${t.id}".`, path: [i, "id"] });
      }
      seen.add(t.id);
    });
  });

export const CaptionStyleSchema = z.object({
  font: z.string().optional(),
  size: z.number().default(42),
  color: z.string().default("&H00FFFFFF"),
  position: z.string().default("bottom"),
  margin_v: z.number().default(64),
});

export const CaptionsSchema = z.object({
  mode: z.enum(["burn", "soft", "none"]).default("none"),
  file: z.string().optional(),
  style: CaptionStyleSchema.default({}),
  sources: z.array(z.string()).default([]),
  export: z.array(z.enum(["srt", "vtt", "ass"])).default([]),
});

export const EdlSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  output: OutputSchema.default({}),
  tracks: TracksSchema,
  captions: CaptionsSchema.default({}),
});

export type Edl = z.infer<typeof EdlSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type VideoItem = z.infer<typeof VideoItemSchema>;
export type AudioItem = z.infer<typeof AudioItemSchema>;
export type VideoTrack = z.infer<typeof VideoTrackSchema>;
export type AudioTrack = z.infer<typeof AudioTrackSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Position = z.infer<typeof PositionSchema>;
