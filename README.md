# vided

An agentic video editor toolset for CLI AI assistants (opencode, Kiro, Claude
Code). Point it at a folder of video/audio/images and it produces a narrated
edit with on-screen captions and a closed-caption file.

The agent does the creative reasoning; `vided` does the deterministic media
work. Every command is non-interactive and returns JSON on stdout, so an agent
can chain commands reliably.

```
ANALYZE (expensive, cached) -> MANIFEST -> COMPOSE (agent) -> RENDER (ffmpeg)
scan / extract-text / sample / dedupe / annotate
                               agent reads the manifest + context pack and
                               writes edit.yaml (EDL)
                                               edit.yaml -> ffmpeg -> video
```

See [`SPEC.md`](./SPEC.md) for the full design and [`AGENTS.md`](./AGENTS.md)
for the agent-facing workflow.

## Requirements

- **Node.js >= 20**
- **ffmpeg / ffprobe** on `PATH` (or configured — see below). Required.
- Optional native tools, installed per-project:
  - **whisper.cpp** — speech transcription (`extract-text`)
  - **Piper** — text-to-speech (`tts`)

## Install

```sh
npm install
npm run build
npm link            # optional: put `vided` on PATH
```

Check what's available in a project:

```sh
vided doctor
```

Install the optional tools into a project (Piper binary + a voice):

```sh
vided models --install piper
vided models --install voice --voice en_US-amy-medium
vided voices amy            # search the catalogue
```

`doctor`/`models` write resolved binary paths into `.vided/config.json`, so you
can also point at system binaries manually.

## Quickstart

```sh
vided init --project my-edit          # creates .vided/ and config
# put media in ./input
vided scan                            # probe + hash everything -> manifest.json

vided extract-text                    # transcribe audio/video, read sidecars
vided sample                          # initial sample rate + scene detection
vided dedupe                          # cluster to the target density

vided annotate --packet-out vision.packet.json   # agent describes the frames
vided annotate --ingest vision.results.json      # merge descriptions back

vided manifest --context-pack context.md         # distilled agent-facing digest
vided script --out narration.yaml                # scaffold narration from frames
# ...agent edits narration.yaml...

vided tts narration.yaml              # Piper -> work/narration.wav + timing
vided captions --from narration       # -> work/captions.{srt,vtt}

vided compose edit.yaml --check --lint
vided render edit.yaml                # -> out/final.mp4
```

The agent should read the manifest/context pack and **write `edit.yaml`, never
raw ffmpeg commands**.

Captions are **soft by default**: `vided captions` emits `srt`/`vtt` sidecars
(`ass` is opt-in via `--formats`), and `render` attaches them as a toggleable
subtitle track. Burn-in is opt-in with `captions.mode: burn`.

Frame coverage is controlled by two knobs:
- **Initial sample rate** — `sampling.frames_per_minute` (default 30 → one frame
  every 2s, plus scene cuts). This is the candidate pool.
- **Target dedupe** — `dedupe.target_frames_per_minute` (default 6), clamped per
  asset and capped overall. `dedupe` can only reduce, so the initial rate must
  exceed the target (it warns otherwise).

**Title cards** (intro / chapter pages) are first-class timeline items — use
`title`/`subtitle`/`duration`/`background` instead of `source`:

```yaml
timeline:
  - { id: intro, title: "My Project", subtitle: "An agentic edit", duration: 3, background: "#101820" }
  - { id: chapter1, title: "Chapter 1", duration: 2.5, background: "#1b2a41" }
  - { id: clip1, source: <asset-id>, in: 0, out: 8 }
```

They're rendered as solid-colour pages via libass and concatenated inline.

**Code / text slides** for walkthroughs use `slide` + `body` (`kind: mono` for a
monospace body):

```yaml
timeline:
  - id: fw
    slide: "loop()"
    kind: mono
    duration: 6
    body: |
      Joystick.setXAxis(SteeringValue);
      Joystick.setYAxis(ThrottleValue);
```

**Stills** hold an image for a duration — this is how a screen capture, logo, or
exported slide enters the cut. The **agent/harness captures the image** (e.g. a
browser screenshot); the tool just scales/crops and holds it. `zoom` crops a
region for legibility:

```yaml
timeline:
  - id: gist
    image: <image-asset-id>
    duration: 8
    fit: contain
    zoom: { x: 0, y: 0.4, w: 1, h: 0.34 }
```

## Example agent prompt

Everything above is driven by talking to the agent. For the chaptered demo in
`samples/rc-build-gist-demo/`, the prompt was roughly:

> Combine my two YouTube videos — the 3D case design and the controller test —
> into one friendly build-and-test demo. Add an intro title and a chapter card
> between the two clips, plus a code walkthrough of the firmware gist
> (`http://gist.github.com/joegaffey/15bc76fa8b89fa941570b381fa884ad4`).
> I built the 3D editor myself, it's called "3table". The track test was hard
> to drive because I was recording the video with one hand and steering with
> the other. Use a Piper voice-over and soft (not burned) captions.

The agent then scanned the media, sampled/deduped and described frames,
captured the gist page with the browser, wrote `edit.yaml` + `narration.yaml`,
and ran `tts` → `captions` → `render`.

## Adding context

Narration quality improves a lot with a little context. The intended way to
supply it is through the agent — just tell it audience, tone, target length,
must-includes, and per-clip notes. The agent persists that to files so it
survives the session:

- **`brief.md`** (project root) — overall context: audience, tone, target
  duration, must-include/avoid, pronunciation.
- **Per-input sidecars** next to the media — `<media>.md`, e.g.
  `input/clip01.mp4.md`, for clip-specific notes ("use the first 6s", speaker,
  role).

`vided manifest --context-pack` folds both into `context.md` / `context.json`,
and `vided script` carries per-asset notes into the narration scaffold. Drop a
file and re-run those commands — no rescan or UI needed.

## Contracts

Three versioned schemas are the source of truth (zod, in `src/schemas/`):

- **`vided.asset/1`** / **`vided.manifest/1`** — probe + extracted text + frames
  + annotations. Written by the analyze stages; read by the agent.
- **`vided.edl/1`** — the edit script (`edit.yaml`): timeline, audio, captions,
  overlays. Written by the agent; validated by `compose`, executed by `render`.
- **`vided.narration/1`** — narration script + timing.

Example EDL: [`examples/edit.yaml`](./examples/edit.yaml). Example narration:
[`examples/narration.yaml`](./examples/narration.yaml).

## Commands

Global flags: `--dir <dir>`, `--human`, `--json` (default), `-q/--quiet`.

| Command | Purpose |
|---|---|
| `init` | Create a project (`.vided/`, config) |
| `doctor` | Check required/optional tools |
| `scan` | Discover and probe media files |
| `extract-text` | Transcribe audio/video, OCR images, read sidecars |
| `sample` | Extract candidate frames (scene detection + optional uniform) |
| `dedupe` | Cluster frames by perceptual hash, select representatives |
| `annotate` | Build a vision packet / ingest agent descriptions |
| `manifest` | Rebuild the manifest; `--context-pack` writes the digest |
| `script` | Scaffold a narration script from annotated frames |
| `tts` | Synthesise the voice-over (Piper) |
| `captions` | Build SRT/VTT/ASS from narration or a transcript |
| `compose` | Validate / explain / lint an EDL |
| `render` | Render an EDL to video (burn or mux captions) |
| `models` | List/install the Piper binary and voices |
| `voices` | Search the Piper voice catalogue |
| `status` | Project status + vision cost report |

Run `vided <command> --help` for flags.

## Samples

Working demos produced by the toolchain:

- **`samples/rc-build-gist-demo/`** — a chaptered build-and-test cut with title
  cards, a firmware walkthrough using browser screen captures, Piper
  voice-over and soft captions. Published:
  https://youtu.be/YWU-AIhnUwo (artifacts: `edit.yaml`, `narration.yaml`,
  `brief.md`, `captions.srt`, `gist-code.png`).
- `samples/rc-build-firmware-demo/` — the same cut with tool-rendered code
  slides instead of screen captures.
- `samples/rc-build-demo/` — the chaptered cut before the firmware chapter.
- `samples/voice-demo/` — narrated, captioned 9s edit (Piper) with SRT/VTT,
  context pack, and vision round-trip artifacts.
- `samples/vision-demo/` — synthetic scenes described by the vision pass, then
  narrated and captioned.
- `samples/yt-case-design/` — a real 7.8-min YouTube video analysed to 47
  described frames; `contact.png`, `context.md`, `vision.*`.
- `samples/yt-controller-test/` — a 33s cockpit clip analysed to 8 described
  frames.

## Development

```sh
npm run dev -- <args>     # run the CLI from source (tsx)
npm run build             # tsc -> dist/
npm run typecheck
npm test                  # node --test
```

Layout and rules are in [`AGENTS.md`](./AGENTS.md). All heavy work is delegated
to native binaries (ffmpeg, whisper.cpp, Piper); the host language stays
non-load-bearing and Python is not a baseline dependency.

## Status

M0–M4 complete: probe/analysis, frame sampling + dedupe, EDL compose/render,
Piper TTS + captions, and the vision annotation round-trip with context pack.
M5 (Kokoro TTS, forced alignment, preview) is planned. An MCP server is a
possible future feature, not committed.
