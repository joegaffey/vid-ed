import { z } from "zod";
import { FormatSchema, TransformSchema, TransitionSchema } from "./clips.js";

export const SCHEMA_VERSION = "vided.edl/3";

export { TransformSchema, TransitionSchema };

export const OutputSchema = z.object({
  format: FormatSchema.default("1080p30"),
  path: z.string().default("out/final.mp4"),
  loudness_lufs: z.number().default(-14),
  crf: z.number().default(23),
  preset: z.string().default("medium"),
  audio_bitrate: z.string().default("192k"),
});

/** A visual-track placement referencing a clip in the pool. */
export const VisualItemSchema = z.object({
  id: z.string(),
  use: z.string(),
  speed: z.number().positive().optional(),
  transform: TransformSchema.optional(),
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

/** A free-positioned audio-track placement referencing a clip in the pool. */
export const AudioItemSchema = z.object({
  id: z.string(),
  use: z.string(),
  offset: z.number().default(0),
  gain_db: z.number().optional(),
  fade_in: z.number().optional(),
  fade_out: z.number().optional(),
});

export const TracksSchema = z.object({
  visual: z.array(VisualItemSchema).min(1),
  audio: z.array(AudioItemSchema).default([]),
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

export const ImageOverlaySchema = z.object({
  type: z.literal("image"),
  source: z.string(),
  start: z.number().default(0),
  end: z.number(),
  position: z.string().default("top-right"),
  opacity: z.number().min(0).max(1).default(1),
  width: z.number().optional(),
});

export const TextOverlaySchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  start: z.number().default(0),
  end: z.number(),
  position: z.string().default("bottom"),
  style: z
    .object({
      size: z.number().default(42),
      color: z.string().default("white"),
      font: z.string().optional(),
      box: z.boolean().default(false),
      box_color: z.string().default("&H80000000"),
      outline: z.number().default(2),
      shadow: z.number().default(1),
    })
    .default({}),
});

export const OverlaySchema = z.discriminatedUnion("type", [
  ImageOverlaySchema,
  TextOverlaySchema,
]);

export const EdlSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  output: OutputSchema.default({}),
  tracks: TracksSchema,
  captions: CaptionsSchema.default({}),
  overlays: z.array(OverlaySchema).default([]),
});

export type Edl = z.infer<typeof EdlSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type VisualItem = z.infer<typeof VisualItemSchema>;
export type AudioItem = z.infer<typeof AudioItemSchema>;
export type ImageOverlay = z.infer<typeof ImageOverlaySchema>;
export type TextOverlay = z.infer<typeof TextOverlaySchema>;
