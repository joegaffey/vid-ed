import { z } from "zod";

export const SCRIPT_VERSION = "vided.narration/1";
export const TIMING_VERSION = "vided.narration.timing/1";

export const NarrationSegmentSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  gap_after: z.number().min(0).default(0.4),
  start: z.number().min(0).optional(),
  note: z.string().optional(),
});

export const NarrationScriptSchema = z.object({
  schema: z.literal(SCRIPT_VERSION).default(SCRIPT_VERSION),
  voice: z.string().optional(),
  engine: z.enum(["piper", "kokoro"]).optional(),
  segments: z.array(NarrationSegmentSchema).min(1),
});

export const TimingSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  gap_after: z.number(),
});

export const NarrationTimingSchema = z.object({
  schema: z.literal(TIMING_VERSION),
  engine: z.string(),
  voice: z.string().optional(),
  audio: z.string(),
  duration: z.number(),
  segments: z.array(TimingSegmentSchema),
});

export type NarrationScript = z.infer<typeof NarrationScriptSchema>;
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;
export type NarrationTiming = z.infer<typeof NarrationTimingSchema>;
export type TimingSegment = z.infer<typeof TimingSegmentSchema>;
