import { z } from "zod";

export const SCHEMA_VERSION = "vided.edl/1";

export const OutputSchema = z.object({
  path: z.string().default("out/final.mp4"),
  resolution: z.string().default("1920x1080"),
  fps: z.number().default(30),
  video_codec: z.string().default("libx264"),
  audio_codec: z.string().default("aac"),
  loudness_lufs: z.number().default(-14),
  crf: z.number().default(23),
  preset: z.string().default("medium"),
});

export const TransformSchema = z.object({
  scale: z.string().optional(),
  pad: z.boolean().default(true),
});

export const TransitionSchema = z.object({
  type: z.enum(["fade"]).default("fade"),
  duration: z.number().default(0.5),
});

export const ClipSchema = z.object({
  id: z.string(),
  source: z.string(),
  in: z.number().default(0),
  out: z.number(),
  speed: z.number().positive().default(1),
  transform: TransformSchema.optional(),
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

export const TitleStyleSchema = z
  .object({
    title_size: z.number().default(96),
    subtitle_size: z.number().default(48),
    color: z.string().default("white"),
    subtitle_color: z.string().default("#cccccc"),
    font: z.string().optional(),
  })
  .default({});

export const TitleCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  duration: z.number().positive().default(3),
  background: z.string().default("#101820"),
  style: TitleStyleSchema,
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

export const SlideStyleSchema = z
  .object({
    heading_size: z.number().default(52),
    body_size: z.number().default(30),
    color: z.string().default("white"),
    accent: z.string().default("#4ec9b0"),
    font: z.string().optional(),
    mono: z.string().optional(),
  })
  .default({});

export const SlideSchema = z.object({
  id: z.string(),
  slide: z.string(),
  body: z.string().optional(),
  // presentation preset: `mono` for monospace body. `code` is accepted as an alias.
  kind: z
    .enum(["text", "mono", "code"])
    .default("text")
    .transform((k) => (k === "code" ? ("mono" as const) : k)),
  duration: z.number().positive().default(5),
  background: z.string().default("#0d1117"),
  style: SlideStyleSchema,
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

export const StillSchema = z.object({
  id: z.string(),
  image: z.string(),
  duration: z.number().positive().default(5),
  fit: z.enum(["contain", "cover"]).default("contain"),
  zoom: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .optional(),
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

export const TimelineItemSchema = z.union([
  ClipSchema,
  TitleCardSchema,
  SlideSchema,
  StillSchema,
]);

export const VoiceoverSchema = z.object({
  source: z.string(),
  start: z.number().default(0),
  gain_db: z.number().default(0),
});

export const MusicSchema = z.object({
  source: z.string(),
  gain_db: z.number().default(-18),
  duck_under_voiceover: z.boolean().default(false),
  loop: z.boolean().default(true),
});

export const AudioSchema = z.object({
  voiceover: VoiceoverSchema.optional(),
  music: MusicSchema.optional(),
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
  timeline: z.array(TimelineItemSchema).min(1),
  audio: AudioSchema.default({}),
  captions: CaptionsSchema.default({}),
  overlays: z.array(OverlaySchema).default([]),
});

export type Edl = z.infer<typeof EdlSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type TitleCard = z.infer<typeof TitleCardSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type Still = z.infer<typeof StillSchema>;
export type TimelineItem = z.infer<typeof TimelineItemSchema>;
export type ImageOverlay = z.infer<typeof ImageOverlaySchema>;
export type TextOverlay = z.infer<typeof TextOverlaySchema>;

export function isTitleCard(item: TimelineItem): item is TitleCard {
  return "title" in item;
}

export function isSlide(item: TimelineItem): item is Slide {
  return "slide" in item;
}

export function isStill(item: TimelineItem): item is Still {
  return "image" in item;
}
