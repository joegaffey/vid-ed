import { z } from "zod";

export const PACKET_VERSION = "vided.vision.packet/1";
export const RESULTS_VERSION = "vided.vision.results/1";

export const PacketFrameSchema = z.object({
  asset: z.string(),
  asset_path: z.string(),
  frame: z.string(),
  t: z.number(),
  scene: z.string().optional(),
  scene_start: z.number().optional(),
  scene_end: z.number().optional(),
  transcript: z.string().optional(),
  ocr: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const VisionPacketSchema = z.object({
  schema: z.literal(PACKET_VERSION),
  created_at: z.string(),
  instructions: z.string().optional(),
  frames: z.array(PacketFrameSchema),
});

export const ResultFrameSchema = z.object({
  frame: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  quality: z.number().min(0).max(1).optional(),
  in: z.number().optional(),
  out: z.number().optional(),
});

export const VisionResultsSchema = z.object({
  schema: z.literal(RESULTS_VERSION),
  frames: z.array(ResultFrameSchema),
});

export type VisionPacket = z.infer<typeof VisionPacketSchema>;
export type PacketFrame = z.infer<typeof PacketFrameSchema>;
export type VisionResults = z.infer<typeof VisionResultsSchema>;
export type ResultFrame = z.infer<typeof ResultFrameSchema>;
