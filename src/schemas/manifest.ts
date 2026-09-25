import { z } from "zod";
import { AssetRecordSchema } from "./asset.js";

export const SCHEMA_VERSION = "vided.manifest/1";

export const ManifestSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  project: z.string(),
  created_at: z.string(),
  input_roots: z.array(z.string()),
  config_hash: z.string(),
  assets: z.array(AssetRecordSchema),
  totals: z.object({
    assets: z.number().int(),
    duration_s: z.number(),
    unique_frames: z.number().int(),
  }),
});

export type Manifest = z.infer<typeof ManifestSchema>;
