import { join } from "node:path";
import { buildAss, buildSlideAss, buildTitleAss, type AssEvent } from "./captions.js";
import { visualDuration, type ResolvedEdl, type ResolvedVisual } from "./edl.js";
import { KNOWN_FORMATS, type AudioClip, type VideoClip } from "./schemas/clips.js";
import { clipDuration, parseResolution, positionExpr, type ResolvedSource } from "./av.js";

export { clipDuration, parseResolution, positionExpr };
export type { ResolvedSource };

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

export interface BuildOptions {
  root: string;
  resolveSource: (source: string) => ResolvedSource | undefined;
  ffmpeg: string;
  workDir?: string;
  preview?: boolean;
  outputOverride?: string;
}

export function buildRenderPlan(edl: ResolvedEdl, opts: BuildOptions): RenderPlan {
  const warnings: string[] = [];
  const preview = Boolean(opts.preview);
  const fmt = KNOWN_FORMATS[edl.output.format] as {
    width?: number;
    height?: number;
    fps?: number;
    video_codec?: string;
    audio_codec?: string;
    audio_sample_rate?: number;
    audio_channels?: number;
  };
  const W = preview ? 640 : (fmt.width ?? 1920);
  const H = preview ? 360 : (fmt.height ?? 1080);
  const fps = preview ? 15 : (fmt.fps ?? 30);
  const preset = preview ? "ultrafast" : edl.output.preset;
  const crf = preview ? 28 : edl.output.crf;
  const sampleRate = fmt.audio_sample_rate ?? 48000;
  const outputPath = opts.outputOverride ?? edl.output.path;

  const inputs: RenderInput[] = [];
  const filters: string[] = [];
  const artifacts: RenderPlan["artifacts"] = [];
  const textEvents: AssEvent[] = [];
  const workDir = opts.workDir ?? join(opts.root, ".vided", "work");

  interface Placed {
    item: ResolvedVisual;
    label: string;
    start: number;
    duration: number;
    audioIdx?: number;
  }
  const placed: Placed[] = [];
  let cursor = 0;

  edl.visual.forEach((item, i) => {
    const clip = item.clip;
    const label = `v${i}`;
    const duration = visualDuration(item);
    const start = cursor;
    cursor += duration;

    if (clip.kind === "video") {
      const src = opts.resolveSource(clip.source);
      if (!src) throw new Error(`Clip "${item.id}" references unknown source "${clip.source}".`);
      if (clip.out <= clip.in) warnings.push(`Clip "${item.id}" has out <= in.`);
      inputs.push({ path: src.path, options: [] });
      const idx = inputs.length - 1;
      const tin = item.transition_in ?? clip.transition_in;
      const tout = item.transition_out ?? clip.transition_out;
      const parts = [`trim=start=${clip.in}:end=${clip.out}`, `setpts=(PTS-STARTPTS)/${item.speed}`];
      if (tin?.type === "fade") parts.push(`fade=t=in:st=0:d=${tin.duration}`);
      if (tout?.type === "fade") {
        parts.push(`fade=t=out:st=${Math.max(0, clipDuration({ in: clip.in, out: clip.out, speed: item.speed }) - tout.duration)}:d=${tout.duration}`);
      }
      const scale = item.transform?.scale ?? `${W}x${H}`;
      parts.push(`scale=${scale}:force_original_aspect_ratio=decrease`);
      if (item.transform?.pad ?? true) parts.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`);
      parts.push(`fps=${fps}`, "setsar=1");
      filters.push(`[${idx}:v]${parts.join(",")}[${label}]`);
      placed.push({ item, label, start, duration, ...(clip.muted || src.audio === false ? {} : { audioIdx: idx }) });
      return;
    }

    if (clip.kind === "image") {
      const src = opts.resolveSource(clip.source);
      if (!src) throw new Error(`Image clip "${item.id}" references unknown image "${clip.source}".`);
      inputs.push({ path: src.path, options: ["-loop", "1", "-t", String(clip.duration)] });
      const idx = inputs.length - 1;
      const tin = item.transition_in ?? clip.transition_in;
      const tout = item.transition_out ?? clip.transition_out;
      const parts: string[] = [];
      if (clip.zoom) {
        const z = clip.zoom;
        parts.push(`crop=iw*${z.w}:ih*${z.h}:iw*${z.x}:ih*${z.y}`);
      }
      if (clip.fit === "cover") {
        parts.push(`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`);
      } else {
        parts.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`);
      }
      if (tin?.type === "fade") parts.push(`fade=t=in:st=0:d=${tin.duration}`);
      if (tout?.type === "fade") parts.push(`fade=t=out:st=${Math.max(0, clip.duration - tout.duration)}:d=${tout.duration}`);
      parts.push(`fps=${fps}`, "setsar=1");
      filters.push(`[${idx}:v]${parts.join(",")}[${label}]`);
      placed.push({ item, label, start, duration });
      return;
    }

    if (clip.kind === "audio") {
      throw new Error(`Visual item "${item.id}" references an audio clip.`);
    }
    const tin = item.transition_in ?? clip.transition_in;
    const tout = item.transition_out ?? clip.transition_out;
    const bg = clip.background.startsWith("#") ? `0x${clip.background.slice(1)}` : clip.background;
    const assPath = join(workDir, `${clip.kind}_${i}.ass`);
    if (clip.kind === "title") {
      artifacts.push({
        path: assPath,
        content: buildTitleAss({
          width: W, height: H, title: clip.title, subtitle: clip.subtitle, duration: clip.duration,
          titleSize: clip.style.title_size, subtitleSize: clip.style.subtitle_size,
          color: clip.style.color, subtitleColor: clip.style.subtitle_color, font: clip.style.font,
        }),
      });
    } else {
      artifacts.push({
        path: assPath,
        content: buildSlideAss({
          width: W, height: H, heading: clip.heading, body: clip.body, kind: clip.variant, duration: clip.duration,
          headingSize: clip.style.heading_size, bodySize: clip.style.body_size,
          color: clip.style.color, accent: clip.style.accent, font: clip.style.font, mono: clip.style.mono,
        }),
      });
    }
    const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const parts = [`color=c=${bg}:s=${W}x${H}:r=${fps}:d=${clip.duration}`, `ass=${safe}`];
    if (tin?.type === "fade") parts.push(`fade=t=in:st=0:d=${tin.duration}`);
    if (tout?.type === "fade") parts.push(`fade=t=out:st=${Math.max(0, clip.duration - tout.duration)}:d=${tout.duration}`);
    parts.push("setsar=1");
    filters.push(`${parts.join(",")}[${label}]`);
    placed.push({ item, label, start, duration });
  });

  const n = edl.visual.length;
  filters.push(`${placed.map((p) => `[${p.label}]`).join("")}concat=n=${n}:v=1:a=0[vcat]`);

  let vcur = "vcat";
  let next = n;

  for (const overlay of edl.overlays) {
    if (overlay.type === "image") {
      const src = opts.resolveSource(overlay.source);
      if (!src) throw new Error(`Overlay references unknown source "${overlay.source}".`);
      inputs.push({ path: src.path, options: [] });
      const idx = inputs.length - 1;
      const label = `v${next}`;
      const chain = [
        ...(overlay.width ? [`scale=${overlay.width}:-1`] : []),
        "format=rgba",
        `colorchannelmixer=aa=${overlay.opacity}`,
      ];
      filters.push(`[${idx}:v]${chain.join(",")}[ovl${next}]`);
      const { x, y } = positionExpr(overlay.position, { w: "overlay_w", h: "overlay_h" });
      filters.push(`[${vcur}][ovl${next}]overlay=${x}:${y}:enable='between(t,${overlay.start},${overlay.end})'[${label}]`);
      vcur = label;
      next++;
    } else {
      textEvents.push({
        start: overlay.start, end: overlay.end, text: overlay.text, position: overlay.position,
        font: overlay.style.font, size: overlay.style.size, color: overlay.style.color,
        box: overlay.style.box, boxColor: overlay.style.box_color,
        outline: overlay.style.outline, shadow: overlay.style.shadow,
      });
    }
  }

  if (textEvents.length) {
    const assPath = join(workDir, "overlays.ass");
    artifacts.push({ path: assPath, content: buildAss(textEvents, { width: W, height: H }) });
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

  // --- audio: attached video audio + audio-track clips, mixed ---
  const audioLabels: string[] = [];
  let aN = 0;
  for (const p of placed) {
    if (p.audioIdx === undefined || p.item.clip.kind !== "video") continue;
    const clip = p.item.clip as VideoClip;
    const delay = Math.round(p.start * 1000);
    const parts = [`atrim=start=${clip.in}:end=${clip.out}`, "asetpts=PTS-STARTPTS"];
    if (p.item.speed !== 1) parts.push(`atempo=${p.item.speed}`);
    parts.push(`aresample=${sampleRate}`);
    if (delay > 0) parts.push(`adelay=${delay}|${delay}`);
    const label = `va${aN++}`;
    filters.push(`[${p.audioIdx}:a]${parts.join(",")}[${label}]`);
    audioLabels.push(label);
  }
  for (const item of edl.audio) {
    const clip = item.clip as AudioClip;
    const src = opts.resolveSource(clip.source);
    if (!src) throw new Error(`Audio clip "${item.id}" references unknown source "${clip.source}".`);
    inputs.push({ path: src.path, options: [] });
    const idx = inputs.length - 1;
    const start = clip.in;
    const end = clip.out ?? (clip.duration !== undefined ? start + clip.duration : undefined);
    const parts = [`atrim=start=${start}${end !== undefined ? `:end=${end}` : ""}`, "asetpts=PTS-STARTPTS"];
    if (item.gain_db) parts.push(`volume=${item.gain_db}dB`);
    parts.push(`aresample=${sampleRate}`);
    const delay = Math.round(item.offset * 1000);
    if (delay > 0) parts.push(`adelay=${delay}|${delay}`);
    const label = `ax${aN++}`;
    filters.push(`[${idx}:a]${parts.join(",")}[${label}]`);
    audioLabels.push(label);
  }

  const hasAudio = audioLabels.length > 0;
  if (hasAudio) {
    let mixed = audioLabels[0]!;
    if (audioLabels.length > 1) {
      filters.push(
        `${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[amix]`,
      );
      mixed = "amix";
    }
    // loudnorm alone undershoots in single-pass dynamic mode and can emit
    // non-finite samples on digital silence (which aac rejects). dynaudnorm
    // evens out the level; alimiter clamps the non-finite peaks, so the chain
    // is target-anchored, audible and safe for silent sources.
    filters.push(
      `[${mixed}]loudnorm=I=${edl.output.loudness_lufs},dynaudnorm=f=150:g=15:p=0.95,aresample=${sampleRate},alimiter=limit=0.95[aout]`,
    );
  }

  const args: string[] = ["-y"];
  for (const input of inputs) args.push(...input.options, "-i", input.path);
  args.push("-filter_complex", filters.join(";"), "-map", "[vfinal]");
  if (hasAudio) args.push("-map", "[aout]");
  else args.push("-an");
  if (softSubIdx >= 0) {
    args.push("-map", `${softSubIdx}:s`, "-c:s", "mov_text", "-disposition:s:0", "default");
  }
  args.push("-r", String(fps), "-c:v", fmt.video_codec ?? "libx264", "-crf", String(crf), "-preset", preset);
  if (hasAudio) {
    args.push("-c:a", fmt.audio_codec ?? "aac", "-ar", String(sampleRate), "-b:a", edl.output.audio_bitrate);
  }
  args.push("-movflags", "+faststart", outputPath);

  return {
    args,
    filter: filters.join(";"),
    duration: Number(cursor.toFixed(3)),
    inputs,
    outputPath,
    warnings,
    artifacts,
  };
}
