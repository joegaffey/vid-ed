# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Narration decomposition** — `vided tts` writes per-segment wavs
  (`work/narration/<id>.wav`) and records each in `narration.timing.json`;
  `vided clips --from-narration <timing.json> [--edl edit.yaml]` emits one
  `vo-<id>` audio clip per segment and places each on the `a1` track at its
  absolute `start` (idempotent; replaces the single `work/narration.wav` clip).
- **Studio: Narration panel** — a `narration.yaml` list in the rail; click a
  segment to edit it on the right; **Generate voice** (`tts`), **Captions**, and
  **Decompose → clips**. (`#8`)
- **Studio: editable context pack** — the generated `work/context.md` is an
  editable, versioned artifact in the Context panel (`#7`).
- **Studio: collapsible Clips groups** — the Clips pool's `video`/`image`/`audio`/
  … groups collapse/expand (state remembered), so long pools stay manageable.
- **Studio layout** — editors/forms (Analysis, Context, Vision, Captions) open in
  the right pane; lists/pools (Media bin, Clips, Output, Changes, Activity)
  stay in the left rail.

## [0.3.0] - 2026-10-11

### Changed

- **Breaking:** the edit schema is now `vided.edl/4` — an ordered list of
  `tracks` (video/audio), with an **absolute `start`** on every item, replacing
  the old `tracks.visual` / `tracks.audio` pair. `vided.edl/3` is removed; there
  is **no converter** — existing `edit.yaml` files must be rewritten. A track's
  first item may omit `start` (defaults to 0).
- `render` composites placements onto a base canvas instead of concatenating the
  visual track: video tracks layer top-down (later = on top), audio tracks mix.
  Gaps render black/silence; `output.duration` sets an explicit timeline length.
- `overlays` is removed — image and text elements are simply items on a video
  track. Same-track items must not overlap (`compose --lint` errors).
- Docs, examples and the checked-in sample are ported to v4.

### Added

- `text` clip kind (`source: generated`): a transparent, reusable text element
  placed on a video track (replaces text overlays).
- Per-item `position` and `opacity`; arbitrary named video and audio tracks.
- `studio`: multi-lane timeline (one lane per track); items edit their absolute
  `start` (plus gain/speed, remove, reorder) and add to the last track of the
  matching kind.

### Fixed

- `render`: pin `aformat=channel_layouts=stereo` before `alimiter`, so a mono,
  untagged voice-over no longer aborts the render on ffmpeg 4.4.x (#4).
- `render`: audio-track `fade_in` / `fade_out` are now applied (they were
  accepted and resolved but silently ignored).
- `render`: transparent `text` clips pass `alpha=1` to the `ass` filter — without
  it libass draws nothing onto a fully-transparent frame and the layer vanishes.

## [0.2.0] - 2026-09-26

### Added

- Clip pool (`vided.clips/1`, `clips.yaml`) and the `clips` stage: a deterministic
  seed pool with `--add` / `--set` / `--rm`, folded into the context pack.
- Kinded clip model (`video`/`image`/`audio`/`title`/`slide`) with canonical
  output formats and per-clip previews (`render --clip <id>`).
- Edit script `vided.edl/3` (`tracks.visual` / `tracks.audio`), plus `compose
  --check/--explain/--lint`.
- Optional local studio (`vided studio`): timeline, history/proposals, staleness.

## [0.1.0] - 2026-09-25

### Added

- Initial toolset: `init`, `doctor`, `scan`, `status`; `extract-text`, `sample`,
  `dedupe`, `annotate`; the manifest and context pack; `compose` + `render`;
  `tts` (Piper) and `captions` (SRT/VTT/ASS).
