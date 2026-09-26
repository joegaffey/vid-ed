# vided — Agentic Video Editor Toolset

Status: DRAFT (initial spec)
Audience: implementers + CLI AI agents (opencode, Kiro, Claude Code)

## 1. Summary

`vided` is a command-line toolset that lets an agentic coding assistant
(opencode, Kiro, Claude Code, etc.) turn a folder of raw media into a finished
edit with:

- a **narrated voice-over**,
- **on-screen caption overlays**,
- and a **closed-caption sidecar** (SRT / VTT / ASS).

The agent does the *creative reasoning*; `vided` does the *deterministic media
work*. Every `vided` command is non-interactive, accepts machine-readable input,
and returns structured JSON on stdout so the agent can chain commands reliably.

The central idea is a three-phase pipeline with a hard contract between each
phase:

```
  ANALYZE (expensive, cached)      CLIPS (pool)          COMPOSE (agent)                  RENDER (deterministic)
  ----------------------------     ------------          ----------------------------     ----------------------
  probe -> extract text ->         derive a seed         agent reads manifest +           EDL -> ffmpeg graph ->
  sample frames -> dedupe ->       pool of clips ->      clips.yaml, writes edit          audio + video + captions
  annotate -> MANIFEST             clips.yaml            script (EDL) edit.yaml           output + .srt/.vtt
```

`clips.yaml` is the pool every edit composes from: each **clip** is an atomic,
individually renderable unit with a `kind` (video/image/audio/title/slide) and
an output `format`. `edit.yaml` (`vided.edl/3`) references clips by `use:` on a
`tracks.visual` / `tracks.audio` pair. See §5.8.

Expensive steps (transcription, vision annotation, TTS) are cached by content
hash, so re-running the pipeline never pays twice for unchanged inputs.

## 2. Goals

- Ingest a mixed set of video, audio, and image files from a directory.
- Extract textual content from each asset using the best available tool:
  - audio/video -> speech transcription (word-level timestamps),
  - images -> OCR and (optionally) agent vision description,
  - sidecar/subtitle files -> parsed text,
  - container metadata (ffprobe) -> technical facts.
- Sample video into static frames and **deduplicate** them so the vision model
  sees the minimum number of unique frames.
- Record every asset's metadata + extracted information in a **manifest** that
  is sufficient to compose an edit without re-reading the originals.
- Let the agent compose a declarative **edit script** (EDL) from the manifest.
- Execute that edit script with ffmpeg (and friends) to produce the final media.
- Generate a narration voice-over (local TTS by default) and synchronise
  captions to it.
- Emit a standards-compliant closed-caption file.

## 3. Non-goals (v1)

- GUI / NLE timeline interaction.
- Real-time preview or streaming.
- Generative video synthesis.
- Automatic music composition (only mixing/ducking of provided beds).
- Cloud-required workflows (all defaults must run offline).

## 4. Design principles

1. **Agent-first CLI.** Commands are verbs, JSON in / JSON out, exit codes are
   meaningful, `--json` is the default for machine consumption, `--human` for
   pretty output.
2. **Content-addressed caching.** Every derived artifact is keyed by
   `sha256(input) + tool + tool_version + params`. Cache lives in `.vided/cache`.
3. **Contracts over conventions.** The manifest and EDL have versioned JSON
   Schemas. Both sides (producer and consumer) validate.
4. **Cheap before expensive.** Deterministic analysis (ffprobe, hashing, scene
   detection) runs before any model call. Vision calls only happen on frames
   that survived deduplication.
5. **Idempotent + resumable.** Interrupting at any stage and re-running
   continues from cache.
6. **No hidden state.** The project directory (`.vided/`) is the single source
   of truth and is safe to delete / rebuild.

## 5. Pipeline stages

### 5.1 `init` — project scaffolding
Creates `.vided/` with `config.yaml`, empty `manifest.json`, `cache/`,
`frames/`, `work/`, and an `AGENTS.md` that teaches the agent the workflow.

### 5.2 `scan` — discover + probe
- Walk input roots for media by extension and by magic bytes (ffprobe).
- Run `ffprobe -show_streams -show_format -print_format json` per file.
- Compute `sha256` (or fast `xxhash64` for large files) for identity.
- Emit one `AssetRecord` per file with `technical` populated and
  `status: probed`.

### 5.3 `extract-text` — per-modality text extraction
- **video/audio**: demux audio with ffmpeg -> transcribe with
  `whisper.cpp` (default). Capture segment + word timestamps, detected
  language, and confidence. `faster-whisper` available via optional sidecar.
- **image**: OCR with `tesseract.js` (or PaddleOCR sidecar for quality);
  optionally queue the image for vision description during `annotate`.
- **text/subtitle sidecars** (`.srt/.vtt/.txt/.md`): parse and attach.
- Store `extracted.transcript` / `extracted.ocr` / `extracted.sidecar` on the
  asset. Audio extraction and transcription are both cached.

### 5.4 `sample` — video -> frames
- **Scene detection** via ffmpeg `select='gt(scene,T)',showinfo` (default
  `T=0.25`); optional `PySceneDetect` sidecar for finer control.
- **Uniform sampling** at the configured **initial sample rate**
  (`sampling.frames_per_minute`, default 30 → one frame every 2s) plus scene
  cuts. `--every <s>` or `--rate <n>` override. This candidate pool is the
  ceiling that `dedupe` reduces from, so it must be denser than the target.
- Emit candidate frames as downscaled JPEG (default max width 512 px) to
  keep vision tokens low.
- Record per-frame `t`, source scene id, and score.

### 5.5 `dedupe` — minimise unique frames
- Compute a perceptual hash per candidate frame (pHash 64-bit; dHash as
  tie-breaker) plus an optional CLIP embedding for semantic near-duplicates.
- Cluster by Hamming distance (`<= 6` for pHash) using union-find; keep the
  sharpest/most-central frame per cluster as the representative.
- Deduplicate globally across clips (same visual content reused) and across
  time within a clip.
- Respect a **density-based vision budget**: keep
  `round(duration_minutes * target_frames_per_minute)` representatives per
  asset, clamped to `[min_frames_per_asset, max_frames_per_asset]`, and capped
  overall by `vision_budget_total`. Selections are spread evenly across the
  timeline. `--budget` overrides with a flat per-asset count. Because
  `selected = min(representatives, budget)`, the initial sample rate must
  exceed the target or `dedupe` warns.
- Mark `visual.selected: true` only on representatives.

### 5.6 `annotate` — agent vision pass (optional, budgeted)

The tool never calls a vision/LLM API itself (offline, no keys). It prepares a
**packet** and ingests the agent's **results** — a round-trip, keyed by frame
path so it is stable across re-runs.

- `vided annotate --packet-out vision.packet.json` emits only frames with
  `selected: true`, each with: asset id, frame path, timestamp `t`, scene id and
  scene range, transcript segments overlapping the frame's time window, any OCR
  text, and any existing description.
- The agent attaches the referenced frame images to its vision model and writes
  a results file: per frame `{ frame, description, tags?, quality?, in?, out? }`.
- `vided annotate --ingest vision.results.json` validates the results, merges
  descriptions/tags back into the asset (`visual.frames[].description`,
  `tags`, optional `summary`), sets `status: annotated`, and refreshes the
  manifest. Ingest is idempotent: re-ingesting the same file changes nothing.
- Because only deduplicated representatives are in the packet, vision spend is
  bounded by `dedupe` + the vision budget.

### 5.7 `manifest` / context pack — assemble the contract

- Merge probe + extracted text + visual + annotation into `manifest.json`.
- Produce a distilled **context pack** (`context.md` and `context.json`) sized
  for an agent's context window: per-asset summary, transcript (trimmed),
  scene list, selected frames with descriptions, and tags. No raw media blobs.
- Fold in human/agent-supplied context: a project-level `brief.md` (audience,
  tone, target length, must-include) and per-input sidecars
  (`<media>.md`, `<base>.notes.md`) as per-asset `notes`. This is the durable
  landing place for context gathered through agent conversation — no UI or
  extra schema needed to capture it.
- `--max-chars` caps the pack; content is prioritised (brief, narrated segments
  and annotated frames first). The agent composes from the pack, never from the
  originals.

### 5.8 `clips` — the clip pool
- A **clip** is an atomic, individually renderable unit with a `kind`
  (`video`/`image`/`audio`/`title`/`slide`) and an output **`format`** (a name
  from the canonical set in `src/schemas/clips.ts`, documented in AGENTS.md /
  README). Generated kinds (`title`/`slide`) use `source: "generated"`.
- `vided clips` derives a deterministic **seed** pool (`clips.yaml`,
  `vided.clips/1`) from the manifest — transcript beats (merged on pauses),
  frame clusters, scene ranges (overlap-collapsed in that priority); images and
  audio yield one clip each. Transcript/scene ranges are not length-capped.
  `origin: derived` marks seeds; `agent`/`studio` clips survive `--force`.
- The pool is agent/studio editable (`--add`, `--set`, `--rm`) and is folded
  into the context pack as a per-asset `clips:` list.
- `vided clips --check` validates: sources resolve, kinds/fields valid, unique
  ids. The pool is expected whenever the project has placeable media.
- Audio is part of a video clip unless `muted`, or unless it is explicitly
  sampled out into its own `audio` clip (which becomes a new source to analyse).

### 5.9 `compose` — agent writes the edit script
- The agent reads the manifest/context pack (incl. `clips.yaml`) and writes
  `edit.yaml` (`vided.edl/3`): `tracks.visual` and `tracks.audio` reference
  clips by `use:` (definitions live only in `clips.yaml`). The visual track is
  sequential; the audio track is free-positioned (`offset`) and mixed. Reusing a
  clip is just referencing it again; placement modifiers (`speed`, `transform`,
  transitions, `gain_db`) stay on the track item. `resolveEdl` binds references
  and validates kind↔track.
- `vided compose --check` validates and resolves against the pool.
- `vided compose --explain` renders a human/agent-readable timeline summary
  (durations, overruns, audio counts) without touching media.
- `vided compose --lint` warns about gaps, overruns, missing sources, format
  mismatches and captions exceeding reading speed.

### 5.10 `tts` — narration voice-over
- `vided script --out narration.yaml` scaffolds a narration script from the
  manifest: one segment per annotated frame, `start` at the frame timestamp,
  description as placeholder text. This makes the frame→segment mapping a
  deterministic tool step; the agent then rewrites the prose and merges beats.
- Synthesize each narration segment to WAV (Piper by default; see §8).
- Report per-segment duration; optionally time-stretch (`atempo`/`rubberband`)
  to fit target slots, or shorten/expand text via the agent.
- Produce `narration.wav` + `narration.timing.json` (segment -> start/duration)
  used to drive caption timing.

### 5.11 `render` — execute the EDL
- Translate the EDL into an ffmpeg `filter_complex` graph (single pass where
  possible; intermediate files when the graph is too large).
- Operations: trim, concat, scale/pad, crop, overlay image, `drawtext`,
  transitions (`xfade`), speed (`setpts`/`atempo`), audio `amix`, music ducking
  (`sidechaincompress`), loudness normalisation (`loudnorm`).
- Title cards (intro / chapter pages) are generated as solid-colour sources
  rendered with libass (`color=...` + `ass=...`) and concatenated inline — no
  external image assets required. Slides (`slide` + `body`, `kind: mono`)
  reuse the same path with a top-left, monospace body for code walkthroughs.
- Stills (`image` + `duration`, optional `fit`/`zoom`) hold an image for a
  duration (looped input). This is how screen captures, logos, diagrams or
  exported slides enter the timeline: the **harness/agent captures the image**
  (e.g. a browser screenshot of a gist page); the tool only scales/crops and
  holds it. `zoom` crops a region for legibility.
- Text overlays use per-event ASS styles, so each can differ. `style.box: true`
  draws a background box (libass `BorderStyle=3`) using `box_color`
  (`#rrggbb[aa]` or `&Haabbggrr`); `outline`/`shadow` are configurable. This
  keeps labels readable over busy screen-capture footage.
- Burn styled captions via the `subtitles`/`ass` filter when requested.
- Export CC sidecar alongside the video.

### 5.12 `captions` — subtitle generation
- Build cues from narration timing and/or source transcripts.
- Apply line-wrapping and reading-speed constraints (chars/sec, max lines).
- Emit `SRT`, `VTT`, and styled `ASS` (ASS is the render source of truth;
  SRT/VTT are the portable closed-caption deliverables).

## 6. Data contracts

### 6.1 `AssetRecord` (manifest entry)

```jsonc
{
  "schema": "vided.asset/1",
  "id": "a1b2c3",                     // stable, derived from content hash
  "path": "input/clip01.mp4",
  "kind": "video",                    // video | audio | image | text
  "content_hash": "sha256:...",
  "bytes": 18342911,
  "mtime": "2026-09-25T16:00:00Z",
  "technical": {
    "duration_s": 42.5,
    "container": "mov,mp4,m4a,3gp,3g2,mj2",
    "video": { "codec": "h264", "width": 1920, "height": 1080,
               "fps": 29.97, "bitrate": 8000000, "rotation": 0 },
    "audio": { "codec": "aac", "sample_rate": 48000, "channels": 2 },
    "creation_time": "2026-09-01T10:00:00Z"
  },
  "extracted": {
    "language": "en",
    "transcript": {
      "tool": "whisper.cpp",
      "model": "large-v3",
      "segments": [
        { "start": 0.0, "end": 3.2, "text": "Welcome to the demo.",
          "words": [ { "w": "Welcome", "start": 0.0, "end": 0.5 } ] }
      ]
    },
    "ocr": null,
    "sidecar": null
  },
  "visual": {
    "scenes": [ { "id": "s0", "start": 0.0, "end": 12.4 } ],
    "frames": [
      { "t": 1.0, "path": "frames/a1b2c3/0001.jpg",
        "phash": "9f8e7d6c5b4a3210", "dhash": "0f1e2d3c4b5a6978",
        "scene": "s0", "sharpness": 0.81, "selected": true,
        "description": "Presenter at a whiteboard." }
    ],
    "vision_budget": { "max_frames": 47, "used": 47 }
  },
  "tags": ["demo", "indoor"],
  "summary": "A 42s indoor product demo with a single speaker.",
  "title": "Intro shot",
  "role": "intro",
  "notes": "Use the first 6 seconds; ignore the camera shake.",
  "provenance": { "tool": "vided", "version": "0.1.0",
                  "generated_at": "2026-09-25T16:05:00Z" }
}
```

### 6.2 `manifest.json`

```jsonc
{
  "schema": "vided.manifest/1",
  "project": "my-edit",
  "created_at": "2026-09-25T16:05:00Z",
  "input_roots": ["input/"],
  "config_hash": "sha256:...",
  "assets": [ /* AssetRecord[] or references to .vided/assets/<id>.json */ ],
  "totals": { "assets": 12, "duration_s": 412.3, "unique_frames": 37 }
}
```

### 6.3 `edit.yaml` (EDL) — sketch

Clips (video/image/audio/title/slide) are defined in `clips.yaml`, each with a
`kind`, a `source` (or `"generated"`) and a `format`; the timeline only
references them by `use:`. See §5.8.

```yaml
schema: vided.edl/3
output:
  format: 1080p30       # a name from the canonical set (AGENTS.md)
  path: out/final.mp4
  loudness_lufs: -14

tracks:
  visual:               # sequential; every item references a clip by `use:`
    - { id: intro, use: title-intro }     # a title clip
    - { id: code, use: slide-loop }        # a slide clip (heading/body, variant: mono)
    - { id: gist, use: still-gist }        # an image clip (duration/fit/zoom)
    - id: clip1                            # a video clip
      use: sel-a
      transform: { scale: 1920x1080, pad: true }
      transition_in: { type: fade, duration: 0.5 }
    - { id: broll, use: sel-b, speed: 0.5 }
  audio:                # free-positioned and mixed
    - { id: vo, use: vo, offset: 0 }
    - { id: bed, use: music, offset: 0, gain_db: -18 }

captions:
  mode: soft            # soft (default) | burn (opt-in) | none
  style: { font: "Inter", size: 42, position: bottom, margin_v: 64 }
  sources: [narration, transcript]
  export: [srt, vtt]

overlays:
  - type: image
    source: assets/logo.png
    start: 0.0
    end: 4.0
    position: top-right
    opacity: 0.9
  - type: text
    text: "Chapter 1"
    start: 1.0
    end: 3.5
    style: { size: 64, color: "#ffffff" }
  # readable over busy footage: a semi-opaque background box
  - type: text
    text: "Without a tool, the graph renders EMPTY"
    start: 58
    end: 67.5
    position: bottom
    style: { size: 44, color: "#ffffff", box: true, box_color: "#000000cc", outline: 0 }
```

## 7. CLI surface (proposed)

```
vided init [--dir .] [--profile default]
vided doctor [--install-missing]
vided scan --input <dir>... [--fast-hash]
vided extract-text [--assets <id>...] [--whisper-model large-v3] [--ocr]
vided sample [--rate 30] [--every 2s] [--threshold 0.25] [--max-width 512]
vided dedupe [--phash-dist 6] [--budget <n>] [--total-budget <n>]
vided annotate --packet-out vision.json [--ingest vision-results.json]
vided manifest [--context-pack context.md]
vided script --out narration.yaml [--gap 0.3] [--voice <id>]
vided compose --check|--explain|--lint edit.yaml
vided tts --script narration.yaml --voice en_US-amy --engine piper
vided captions --from narration|transcript --formats srt,vtt
vided render edit.yaml [--preview] [--dry-run]
vided models [--install piper|voice|all] [--voice <id>] [--list]
vided voices [query]
vided status [--json]
vided clean [--cache|--frames|--all]
```

All commands support `--json`, `--quiet`, and `--dry-run` where meaningful.

## 8. Tooling recommendations

Implementation language: **Node.js + TypeScript**. This toolset is mostly
orchestration (spawn native tools, move JSON between stages, expose tools to
agents), so the host language is deliberately *not* load-bearing. Heavy work is
delegated to best-in-class **native binaries** invoked as subprocesses, which
keeps Node's weaker ML ecosystem from being a blocker and makes the pipeline
portable.

| Concern            | Default (offline)                         | Alternatives / notes |
|--------------------|-------------------------------------------|----------------------|
| Probe / edit / mux | **ffmpeg + ffprobe** (system or `ffmpeg-static`) | required core; invoke via `child_process.spawn`, not a wrapper lib |
| Process runner     | `execa`                                   | streaming stdout/stderr, cancellation, timeouts |
| TTS                | **Piper** binary (fast, tiny, many voices) | **`kokoro-js`** (ONNX, in-process) for noticeably better quality; **Chatterbox**/**XTTS** via Python sidecar for cloning (check licence); `espeak-ng` fallback |
| Transcription      | **whisper.cpp** via `smart-whisper` (napi) or `nodejs-whisper` | word timestamps required for captions; `@huggingface/transformers` (ONNX Whisper) as a pure-JS fallback |
| Scene detection    | **ffmpeg `scene` filter**                  | optional `PySceneDetect` sidecar for adaptive/fade-aware detection |
| Frame extraction   | **ffmpeg** -> JPEG                         | `sharp` for downscale/crop if not done in ffmpeg |
| Frame hashing      | **`imghash`** (pHash/dHash)               | `sharp` for decode/normalise before hashing |
| Semantic dedupe    | **CLIP via `@huggingface/transformers`**  | optional; only if pHash is insufficient |
| OCR                | **`tesseract.js`** (WASM, no install)     | PaddleOCR Python sidecar for higher accuracy |
| Forced alignment   | whisper word timestamps                    | `aeneas` sidecar when aligning existing text to audio |
| Caption rendering  | **libass via ffmpeg `ass` filter**         | `drawtext` for simple cases |
| Loudness           | ffmpeg `loudnorm`                          | EBU R128 target -14 LUFS (web) / -23 (broadcast) |
| Schema validation  | **`zod`** -> JSON Schema via `zod-to-json-schema` | one source of truth for asset/manifest/EDL contracts |
| CLI                | `commander` or `cac`                      | JSON stdout by default |
| MCP (future, optional) | `@modelcontextprotocol/sdk`            | only if multi-client typed tools are wanted; thin wrapper over `src/commands/*` |

TTS engine recommendation: default to **Piper** (external binary) for speed,
footprint, and offline reliability; expose `--engine kokoro` (via `kokoro-js`)
for higher fidelity when quality matters more than latency. Keep engines behind
an adapter interface so new backends can be added without touching the pipeline.

### 8.1 Native binary strategy

Keep the language decision reversible by treating these as external
dependencies with a single resolution layer (`src/tools/resolve.ts`):

- `ffmpeg` / `ffprobe` — bundled via `ffmpeg-static`/`ffprobe-static`, or
  system `PATH`; prefer system when present.
- `whisper.cpp` — binary shipped/downloaded on first use; model downloaded and
  cached under `.vided/models`.
- `piper` — installed into the project with `vided models --install piper`
  (`.vided/tools/piper/`); voices with
  `vided models --install voice --voice en_US-amy-medium`
  (`.vided/models/piper/`). Installed paths are written back to
  `.vided/config.json`, and `vided voices <query>` searches the catalogue.

`vided doctor` verifies presence, version, and codec/feature support and
reports how to install anything missing.

**Escape hatch:** if `faster-whisper` accuracy/speed ever becomes a hard
requirement, add an optional Python sidecar invoked over stdio — but do not
make Python a baseline dependency.

## 9. Cost / caching model

- Cache key: `sha256(content_hash + stage + tool + tool_version + canonical(params))`.
- Never re-transcribe, re-sample, re-annotate, or re-synthesize unchanged
  inputs.
- Vision cost is bounded by `dedupe` (fewest unique frames) and by the
  density-based vision budget in config.
- `vided status` reports cache hits/misses and estimated tokens/time saved.
- Large derived artifacts (audio wavs, frame images) are stored on disk, not in
  the manifest; the manifest stores paths + hashes.

## 10. Proposed repository layout

```
vid-ed/
  SPEC.md
  AGENTS.md                 # agent workflow instructions (generated/curated)
  package.json
  tsconfig.json
  src/
    cli.ts                  # command dispatch, JSON I/O
    tools/resolve.ts        # locate ffmpeg/whisper/piper binaries + versions
    probe.ts                # ffprobe + hashing
    text.ts                 # whisper / ocr / sidecar extraction
    frames.ts               # scene detect + sampling
    dedupe.ts               # phash clustering + budget
    manifest.ts             # contract assembly + context pack
    edl.ts                  # schema validate / explain / lint
    tts.ts                  # engine adapters (piper, kokoro, ...)
    captions.ts             # cue building + srt/vtt/ass writers
    render.ts               # EDL -> ffmpeg graph
    cache.ts                # content-addressed store
    schemas/                # zod schemas -> generated JSON Schemas
  mcp/                      # future/optional MCP server (thin wrapper)
  bin/vided                 # thin executable entry
  test/
  examples/
```

Language note: **TypeScript on Node.js** was chosen for its fit with agent
tooling and harnesses (opencode/Kiro/Claude Code integration; the MCP SDK,
should it ever be used, is TS-first), native JSON handling, and subprocess
orchestration. ML-adjacent work is handled by external native binaries or ONNX
runtimes (`@huggingface/transformers`, `kokoro-js`, `tesseract.js`) so the host
language stays non-load-bearing. A single-file binary can be produced later
with Node SEA or `bun build --compile`.

## 11. Agent integration

- Ship an `AGENTS.md` (and optional opencode skill / Kiro steering file) that
  documents the exact command sequence and when to call each.
- The agent should be told: *read the manifest/context pack, never re-read
  raw media*; *write `edit.yaml`, never write ffmpeg commands directly*.
- Provide `vided compose --explain` output as the agent's feedback loop for
  iterating on the edit.

The CLI (JSON in / JSON out) is the primary and only *required* agent contract;
any harness that can run a shell can drive it. An MCP server is a **potential
future feature, not a committed deliverable** — it would only add value for
multi-client, typed-tool integration, and if built should be a thin wrapper
over the existing `src/commands/*` functions (no duplicated logic, no shelling
out). See §13.

## 12. Milestones

- **M0** — Node/TS skeleton, `init`/`doctor`/`scan`/`status`, manifest with
  probe data.
- **M1** — `extract-text` (whisper.cpp) + `sample` + `dedupe`, frame cache.
- **M2** — `compose` (schema + explain/lint) and `render` for trim/concat/
  overlay/mix.
- **M3** — `tts` (Piper) + `captions` (SRT/VTT/ASS) + caption burn-in.
- **M4 — vision annotation + context pack + cost reporting.** Goal: let the
  agent reason about *what is on screen* without ever re-reading raw media, at
  minimum vision cost.
  - **`vided annotate --packet-out <file>`** — build a vision packet from the
    `dedupe`-selected frames only. Each entry carries frame path, timestamp,
    scene range, overlapping transcript, OCR, and any prior description. No
    model call is made by `vided`.
  - **`vided annotate --ingest <file>`** — validate and merge the agent's
    per-frame descriptions/tags back into the assets and manifest;
    idempotent.
  - **Context pack** — `vided manifest --context-pack context.md` (and
    `context.json`) with per-asset summaries, trimmed transcripts, scene lists,
    selected frames + descriptions, and tags, capped by `--max-chars`.
  - **Cost reporting** — `vided status` reports candidate vs. selected vs.
    annotated frames and an estimated vision-token count, so the saving from
    `dedupe` is visible.
  - **Schemas** — `src/schemas/vision.ts` (`vided.vision.packet/1`,
    `vided.vision.results/1`); context pack builder in `src/context.ts`.
  - **Acceptance** — packet contains only selected frames; ingest is
    idempotent; context pack stays within budget and includes descriptions +
    transcript; cost numbers match the manifest.
- **M5** — Kokoro adapter (`kokoro-js`), forced alignment, preview mode,
  examples.
- **Future (unscheduled)** — optional thin MCP server exposing typed tools for
  MCP-capable agents; only if multi-client integration is wanted.

## 13. Open questions

1. ~~Primary implementation language?~~ **Resolved: Node.js + TypeScript**, with
   ffmpeg/whisper.cpp/piper as native binaries. Python only as an optional
   sidecar (faster-whisper / PySceneDetect / PaddleOCR).
2. Default TTS: Piper (speed/footprint) or Kokoro (quality)? Ship both, but
   which is the documented default?
3. Should `render` prefer a single giant ffmpeg pass or intermediate files for
   debuggability? (Proposal: intermediates behind `--debug`, single pass by
   default.)
4. Vision annotation protocol: synchronous agent round-trip (`annotate`
   packet) vs. an agent-agnostic JSON contract the agent fills however it can?
5. Caption timing source of truth when narration and source speech disagree —
   prefer narration timing (deterministic) or align to source?
6. Distribution: npm package (`npx vided`), standalone binary (Node SEA /
   `bun build --compile`), or container?
7. Do we need multi-track/audio-ducking in v1, or defer music beds to v2?
8. Binary resolution policy: prefer system `ffmpeg`/`whisper.cpp`/`piper` on
   `PATH`, or always use pinned bundled/downloaded versions for reproducibility?
9. ~~MCP server in scope?~~ **Resolved: not committed.** The JSON CLI is the
   required contract; an MCP server is a future/optional thin wrapper, only if
   multi-client typed-tool integration is wanted.
