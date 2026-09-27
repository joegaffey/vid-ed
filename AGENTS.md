# AGENTS.md — using vided

`vided` turns a folder of video/audio/images into a finished edit: analysis is
deterministic and cached, you compose an `edit.yaml` (EDL), and `vided render`
executes it with ffmpeg. This is the guide for an agent **using** vided on a
project.

> Working on vided itself (not using it)? See [`DEVELOPMENT.md`](./DEVELOPMENT.md).

Typical ask: **"Make a narrated video from these clips."**

## The model

```
ANALYZE (cached) -> MANIFEST -> CLIPS -> COMPOSE (agent) -> RENDER (ffmpeg)
```

- **Analyze** stages (`scan`, `extract-text`, `sample`, `dedupe`, `annotate`)
  write derived data into `.vided/` and cache results by content hash.
- **Manifest** (`.vided/manifest.json`) is the single contract you read.
- **Clips** (`vided clips`) derives `clips.yaml`, the pool every edit uses.
- **Compose** is your job: read the manifest/context pack and write `edit.yaml`.
- **Render** is deterministic: the EDL is translated to an ffmpeg graph.

Hard rules:

- Write `edit.yaml`, **never** raw ffmpeg commands.
- Read the manifest/context pack; never re-read raw media once it is analysed.
- Vision/LLM calls only run on frames that survived `dedupe`.
- The canonical artifacts (`clips.yaml`, `edit.yaml`, `context.yaml`,
  `narration.yaml`, `brief.md`) are **shared with the human**, who may edit them
  outside your session (by hand, or via the optional studio). Check
  `.vided/STUDIO_CHANGES.md` and re-read them before assuming your copy is
  current; the latest write wins (there is no merge).

## Requirements

- **Node.js >= 20**; **ffmpeg / ffprobe** on `PATH` (required).
- Optional native tools, installed per project: **whisper.cpp** (`extract-text`)
  and **Piper** (`tts`).

```sh
vided doctor
vided models --install piper                      # piper binary -> .vided/tools/piper/
vided models --install voice --voice en_US-amy-medium
vided voices amy                                  # search the voice catalogue
```

## Working a project (order matters)

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

Describing the footage: `sample` + `dedupe` pick the frames; `annotate` gets
them described. The packet lists each frame's image path, and a vision-capable
model reads those JPEGs directly:

```sh
vided annotate --packet-out work/vision.packet.json   # packet + results template
# open each frame image (e.g. .vided/frames/<assetId>/u_00001.jpg); fill
# `description`/`tags` in work/vision.results.json; optionally set in/out
vided annotate --ingest work/vision.results.json
```

Descriptions land on `visual.frames[].description`, flow into the context pack,
and their `tags` are merged onto the asset. Re-run `vided manifest
--context-pack` afterwards. Without this step the composer sees only timestamps
— no idea what the footage shows.

A clip is defined **only** in `clips.yaml`; `edit.yaml` references it by `use:`
(every `tracks.visual[]` item needs `id`). `clips --add` takes one or more clip
objects (JSON) — each object is a clip, not an array. Generated kinds
(`title`/`slide`) use `source: generated` and a `title` (or `heading`).

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

## Clips and formats

Every clip has a `kind` (`video`/`image`/`audio`/`title`/`slide`), a `source`
(or `"generated"` for title/slide) and a `format` from this canonical set
(`src/schemas/clips.ts`):

`1080p30`, `1080p60`, `720p30`, `540p30`, `480p30`, `360p30`,
`vertical1080p30`, `square1080p30`, `audio48k`.

Derived video clips default to the source's format (never upscaling), so
previews encode quickly, and inherit `tags`/`note` from the selected frames
inside their range. Audio is part of a video clip unless `muted`, or unless it
is sampled out into its own `audio` clip (which becomes a new source to
analyse).

## Narration and captions

```sh
vided script --out narration.yaml     # scaffolds beats from described frames
#   ... rewrite the prose ...
vided tts narration.yaml              # Piper -> work/narration.wav + work/narration.timing.json
vided captions --from narration --formats srt,vtt,ass   # -> work/captions.{srt,vtt,ass}
```

`script` scaffolds one segment per annotated frame; trim visual clips to roughly
the narration length — derived scene clips can be long (`clips --add` a shorter
range). Captions are **soft by default** (srt/vtt sidecars attached as a
toggleable track); burn-in needs the `.ass` and is opt-in with
`captions.mode: burn`.

Register the narration as an audio clip with its duration (from `tts`) so the
fit check works, e.g.
`clips --add '{"id":"vo","kind":"audio","source":"work/narration.wav","format":"audio48k","duration":42.5}'`,
then put it on `tracks.audio: [{ id: vo, use: vo }]` and set
`captions: { mode: burn, file: work/captions.ass }`.

`vided compose edit.yaml --check --lint --explain` — `--explain` reports the
timeline duration and, when audio clips declare a length, whether the audio
track fits (`audio: … ends 42.5s (fits 63.1s)`).

## Starter prompts

A user should be able to start from a one-line ask:

- "Make a narrated video from these clips."
- "Cut these clips into a 30-second vertical teaser."
- "Make a warm ~90s demo for sim racers, narrated, with captions."

### Recipe: a narrated video

1. `vided scan` → `extract-text` → `sample` → `dedupe` → `annotate` (describe
   the frames; see above).
2. Write `brief.md` (audience/tone/target length), then
   `vided manifest --context-pack work/context.md` and read it.
3. `vided script --out narration.yaml`; rewrite the prose. Then
   `vided tts narration.yaml`. Trim visual clips to roughly the narration length.
4. `vided captions --from narration --formats srt,vtt,ass` → `work/captions.ass`.
5. `vided clips`; add generated cards with `clips --add`, and register the
   narration as an audio clip with its duration (see above).
6. Write `edit.yaml`: visual clips on `tracks.visual`, the narration on
   `tracks.audio`, and `captions: { mode: burn, file: work/captions.ass }`.
7. `vided compose edit.yaml --check --lint --explain`, then `vided render edit.yaml`.

## Studio (optional, experimental)

You are not expected to run the studio, but a **human collaborator may**.
`vided studio` is a local web UI — a thin adapter over the same CLI and
artifacts (job queue, history/proposals, staleness, timeline editing). Expect its
edits:

- `.vided/STUDIO_CHANGES.md` lists artifacts whose latest writer was the studio.
  Read it when you start or resume work, and re-read those artifacts.
- Studio edits land on the **same** `clips.yaml` / `edit.yaml` / `context.yaml`
  you write. There is no auto-merge: if you and the human diverge, the latest
  write wins, and `.studio/history/` records the versions.
- `.studio/` (history, drafts, watcher state) is **off-limits** to you.
- After external edits, re-run `vided manifest --context-pack` so your context
  pack reflects the current `clips.yaml`/context.

See [`STUDIO.md`](./STUDIO.md).

---

Maintainers: architecture, hard rules, layout and build commands are in
[`DEVELOPMENT.md`](./DEVELOPMENT.md); design in [`SPEC.md`](./SPEC.md).
