# AGENTS.md — working in this repo

`vided` is an agentic video editor toolset. This file is for AI coding agents
(opencode, Kiro, Claude Code) working **on** the project. `vided init` also
writes a per-project `AGENTS.md` at the project root documenting how to use the
CLI.

## Architecture (read SPEC.md for the full spec)

Three phases with a hard contract between each:

```
ANALYZE (expensive, cached) -> MANIFEST -> COMPOSE (agent) -> RENDER (ffmpeg)
```

- **Analyze** stages (`scan`, `extract-text`, `sample`, `dedupe`, `annotate`)
  write derived data into `.vided/` and cache results by content hash.
- **Manifest** (`.vided/manifest.json`) is the single contract the agent reads.
  Never re-read raw media once it is in the manifest.
- **Compose** is the agent's job: read the manifest/context pack and write
  `edit.yaml` (EDL). Validate with `vided compose --check`.
- **Render** is deterministic: the EDL is translated to an ffmpeg graph.

## Hard rules

- The agent writes `edit.yaml`, **never** raw ffmpeg commands.
- Expensive work must be cached (see `src/cache.ts`); never recompute unchanged
  inputs.
- Vision/LLM calls only run on frames that survived `dedupe`.
- Heavy work is delegated to native binaries (ffmpeg, whisper.cpp, piper)
  resolved via `src/tools/resolve.ts`. Do not add Python as a baseline dep.
- All schemas live in `src/schemas/*` (zod) and are the source of truth for the
  asset/manifest/EDL contracts.

## Layout

```
src/cli.ts             command dispatch, JSON I/O
src/tools/resolve.ts   locate/version native binaries
src/probe.ts           ffprobe + hashing + kind detection
src/hash.ts            pHash/dHash perceptual hashing
src/text.ts            whisper.cpp / OCR / sidecar extraction
src/frames.ts          scene detection + frame sampling
src/dedupe.ts          pHash clustering + vision budget
src/config.ts          project config + paths
src/cache.ts           content-addressed cache
src/manifest.ts        manifest assembly + source resolution
src/edl.ts             EDL validate / explain / lint
src/render.ts          EDL -> ffmpeg graph
src/tts.ts             piper narration synthesis + timing
src/captions.ts        ASS/SRT/VTT generation
src/context.ts         context-pack builder (agent-facing)
src/models.ts          install piper binary + voices
src/schemas/           zod contracts
src/commands/          one file per CLI command
mcp/                   (future, optional) MCP server
samples/               demo projects: inputs, rendered outputs, captions, context packs
```

## Commands

```sh
npm install
npm run build        # tsc -> dist/
npm run typecheck
npm test
npm run dev -- <args>   # tsx src/cli.ts
```

### Working a project (order matters)

Run commands with `--dir <project>` (or from the project root). Positional file
arguments (`edit.yaml`) resolve relative to the project when `--dir` is set.

```sh
vided init
vided scan
vided extract-text              # optional; transcription needs whisper
vided sample
vided dedupe
vided clips                     # REQUIRED before the context pack (if media present)
vided manifest --context-pack work/context.md   # also writes work/context.json
#   ... read work/context.md, then write edit.yaml ...
vided compose edit.yaml --check --lint
vided render edit.yaml
vided render --clip <id>        # preview one clip at its own format (cached)
```

`vided scan` uses the project's configured input roots, so bare `vided scan`
works after `init`. Clips added or changed **after** the context pack was built
don't appear in it until you re-run `vided manifest --context-pack …`.

Minimal `clips.yaml` + `edit.yaml`. A clip is defined **only** in `clips.yaml`;
`edit.yaml` references it by `use:` (every `tracks.visual[]` item needs `id`).
`clips --add` takes a **single** clip object (JSON), not an array. Generated
kinds (`title`/`slide`) use `source: generated` and a `title` (or `heading`).

```yaml
# clips.yaml
schema: vided.clips/1
clips:
  - { id: sel-a, kind: video, source: input/a.mp4, format: 1080p30, in: 0, out: 4 }
  - { id: title-open, kind: title, source: generated, format: 1080p30, title: "Demo", duration: 3 }
```

```yaml
# edit.yaml
schema: vided.edl/3
output: { format: 1080p30, path: out/final.mp4 }
tracks:
  visual:
    - { id: intro, use: title-open }
    - { id: a, use: sel-a }
  audio: []
```

`output.format` should match the clips' `format`; a mismatch is reported by
`compose --lint` (not an error). Derived clips are stamped from the source's
resolution where it maps to a known format, else `1080p30`.

### Vision (frame descriptions)

`sample` + `dedupe` pick the frames; `annotate` gets them described. The packet
lists each frame's image path, and a vision-capable model reads those JPEGs
directly:

```sh
vided annotate --packet-out work/vision.packet.json   # packet + results template
# open each frame image (e.g. .vided/frames/<assetId>/u_00001.jpg); fill
# `description`/`tags` in work/vision.results.json; optionally set in/out
vided annotate --ingest work/vision.results.json
```

Descriptions land on `visual.frames[].description`, flow into the context pack,
and their `tags` are merged onto the asset. Re-run
`vided manifest --context-pack` afterwards. Without this step the composer sees
only timestamps — no idea what the footage shows.

## Starter prompts

A user should be able to start from a one-line ask. Typical prompts an agent
must satisfy from this file alone:

- "Make a narrated video from these clips."
- "Cut these clips into a 30-second vertical teaser."
- "Make a warm ~90s demo for sim racers, narrated, with captions."

### Recipe: a narrated video

1. `vided scan` → `extract-text` → `sample` → `dedupe` → `annotate` (describe
   the frames; see Vision above).
2. Write `brief.md` (audience/tone/target length), then
   `vided manifest --context-pack work/context.md` and read it.
3. `vided script --out narration.yaml` (scaffolds beats from described frames);
   rewrite the prose. Then `vided tts narration.yaml` → `work/narration.wav`
   (+ `work/narration.timing.json`). Trim visual clips to roughly the narration
   length — derived scene clips can be long (`clips --add` a shorter range).
4. `vided captions --from narration --formats srt,vtt,ass` → `work/captions.ass`
   (burn needs the `.ass`; the default is srt,vtt only).
5. `vided clips`; add generated cards with `clips --add`, and register the
   narration as an audio clip, e.g.
   `clips --add '{"id":"vo","kind":"audio","source":"work/narration.wav","format":"audio48k"}'`.
6. Write `edit.yaml`: visual clips on `tracks.visual`, the narration on
   `tracks.audio: [{ id: vo, use: vo }]`, and
   `captions: { mode: burn, file: work/captions.ass }`.
7. `vided compose edit.yaml --check --lint`, then `vided render edit.yaml`.

Install the optional native tools into a project with:

```sh
vided models --install piper                      # piper binary -> .vided/tools/piper/
vided models --install voice --voice en_US-amy-medium
vided voices amy                                  # search the voice catalogue
```

## Current status

M0 complete: `init`, `doctor`, `scan`, `status`.
M1 complete: `extract-text` (whisper.cpp + sidecar + optional OCR),
`sample` (ffmpeg scene detection + initial sample rate), `dedupe` (pHash
clustering + cross-asset dedupe + density-based vision budget).
M2 complete: `compose` (EDL check/explain/lint) and `render` (trim/concat,
image + text overlays via libass, audio mix + ducking + loudnorm,
`--dry-run`/`--preview`).
M3 complete: `tts` (Piper narration -> work/narration.wav + timing) and
`captions` (narration/transcript -> SRT/VTT/ASS); render burns captions via
libass or muxes soft mov_text.
M4 complete: `annotate` (vision packet `--packet-out` / `--ingest` round-trip),
`manifest --context-pack` (distilled context.md + context.json, folding in
`brief.md` and per-input `<media>.md` sidecars), `script` (narration scaffold
from annotated frames), and cost reporting in `status`. M5: Kokoro/alignment/
preview. (MCP is a future/optional feature, not committed.)

Clips stage: `vided clips` derives `clips.yaml` (`vided.clips/1`) — the pool
every edit composes from — seeded from the manifest (transcript beats, frame
clusters, scenes; images/audio yield one clip each). Clips are agent/studio
editable (`--add/--set/--rm`). Every clip has a `kind` (`video`/`image`/`audio`/
`title`/`slide`), a `source` (or `"generated"` for title/slide) and a `format`.
The edit schema is `vided.edl/3`: `tracks.visual` and `tracks.audio` reference
clips by `use:`, so trimming a clip in `clips.yaml` affects everywhere it is
used. `vided render --clip <id>` previews one clip at its own format (cached).

Clip formats (canonical list in `src/schemas/clips.ts`; pick a `format` name
from this set): `1080p30`, `1080p60`, `720p30`, `vertical1080p30`,
`square1080p30`, `audio48k`. A clip whose format differs from the edit's
`output.format` is reported by `compose --lint`. Audio is part of a video clip
unless `muted`, or unless it is sampled out into its own `audio` clip (which
becomes a new source to analyse).
