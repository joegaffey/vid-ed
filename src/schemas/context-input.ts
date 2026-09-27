import { z } from "zod";

export const CONTEXT_INPUT_VERSION = "vided.context.input/1";

export const ContextAssetInputSchema = z.object({
  title: z.string().optional(),
  role: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const ContextInputSchema = z.object({
  schema: z.literal(CONTEXT_INPUT_VERSION).default(CONTEXT_INPUT_VERSION),
  // The project brief lives in `brief.md` (the single source); structured
  // context fields live here.
  audience: z.string().optional(),
  tone: z.string().optional(),
  target_duration_s: z.number().positive().optional(),
  must_include: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  pronunciation: z.record(z.string(), z.string()).default({}),
  voice: z.string().optional(),
  language: z.string().optional(),
  /** Per-input metadata, keyed by asset id or path. */
  assets: z.record(z.string(), ContextAssetInputSchema).default({}),
});

export type ContextInput = z.infer<typeof ContextInputSchema>;
export type ContextAssetInput = z.infer<typeof ContextAssetInputSchema>;
