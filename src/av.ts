/** Small AV helpers shared by the EDL resolver and the renderer. */

export interface ResolvedSource {
  path: string;
  kind?: string;
  duration?: number;
  /** Whether the source has an audio stream (undefined = unknown). */
  audio?: boolean;
}

export function parseResolution(res: string): [number, number] {
  const m = /^(\d+)x(\d+)$/.exec(res);
  if (!m) throw new Error(`Invalid resolution "${res}" (expected WxH).`);
  return [Number(m[1]), Number(m[2])];
}

export function clipDuration(clip: { in: number; out: number; speed: number }): number {
  return Math.max(0, (clip.out - clip.in) / clip.speed);
}

type Vars = { w: string; h: string };

export function positionExpr(position: string, v: Vars): { x: string; y: string } {
  const { w, h } = v;
  switch (position) {
    case "top-left":
      return { x: "20", y: "20" };
    case "top-right":
      return { x: `main_w-${w}-20`, y: "20" };
    case "bottom-left":
      return { x: "20", y: `main_h-${h}-20` };
    case "bottom-right":
      return { x: `main_w-${w}-20`, y: `main_h-${h}-20` };
    case "center":
      return { x: `(main_w-${w})/2`, y: `(main_h-${h})/2` };
    case "top":
      return { x: `(main_w-${w})/2`, y: "20" };
    case "bottom":
    default:
      return { x: `(main_w-${w})/2`, y: `main_h-${h}-20` };
  }
}
