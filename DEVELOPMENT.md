# DEVELOPMENT.md — working on vided

`vided` is an agentic video editor toolset. This file is for AI coding agents
(opencode, Kiro, Claude Code) and humans working **on** the project.

- **Using vided on a project?** Read [`AGENTS.md`](./AGENTS.md) instead — that is
  the agent-facing user guide. `vided init` also writes a per-project `AGENTS.md`.
- **Full design spec:** [`SPEC.md`](./SPEC.md).
- **Optional studio:** [`STUDIO.md`](./STUDIO.md).

## Architecture

Three phases with a hard contract between each:

```
ANALYZE (expensive, cached) -> MANIFEST -> COMPOSE (agent) -> RENDER (ffmpeg)
```

- **Analyze** stages (`scan`, `extract-text`, `sample`, `dedupe`, `annotate`)
  write derived data into `.vided/` and cache results by content hash.
- **Manifest** (`.vided/manifest.json`) is the single contract the agent reads.
  Never re-read raw media once it is in the manifest.
- **Clips** (`vided clips`) derives `clips.yaml`, the pool every edit composes
  from.
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
- The UI principle for the studio: never show raw JSON/YAML in primary views.

## Layout

```
src/cli.ts             command dispatch, JSON I/O
src/tools/resolve.ts   locate/version native binaries
src/probe.ts           ffprobe + hashing + kind detection
src/av.ts              ffmpeg/ffprobe helpers
src/hash.ts            pHash/dHash perceptual hashing
src/text.ts            whisper.cpp / OCR / sidecar extraction
src/frames.ts          scene detection + frame sampling
src/dedupe.ts          pHash clustering + vision budget
src/config.ts          project config + paths
src/cache.ts           content-addressed cache
src/manifest.ts        manifest assembly + source resolution
src/clips.ts           derive the clip pool (clips.yaml)
src/clips-edit.ts      add/set/rm on the clip pool
src/edl.ts             EDL validate / explain / lint
src/edl-edit.ts        AST-preserving edit.yaml ops
src/preview.ts         single-clip preview render
src/render.ts          EDL -> ffmpeg graph
src/tts.ts             piper narration synthesis + timing
src/captions.ts        ASS/SRT/VTT generation
src/context.ts         context-pack builder (agent-facing)
src/models.ts          install piper binary + voices
src/ui.ts              human/JSON output helpers
src/schemas/           zod contracts
src/commands/          one file per CLI command
src/server/            optional studio (see STUDIO.md): routes, jobs, history,
                       staleness, static Lit UI
src/test/              node:test suites
scripts/               studio client + static-demo builds
mcp/                   (future, optional) MCP server
samples/               demo projects: inputs, rendered outputs, captions, context packs
```

## Commands

```sh
npm install
npm run build        # tsc -> dist/
npm run build:studio # esbuild -> dist/studio (Lit client)
npm run typecheck
npm test             # node --test
npm run verify       # typecheck + test + build:studio
npm run dev -- <args>   # tsx src/cli.ts
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
from annotated frames), and cost reporting in `status`.

Clips stage: `vided clips` derives `clips.yaml` (`vided.clips/1`) — the pool
every edit composes from. The edit schema is `vided.edl/3`: `tracks.visual` and
`tracks.audio` reference clips by `use:`, so trimming a clip in `clips.yaml`
affects everywhere it is used.

Studio (optional, experimental): `vided studio` starts a local web UI — a thin
adapter over the same CLI and artifacts (job queue, history/proposals, staleness,
timeline editing). It is out of the baseline; see [`STUDIO.md`](./STUDIO.md).

M5: Kokoro/alignment/preview. (MCP is a future/optional feature, not
committed.)

## Versioning

`vided --version` reads `package.json` (`src/cli.ts`). Bump `package.json` in
the same change as a release-worthy feature set.
