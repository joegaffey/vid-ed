import { z } from "zod";

export const SCHEMA_VERSION = "vided.asset/1";

export const StreamSchema = z.object({
  index: z.number().int().optional(),
  codec: z.string().optional(),
  profile: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fps: z.number().optional(),
  bitrate: z.number().optional(),
  sample_rate: z.number().int().optional(),
  channels: z.number().int().optional(),
  rotation: z.number().optional(),
});

export const TechnicalSchema = z.object({
  duration_s: z.number().optional(),
  container: z.string().optional(),
  format_long_name: z.string().optional(),
  size_bytes: z.number().optional(),
  video: StreamSchema.optional(),
  audio: StreamSchema.optional(),
  creation_time: z.string().optional(),
});

export const TranscriptWordSchema = z.object({
  w: z.string(),
  start: z.number(),
  end: z.number(),
});

export const TranscriptSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(TranscriptWordSchema).optional(),
});

export const TranscriptSchema = z.object({
  tool: z.string(),
  model: z.string().optional(),
  language: z.string().optional(),
  segments: z.array(TranscriptSegmentSchema),
});

export const VisualFrameSchema = z.object({
  t: z.number(),
  path: z.string(),
  phash: z.string().optional(),
  dhash: z.string().optional(),
  scene: z.string().optional(),
  sharpness: z.number().optional(),
  selected: z.boolean().default(false),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  quality: z.number().optional(),
  suggested_in: z.number().optional(),
  suggested_out: z.number().optional(),
});

export const VisualSchema = z.object({
  scenes: z
    .array(z.object({ id: z.string(), start: z.number(), end: z.number() }))
    .default([]),
  frames: z.array(VisualFrameSchema).default([]),
  vision_budget: z
    .object({ max_frames: z.number().int(), used: z.number().int() })
    .optional(),
});

export const ProvenanceSchema = z.object({
  tool: z.string(),
  version: z.string(),
  generated_at: z.string(),
});

export const AssetKind = z.enum(["video", "audio", "image", "text", "unknown"]);
export type AssetKind = z.infer<typeof AssetKind>;

export const AssetRecordSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  id: z.string(),
  path: z.string(),
  kind: AssetKind,
  content_hash: z.string(),
  bytes: z.number(),
  mtime: z.string(),
  status: z.enum(["probed", "extracted", "sampled", "annotated"]).default("probed"),
  technical: TechnicalSchema.default({}),
  extracted: z
    .object({
      language: z.string().optional(),
      transcript: TranscriptSchema.nullable().default(null),
      ocr: z.string().nullable().default(null),
      sidecar: z.string().nullable().default(null),
    })
    .default({ transcript: null, ocr: null, sidecar: null }),
  visual: VisualSchema.default({ scenes: [], frames: [] }),
  tags: z.array(z.string()).default([]),
  summary: z.string().optional(),
  title: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
  provenance: ProvenanceSchema,
});

export type AssetRecord = z.infer<typeof AssetRecordSchema>;
export type Technical = z.infer<typeof TechnicalSchema>;
export type VisualFrame = z.infer<typeof VisualFrameSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;
