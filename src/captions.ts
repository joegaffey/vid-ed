export interface AssEvent {
  start: number;
  end: number;
  text: string;
  position?: string;
  font?: string;
  size?: number;
  color?: string;
}

export interface AssStyle {
  font: string;
  size: number;
  color: string;
  marginV: number;
}

const NAMED_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  black: "#000000",
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  yellow: "#FFFF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
};

/** Convert a CSS-ish colour or ASS &HAA BB GG RR string to ASS &HAABBGGRR. */
export function toAssColor(input: string): string {
  const value = input.trim();
  if (/^&h[0-9a-f]{8}$/i.test(value)) return "&H" + value.slice(2).toUpperCase();
  if (/^&h[0-9a-f]{6}$/i.test(value)) return "&H00" + value.slice(2).toUpperCase();
  const hex = NAMED_COLORS[value.toLowerCase()] ?? value;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "&H00FFFFFF";
  const rr = m[1]!.slice(0, 2);
  const gg = m[1]!.slice(2, 4);
  const bb = m[1]!.slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

export function assTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

export function alignmentFor(position?: string): { an: number; marginV: number } {
  switch (position) {
    case "top-left":
      return { an: 7, marginV: 24 };
    case "top":
    case "top-center":
      return { an: 8, marginV: 24 };
    case "top-right":
      return { an: 9, marginV: 24 };
    case "center":
    case "middle":
      return { an: 5, marginV: 0 };
    case "bottom-left":
      return { an: 1, marginV: 24 };
    case "bottom-right":
      return { an: 3, marginV: 24 };
    case "bottom":
    default:
      return { an: 2, marginV: 24 };
  }
}

export function buildAss(
  events: AssEvent[],
  opts: { width: number; height: number; style?: Partial<AssStyle> },
): string {
  const style: AssStyle = {
    font: opts.style?.font ?? "DejaVu Sans",
    size: opts.style?.size ?? 42,
    color: opts.style?.color ?? "&H00FFFFFF",
    marginV: opts.style?.marginV ?? 64,
  };

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.font},${style.size},${style.color},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,${style.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const lines = events.map((e) => {
    const { an, marginV } = alignmentFor(e.position);
    const override = `{\\an${an}}`;
    const text = override + escapeAssText(e.text);
    return `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Default,,0,0,${marginV},,${text}`;
  });

  return [...header, ...lines, ""].join("\n");
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface CueOptions {
  maxCharsPerCue?: number;
  maxCharsPerLine?: number;
}

export function wrapText(text: string, maxChars: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

export function splitIntoCues(
  text: string,
  start: number,
  end: number,
  maxCharsPerCue = 84,
  maxCharsPerLine = 42,
): Cue[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxCharsPerCue) {
      chunks.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) chunks.push(cur);

  const total = chunks.reduce((n, c) => n + c.length, 0) || 1;
  const span = Math.max(0, end - start);
  let t = start;
  return chunks.map((chunk, i) => {
    const d = i === chunks.length - 1 ? Math.max(0, end - t) : (span * chunk.length) / total;
    const cue: Cue = {
      start: Number(t.toFixed(3)),
      end: Number((t + d).toFixed(3)),
      text: wrapText(chunk, maxCharsPerLine),
    };
    t += d;
    return cue;
  });
}

export function cuesFromTiming(
  segments: Array<{ text: string; start: number; end: number }>,
  opts: CueOptions = {},
): Cue[] {
  return segments.flatMap((s) =>
    splitIntoCues(s.text, s.start, s.end, opts.maxCharsPerCue, opts.maxCharsPerLine),
  );
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export function vttTime(seconds: number): string {
  return srtTime(seconds).replace(",", ".");
}

export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`)
      .join("\n\n") + "\n"
  );
}

export function toVtt(cues: Cue[]): string {
  return (
    "WEBVTT\n\n" +
    cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`).join("\n\n") +
    "\n"
  );
}

export function buildAssFromCues(
  cues: Cue[],
  opts: { width: number; height: number; style?: Partial<AssStyle> },
): string {
  return buildAss(
    cues.map((c) => ({ start: c.start, end: c.end, text: c.text, position: "bottom" })),
    opts,
  );
}

export interface TitleAssOptions {
  width: number;
  height: number;
  title: string;
  subtitle?: string;
  duration?: number;
  titleSize?: number;
  subtitleSize?: number;
  color?: string;
  subtitleColor?: string;
  font?: string;
}

/** A centred title card (title + optional subtitle) rendered via libass. */
export function buildTitleAss(opts: TitleAssOptions): string {
  const duration = opts.duration ?? 3;
  const titleSize = opts.titleSize ?? 96;
  const subtitleSize = opts.subtitleSize ?? 48;
  const font = opts.font ?? "DejaVu Sans";
  const color = toAssColor(opts.color ?? "white");
  const subtitleColor = toAssColor(opts.subtitleColor ?? "#cccccc");

  const body =
    `{\\an5\\fs${titleSize}}${escapeAssText(opts.title)}` +
    (opts.subtitle ? `\\N{\\fs${subtitleSize}}${escapeAssText(opts.subtitle)}` : "");

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${font},${titleSize},${color},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,5,40,40,40,1`,
    `Style: Sub,${font},${subtitleSize},${subtitleColor},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,5,40,40,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const line = `Dialogue: 0,${assTime(0)},${assTime(duration)},Default,,0,0,0,,${body}`;
  return [...header, line, ""].join("\n");
}

export interface SlideAssOptions {
  width: number;
  height: number;
  heading: string;
  body?: string;
  kind?: "text" | "mono";
  duration?: number;
  headingSize?: number;
  bodySize?: number;
  color?: string;
  accent?: string;
  font?: string;
  mono?: string;
}

/** A top-left aligned slide (heading + optional code/text body) via libass. */
export function buildSlideAss(opts: SlideAssOptions): string {
  const duration = opts.duration ?? 5;
  const headingSize = opts.headingSize ?? 52;
  const bodySize = opts.bodySize ?? 30;
  const font = opts.font ?? "DejaVu Sans";
  const mono = opts.mono ?? "DejaVu Sans Mono";
  const color = toAssColor(opts.color ?? "white");
  const accent = toAssColor(opts.accent ?? "#4ec9b0");
  const bodyFont = opts.kind === "mono" ? mono : font;
  const bodyMarginV = 60 + headingSize + 28;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Heading,${font},${headingSize},${accent},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,0,0,7,60,60,60,1`,
    `Style: Body,${bodyFont},${bodySize},${color},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,7,60,60,${bodyMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines = [
    `Dialogue: 0,${assTime(0)},${assTime(duration)},Heading,,0,0,0,,${escapeAssText(opts.heading)}`,
  ];
  if (opts.body) {
    lines.push(
      `Dialogue: 0,${assTime(0)},${assTime(duration)},Body,,0,0,0,,${escapeAssText(opts.body)}`,
    );
  }
  return [...header, ...lines, ""].join("\n");
}

