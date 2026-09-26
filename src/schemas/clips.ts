import { z } from "zod";

export const SCHEMA_VERSION = "vided.clips/1";

/** Where a clip came from: auto-derived by `vided clips`, or authored. */
export const ClipOrigin = z.enum(["derived", "agent", "studio"]);
export type ClipOrigin = z.infer<typeof ClipOrigin>;

/** `source` sentinel for generated clips (title/slide) that have no media. */
export const GENERATED_SOURCE = "generated";

/**
 * Canonical output formats a clip can declare. This is the source of truth;
 * the same list is mirrored in AGENTS.md and README.md so agents pick valid
 * names. A clip's preview is a render at its own format.
 */
export const KNOWN_FORMATS = {
  "1080p30": { width: 1920, height: 1080, fps: 30, video_codec: "libx264", audio_codec: "aac", audio_sample_rate: 48000, audio_channels: 2 },
  "1080p60": { width: 1920, height: 1080, fps: 60, video_codec: "libx264", audio_codec: "aac", audio_sample_rate: 48000, audio_channels: 2 },
  "720p30": { width: 1280, height: 720, fps: 30, video_codec: "libx264", audio_codec: "aac", audio_sample_rate: 48000, audio_channels: 2 },
  vertical1080p30: { width: 1080, height: 1920, fps: 30, video_codec: "libx264", audio_codec: "aac", audio_sample_rate: 48000, audio_channels: 2 },
  square1080p30: { width: 1080, height: 1080, fps: 30, video_codec: "libx264", audio_codec: "aac", audio_sample_rate: 48000, audio_channels: 2 },
  audio48k: { audio_codec: "aac", audio_sample_rate: 48000, audio_channels: 2 },
} as const;

export type FormatParams = (typeof KNOWN_FORMATS)[keyof typeof KNOWN_FORMATS];
export type FormatName = keyof typeof KNOWN_FORMATS;

const FORMAT_NAMES = Object.keys(KNOWN_FORMATS) as [FormatName, ...FormatName[]];
export const FormatSchema = z.enum(FORMAT_NAMES);

export function formatParams(name: FormatName): FormatParams {
  return KNOWN_FORMATS[name];
}

export const TransformSchema = z.object({
  scale: z.string().optional(),
  pad: z.boolean().default(true),
});

export const TransitionSchema = z.object({
  type: z.enum(["fade"]).default("fade"),
  duration: z.number().default(0.5),
});

export type Transform = z.infer<typeof TransformSchema>;
export type Transition = z.infer<typeof TransitionSchema>;

const ClipBase = {
  id: z.string(),
  source: z.string(),
  format: FormatSchema,
  muted: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  note: z.string().optional(),
  poster: z.number().optional(),
  origin: ClipOrigin.default("agent"),
};

export const VideoClipSchema = z.object({
  ...ClipBase,
  kind: z.literal("video"),
  in: z.number().default(0),
  out: z.number(),
  speed: z.number().positive().default(1),
  transform: TransformSchema.optional(),
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

export const ImageClipSchema = z.object({
  ...ClipBase,
  kind: z.literal("image"),
  duration: z.number().positive().default(5),
  fit: z.enum(["contain", "cover"]).default("contain"),
  zoom: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .optional(),
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

export const AudioClipSchema = z.object({
  ...ClipBase,
  kind: z.literal("audio"),
  in: z.number().default(0),
  out: z.number().optional(),
  duration: z.number().positive().optional(),
  gain_db: z.number().default(0),
});

export const TitleClipSchema = z.object({
  ...ClipBase,
  kind: z.literal("title"),
  title: z.string(),
  subtitle: z.string().optional(),
  duration: z.number().positive().default(3),
  background: z.string().default("#101820"),
  style: z
    .object({
      title_size: z.number().default(96),
      subtitle_size: z.number().default(48),
      color: z.string().default("white"),
      subtitle_color: z.string().default("#cccccc"),
      font: z.string().optional(),
    })
    .default({}),
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

export const SlideClipSchema = z.object({
  ...ClipBase,
  kind: z.literal("slide"),
  heading: z.string(),
  body: z.string().optional(),
  // presentation preset: `mono` for monospace body. `code` accepted as alias.
  variant: z
    .enum(["text", "mono", "code"])
    .default("text")
    .transform((k) => (k === "code" ? ("mono" as const) : k)),
  duration: z.number().positive().default(5),
  background: z.string().default("#0d1117"),
  style: z
    .object({
      heading_size: z.number().default(52),
      body_size: z.number().default(30),
      color: z.string().default("white"),
      accent: z.string().default("#4ec9b0"),
      font: z.string().optional(),
      mono: z.string().optional(),
    })
    .default({}),
  transition_in: TransitionSchema.optional(),
  transition_out: TransitionSchema.optional(),
});

export const ClipSchema = z.discriminatedUnion("kind", [
  VideoClipSchema,
  ImageClipSchema,
  AudioClipSchema,
  TitleClipSchema,
  SlideClipSchema,
]);

export const ClipsSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  clips: z.array(ClipSchema).default([]),
});

export type Clip = z.infer<typeof ClipSchema>;
export type ClipInput = z.input<typeof ClipSchema>;
export type VideoClip = z.infer<typeof VideoClipSchema>;
export type ImageClip = z.infer<typeof ImageClipSchema>;
export type AudioClip = z.infer<typeof AudioClipSchema>;
export type TitleClip = z.infer<typeof TitleClipSchema>;
export type SlideClip = z.infer<typeof SlideClipSchema>;
export type ClipKind = Clip["kind"];
export type Clips = z.infer<typeof ClipsSchema>;

/** Stable id for a clip derived from a media range. */
export function clipId(source: string, start: number, end: number): string {
  const short = source.replace(/\.[^.]+$/, "").split(/[\/\\]/).pop() ?? source;
  return `sel-${short}-${Math.round(start * 1000)}-${Math.round(end * 1000)}`;
}
