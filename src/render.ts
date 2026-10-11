import { join } from "node:path";
import { buildAss, buildSlideAss, buildTitleAss } from "./captions.js";
import {
  itemDuration,
  timelineDuration,
  type ResolvedEdl,
  type ResolvedVideoItem,
} from "./edl.js";
import { KNOWN_FORMATS, type AudioClip, type Transition, type VideoClip } from "./schemas/clips.js";
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

const BG = "black";

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
  const workDir = opts.workDir ?? join(opts.root, ".vided", "work");
  const resolve = opts.resolveSource;

  const duration = timelineDuration(edl, resolve);
  const D = Number((duration > 0 ? duration : 0.001).toFixed(3));

  let next = 0;
  const label = (p: string): string => `${p}${next++}`;

  // Base black canvas covering the whole timeline; tracks composite onto it.
  filters.push(`color=c=${BG}:s=${W}x${H}:r=${fps}:d=${D}[vbase]`);
  let vcur = "vbase";

  const audioLabels: string[] = [];
  let aN = 0;
  const attachedAudio = (idx: number, item: ResolvedVideoItem): void => {
    const clip = item.clip as VideoClip;
    const delay = Math.round(item.start * 1000);
    const parts = [`atrim=start=${clip.in}:end=${clip.out}`, "asetpts=PTS-STARTPTS"];
    if (item.speed !== 1) parts.push(`atempo=${item.speed}`);
    parts.push(`aresample=${sampleRate}`);
    if (delay > 0) parts.push(`adelay=${delay}|${delay}`);
    const l = `va${aN++}`;
    filters.push(`[${idx}:a]${parts.join(",")}[${l}]`);
    audioLabels.push(l);
  };

  const videoTracks = edl.tracks.filter((t) => t.kind === "video");

  for (const track of videoTracks) {
    for (const item of track.items) {
      if (item.kind !== "video") continue;
      const clip = item.clip;
      const start = item.start;
      const clipTrans = clip as { transition_in?: Transition; transition_out?: Transition };
      const tin = item.transition_in ?? clipTrans.transition_in;
      const tout = item.transition_out ?? clipTrans.transition_out;
      const shift = `+${start}/TB`;
      let stream: string;

      if (clip.kind === "video") {
        const src = resolve(clip.source);
        if (!src) throw new Error(`Clip "${item.id}" references unknown source "${clip.source}".`);
        if (clip.out <= clip.in) warnings.push(`Clip "${item.id}" has out <= in.`);
        inputs.push({ path: src.path, options: [] });
        const idx = inputs.length - 1;
        const parts = [
          `trim=start=${clip.in}:end=${clip.out}`,
          `setpts=(PTS-STARTPTS)/${item.speed}${shift}`,
        ];
        if (tin?.type === "fade") parts.push(`fade=t=in:st=0:d=${tin.duration}`);
        if (tout?.type === "fade") {
          parts.push(`fade=t=out:st=${Math.max(0, clipDuration({ in: clip.in, out: clip.out, speed: item.speed }) - tout.duration)}:d=${tout.duration}`);
        }
        const scale = item.transform?.scale ?? `${W}x${H}`;
        parts.push(`scale=${scale}:force_original_aspect_ratio=decrease`);
        if (item.transform?.pad ?? true) parts.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`);
        parts.push(`fps=${fps}`, "setsar=1");
        stream = label("iv");
        filters.push(`[${idx}:v]${parts.join(",")}[${stream}]`);
        if (!clip.muted && src.audio !== false) attachedAudio(idx, item);
      } else if (clip.kind === "image") {
        const src = resolve(clip.source);
        if (!src) throw new Error(`Image clip "${item.id}" references unknown image "${clip.source}".`);
        inputs.push({ path: src.path, options: ["-loop", "1", "-t", String(clip.duration)] });
        const idx = inputs.length - 1;
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
        parts.push(`fps=${fps}`, `setpts=PTS-STARTPTS${shift}`, "setsar=1");
        stream = label("iv");
        filters.push(`[${idx}:v]${parts.join(",")}[${stream}]`);
      } else if (clip.kind === "title" || clip.kind === "slide" || clip.kind === "text") {
        // Generated kinds: title/slide are opaque cards, text is transparent.
        const assPath = join(workDir, `${clip.kind}_${next}.ass`);
        const dur = clip.duration;
        if (clip.kind === "title") {
          artifacts.push({
            path: assPath,
            content: buildTitleAss({
              width: W, height: H, title: clip.title, subtitle: clip.subtitle, duration: dur,
              titleSize: clip.style.title_size, subtitleSize: clip.style.subtitle_size,
              color: clip.style.color, subtitleColor: clip.style.subtitle_color, font: clip.style.font,
            }),
          });
        } else if (clip.kind === "slide") {
          artifacts.push({
            path: assPath,
            content: buildSlideAss({
              width: W, height: H, heading: clip.heading, body: clip.body, kind: clip.variant, duration: dur,
              headingSize: clip.style.heading_size, bodySize: clip.style.body_size,
              color: clip.style.color, accent: clip.style.accent, font: clip.style.font, mono: clip.style.mono,
            }),
          });
        } else {
          artifacts.push({
            path: assPath,
            content: buildAss(
              [{
                start: 0, end: dur, text: clip.text, position: clip.position,
                font: clip.style.font, size: clip.style.size, color: clip.style.color,
                box: clip.style.box, boxColor: clip.style.box_color,
                outline: clip.style.outline, shadow: clip.style.shadow,
              }],
              { width: W, height: H },
            ),
          });
        }
        const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        const bg =
          clip.kind === "text"
            ? "black@0.0"
            : clip.background.startsWith("#")
              ? `0x${clip.background.slice(1)}`
              : clip.background;
        const parts = [`color=c=${bg}:s=${W}x${H}:r=${fps}:d=${dur}`];
        if (clip.kind === "text") parts.push("format=rgba");
        parts.push(`ass=${safe}`);
        if (tin?.type === "fade") parts.push(`fade=t=in:st=0:d=${tin.duration}`);
        if (tout?.type === "fade") parts.push(`fade=t=out:st=${Math.max(0, dur - tout.duration)}:d=${tout.duration}`);
        parts.push(`setpts=PTS-STARTPTS${shift}`, "setsar=1");
        stream = label("iv");
        filters.push(`${parts.join(",")}[${stream}]`);
      } else {
        throw new Error(`Video item "${item.id}" references a ${clip.kind} clip.`);
      }

      if (item.opacity < 1) {
        const o = label("oa");
        filters.push(`[${stream}]format=rgba,colorchannelmixer=aa=${item.opacity}[${o}]`);
        stream = o;
      }
      const { x, y } = positionExpr(item.position, { w: "overlay_w", h: "overlay_h" });
      const end = Number((start + itemDuration(item, resolve)).toFixed(3));
      const transparent = clip.kind === "text" || item.opacity < 1;
      const outN = label("v");
      filters.push(
        `[${vcur}][${stream}]overlay=${x}:${y}:eof_action=pass${transparent ? ":format=auto" : ""}:enable='between(t,${start},${end})'[${outN}]`,
      );
      vcur = outN;
    }
  }

  let softSubIdx = -1;
  if (edl.captions.mode !== "none" && edl.captions.file) {
    const cap = resolve(edl.captions.file);
    if (!cap) throw new Error(`Captions file "${edl.captions.file}" not found.`);
    if (edl.captions.mode === "burn") {
      const l = label("v");
      const safe = cap.path.replace(/\\/g, "/").replace(/:/g, "\\:");
      filters.push(`[${vcur}]ass=${safe}[${l}]`);
      vcur = l;
    } else {
      inputs.push({ path: cap.path, options: [] });
      softSubIdx = inputs.length - 1;
    }
  }

  filters.push(`[${vcur}]format=yuv420p[vfinal]`);

  // --- audio: audio-track clips (attached video audio collected above) ---
  for (const track of edl.tracks) {
    if (track.kind !== "audio") continue;
    for (const item of track.items) {
      if (item.kind !== "audio") continue;
      const clip = item.clip as AudioClip;
      const src = resolve(clip.source);
      if (!src) throw new Error(`Audio clip "${item.id}" references unknown source "${clip.source}".`);
      inputs.push({ path: src.path, options: [] });
      const idx = inputs.length - 1;
      const startIn = clip.in;
      const end = clip.out ?? (clip.duration !== undefined ? startIn + clip.duration : undefined);
      const dur = end !== undefined ? end - startIn : undefined;
      const parts = [`atrim=start=${startIn}${end !== undefined ? `:end=${end}` : ""}`, "asetpts=PTS-STARTPTS"];
      if (item.fade_in && item.fade_in > 0) parts.push(`afade=t=in:st=0:d=${item.fade_in}`);
      if (item.fade_out && item.fade_out > 0) {
        if (dur !== undefined && dur > item.fade_out) {
          parts.push(`afade=t=out:st=${Number((dur - item.fade_out).toFixed(3))}:d=${item.fade_out}`);
        } else {
          warnings.push(`Audio item "${item.id}" fade_out ignored: clip length unknown or shorter than the fade.`);
        }
      }
      if (item.gain_db) parts.push(`volume=${item.gain_db}dB`);
      parts.push(`aresample=${sampleRate}`);
      const delay = Math.round(item.start * 1000);
      if (delay > 0) parts.push(`adelay=${delay}|${delay}`);
      const l = `ax${aN++}`;
      filters.push(`[${idx}:a]${parts.join(",")}[${l}]`);
      audioLabels.push(l);
    }
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
    //
    // aformat pins an explicit layout before alimiter: a mono, untagged source
    // (e.g. a Piper voice-over) leaves alimiter unable to negotiate a layout on
    // ffmpeg 4.4.x and aborts the render. No-op when the mix is already stereo.
    filters.push(
      `[${mixed}]loudnorm=I=${edl.output.loudness_lufs},dynaudnorm=f=150:g=15:p=0.95,aresample=${sampleRate},aformat=channel_layouts=stereo,alimiter=limit=0.95[aout]`,
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
    duration: Number(D.toFixed(3)),
    inputs,
    outputPath,
    warnings,
    artifacts,
  };
}
