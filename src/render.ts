import { join } from "node:path";
import { buildAss, buildSlideAss, buildTitleAss, type AssEvent } from "./captions.js";
import { isSlide, isStill, isTitleCard, type Edl } from "./schemas/edl.js";

export interface ResolvedSource {
  path: string;
  kind?: string;
  duration?: number;
}

export interface RenderInput {
  path: string;
  options: string[];
}

export interface RenderPlan {
  args: string[];
  filter: string;
  duration: number;
  inputs: RenderInput[];
  outputPath: string;
  warnings: string[];
  artifacts: Array<{ path: string; content: string }>;
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

export interface BuildOptions {
  root: string;
  resolveSource: (source: string) => ResolvedSource | undefined;
  ffmpeg: string;
  workDir?: string;
  preview?: boolean;
  outputOverride?: string;
}

export function buildRenderPlan(edl: Edl, opts: BuildOptions): RenderPlan {
  const warnings: string[] = [];
  const preview = Boolean(opts.preview);
  const output = {
    ...edl.output,
    resolution: preview ? "640x360" : edl.output.resolution,
    fps: preview ? 15 : edl.output.fps,
    preset: preview ? "ultrafast" : edl.output.preset,
    crf: preview ? 28 : edl.output.crf,
    path: opts.outputOverride ?? edl.output.path,
  };
  const [W, H] = parseResolution(output.resolution);

  const inputs: RenderInput[] = [];
  const filters: string[] = [];
  const artifacts: RenderPlan["artifacts"] = [];
  const textEvents: AssEvent[] = [];
  const workDir = opts.workDir ?? join(opts.root, ".vided", "work");
  const duration = edl.timeline.reduce(
    (n, item) =>
      n + (isTitleCard(item) || isSlide(item) || isStill(item) ? item.duration : clipDuration(item)),
    0,
  );

  edl.timeline.forEach((item, i) => {
    if (isStill(item)) {
      const src = opts.resolveSource(item.image);
      if (!src) throw new Error(`Still "${item.id}" references unknown image "${item.image}".`);
      inputs.push({
        path: src.path,
        options: ["-loop", "1", "-t", String(item.duration)],
      });
      const idx = inputs.length - 1;
      const parts: string[] = [];
      if (item.zoom) {
        const z = item.zoom;
        parts.push(`crop=iw*${z.w}:ih*${z.h}:iw*${z.x}:ih*${z.y}`);
      }
      if (item.fit === "cover") {
        parts.push(`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`);
      } else {
        parts.push(
          `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
        );
      }
      if (item.transition_in?.type === "fade") {
        parts.push(`fade=t=in:st=0:d=${item.transition_in.duration}`);
      }
      if (item.transition_out?.type === "fade") {
        const d = item.transition_out.duration;
        parts.push(`fade=t=out:st=${Math.max(0, item.duration - d)}:d=${d}`);
      }
      parts.push(`fps=${output.fps}`, "setsar=1");
      filters.push(`[${idx}:v]${parts.join(",")}[v${i}]`);
      return;
    }

    if (isSlide(item)) {
      const bg = item.background.startsWith("#")
        ? `0x${item.background.slice(1)}`
        : item.background;
      const assPath = join(workDir, `slide_${i}.ass`);
      artifacts.push({
        path: assPath,
        content: buildSlideAss({
          width: W,
          height: H,
          heading: item.slide,
          body: item.body,
          kind: item.kind,
          duration: item.duration,
          headingSize: item.style.heading_size,
          bodySize: item.style.body_size,
          color: item.style.color,
          accent: item.style.accent,
          font: item.style.font,
          mono: item.style.mono,
        }),
      });
      const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      const parts = [
        `color=c=${bg}:s=${W}x${H}:r=${output.fps}:d=${item.duration}`,
        `ass=${safe}`,
      ];
      if (item.transition_in?.type === "fade") {
        parts.push(`fade=t=in:st=0:d=${item.transition_in.duration}`);
      }
      if (item.transition_out?.type === "fade") {
        const d = item.transition_out.duration;
        parts.push(`fade=t=out:st=${Math.max(0, item.duration - d)}:d=${d}`);
      }
      parts.push("setsar=1");
      filters.push(`${parts.join(",")}[v${i}]`);
      return;
    }

    if (isTitleCard(item)) {
      const bg = item.background.startsWith("#")
        ? `0x${item.background.slice(1)}`
        : item.background;
      const assPath = join(workDir, `title_${i}.ass`);
      artifacts.push({
        path: assPath,
        content: buildTitleAss({
          width: W,
          height: H,
          title: item.title,
          subtitle: item.subtitle,
          duration: item.duration,
          titleSize: item.style.title_size,
          subtitleSize: item.style.subtitle_size,
          color: item.style.color,
          subtitleColor: item.style.subtitle_color,
          font: item.style.font,
        }),
      });
      const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      const parts = [
        `color=c=${bg}:s=${W}x${H}:r=${output.fps}:d=${item.duration}`,
        `ass=${safe}`,
      ];
      if (item.transition_in?.type === "fade") {
        parts.push(`fade=t=in:st=0:d=${item.transition_in.duration}`);
      }
      if (item.transition_out?.type === "fade") {
        const d = item.transition_out.duration;
        parts.push(`fade=t=out:st=${Math.max(0, item.duration - d)}:d=${d}`);
      }
      parts.push("setsar=1");
      filters.push(`${parts.join(",")}[v${i}]`);
      return;
    }

    const clip = item;
    const src = opts.resolveSource(clip.source);
    if (!src) throw new Error(`Timeline clip "${clip.id}" references unknown source "${clip.source}".`);
    if (clip.out <= clip.in) warnings.push(`Clip "${clip.id}" has out <= in.`);
    inputs.push({ path: src.path, options: [] });
    const idx = inputs.length - 1;

    const parts = [
      `trim=start=${clip.in}:end=${clip.out}`,
      `setpts=(PTS-STARTPTS)/${clip.speed}`,
    ];
    if (clip.transition_in?.type === "fade") {
      parts.push(`fade=t=in:st=0:d=${clip.transition_in.duration}`);
    }
    if (clip.transition_out?.type === "fade") {
      const d = clip.transition_out.duration;
      parts.push(`fade=t=out:st=${Math.max(0, clipDuration(clip) - d)}:d=${d}`);
    }
    const scale = clip.transform?.scale ?? `${W}x${H}`;
    parts.push(`scale=${scale}:force_original_aspect_ratio=decrease`);
    if (clip.transform?.pad ?? true) {
      parts.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`);
    }
    parts.push(`fps=${output.fps}`, "setsar=1");
    filters.push(`[${idx}:v]${parts.join(",")}[v${i}]`);
  });

  const n = edl.timeline.length;
  filters.push(
    `${edl.timeline.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[vcat]`,
  );

  let vcur = "vcat";
  let next = n;

  for (const overlay of edl.overlays) {
    if (overlay.type === "image") {
      const src = opts.resolveSource(overlay.source);
      if (!src) throw new Error(`Overlay references unknown source "${overlay.source}".`);
      inputs.push({ path: src.path, options: [] });
      const label = `v${next}`;
      const chain = [
        ...(overlay.width ? [`scale=${overlay.width}:-1`] : []),
        "format=rgba",
        `colorchannelmixer=aa=${overlay.opacity}`,
      ];
      filters.push(`[${next}:v]${chain.join(",")}[ovl${next}]`);
      const { x, y } = positionExpr(overlay.position, { w: "overlay_w", h: "overlay_h" });
      filters.push(
        `[${vcur}][ovl${next}]overlay=${x}:${y}:enable='between(t,${overlay.start},${overlay.end})'[${label}]`,
      );
      vcur = label;
      next++;
    } else {
      textEvents.push({
        start: overlay.start,
        end: overlay.end,
        text: overlay.text,
        position: overlay.position,
        font: overlay.style.font,
        size: overlay.style.size,
        color: overlay.style.color,
        box: overlay.style.box,
        boxColor: overlay.style.box_color,
        outline: overlay.style.outline,
        shadow: overlay.style.shadow,
      });
    }
  }

  if (textEvents.length) {
    const assPath = join(workDir, "overlays.ass");
    artifacts.push({
      path: assPath,
      content: buildAss(textEvents, { width: W, height: H }),
    });
    const label = `v${next}`;
    const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    filters.push(`[${vcur}]ass=${safe}[${label}]`);
    vcur = label;
    next++;
  }

  let softSubIdx = -1;
  if (edl.captions.mode !== "none" && edl.captions.file) {
    const cap = opts.resolveSource(edl.captions.file);
    if (!cap) throw new Error(`Captions file "${edl.captions.file}" not found.`);
    if (edl.captions.mode === "burn") {
      const label = `v${next}`;
      const safe = cap.path.replace(/\\/g, "/").replace(/:/g, "\\:");
      filters.push(`[${vcur}]ass=${safe}[${label}]`);
      vcur = label;
      next++;
    } else {
      inputs.push({ path: cap.path, options: [] });
      softSubIdx = inputs.length - 1;
    }
  }

  filters.push(`[${vcur}]format=yuv420p[vfinal]`);

  const vo = edl.audio.voiceover;
  const music = edl.audio.music;
  let hasAudio = false;
  if (vo || music) {
    hasAudio = true;
    let voIdx = -1;
    let muIdx = -1;
    if (vo) {
      const src = opts.resolveSource(vo.source);
      if (!src) throw new Error(`Voiceover references unknown source "${vo.source}".`);
      inputs.push({ path: src.path, options: [] });
      voIdx = inputs.length - 1;
    }
    if (music) {
      const src = opts.resolveSource(music.source);
      if (!src) throw new Error(`Music references unknown source "${music.source}".`);
      inputs.push({ path: src.path, options: music.loop ? ["-stream_loop", "-1"] : [] });
      muIdx = inputs.length - 1;
    }

    const delay = vo && vo.start > 0 ? `,adelay=${Math.round(vo.start * 1000)}|${Math.round(vo.start * 1000)}` : "";
    if (vo && music) {
      filters.push(
        `[${voIdx}:a]volume=${vo.gain_db}dB${delay},asplit=2[voa][vos]`,
      );
      filters.push(
        `[${muIdx}:a]volume=${music.gain_db}dB,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[mua]`,
      );
      if (music.duck_under_voiceover) {
        filters.push(`[mua][vos]sidechaincompress=threshold=0.05:ratio=8[ducked]`);
        filters.push(`[ducked][voa]amix=inputs=2:duration=longest:normalize=0[amixed]`);
      } else {
        filters.push(`[mua][voa]amix=inputs=2:duration=longest:normalize=0[amixed]`);
      }
      filters.push(`[amixed]loudnorm=I=${output.loudness_lufs}[aout]`);
    } else if (vo) {
      filters.push(`[${voIdx}:a]volume=${vo.gain_db}dB${delay},loudnorm=I=${output.loudness_lufs}[aout]`);
    } else if (music) {
      filters.push(
        `[${muIdx}:a]volume=${music.gain_db}dB,atrim=0:${duration.toFixed(3)},loudnorm=I=${output.loudness_lufs}[aout]`,
      );
    }
  }

  const args: string[] = ["-y"];
  for (const input of inputs) args.push(...input.options, "-i", input.path);
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vfinal]",
  );
  if (hasAudio) args.push("-map", "[aout]");
  else args.push("-an");
  if (softSubIdx >= 0) {
    args.push(
      "-map", `${softSubIdx}:s`,
      "-c:s", "mov_text",
      "-disposition:s:0", "default",
    );
  }
  args.push(
    "-r", String(output.fps),
    "-c:v", output.video_codec,
    "-crf", String(output.crf),
    "-preset", output.preset,
  );
  if (hasAudio) args.push("-c:a", output.audio_codec);
  args.push("-movflags", "+faststart", output.path);

  return {
    args,
    filter: filters.join(";"),
    duration: Number(duration.toFixed(3)),
    inputs,
    outputPath: output.path,
    warnings,
    artifacts,
  };
}
