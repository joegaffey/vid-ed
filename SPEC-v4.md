# vided — EDL v4: absolute multi-track timeline

Status: IMPLEMENTED (core). `vided.edl/4` is the current schema; `edl/3` is
**removed** (breaking change — no converter). The renderer, resolve/explain/lint,
`clips.yaml`, examples and the checked-in sample are ported. Remaining: the
studio timeline UI (see [`PLAN-v4.md`](./PLAN-v4.md) Phase 6). See
[`SPEC.md`](./SPEC.md) §5.8–5.9 and §6.3.
Audience: implementers + CLI agents.
Related: issue #5 (per-sentence anchoring), `SPEC.md`, `DEVELOPMENT.md`,
`STUDIO.md`.

## 1. Motivation

`edl/3` models the timeline asymmetrically:

- `tracks.visual` is a **relative, sequential concat** — a clip's position is
  the running sum of everything before it (`src/render.ts:68`,
  `src/edl.ts:127`). There is no per-clip time.
- `tracks.audio` is **free-positioned** with an absolute `offset`
  (`src/schemas/edl.ts:28`).
- `overlays` are a **third** timing model — absolute `start`/`end`
  (`src/schemas/edl.ts:59`) — but a special case, not a track.

Three timing models in one file is confusing for humans and hostile to agents:
positions are *derived*, not *declared*, so aligning a shot to a narration beat
requires cumulative arithmetic that drifts whenever a clip length changes
(issue #5). Professional NLEs avoid this by putting every clip at an **absolute
start on a shared timeline**, with **N stacked tracks** that composite (video)
and mix (audio).

v4 adopts that model. The deltas:

| | `edl/3` | `edl/4` |
|---|---|---|
| Track shape | fixed `{visual, audio}` pair | ordered `tracks[]` list |
| Item position | visual: derived (concat); audio: `offset` | **every item has absolute `start`** |
| Video layering | none (except `overlays`) | stacked tracks, composited |
| Audio layering | one mixed track | N tracks, mixed |
| Overlays | special construct | folded into video tracks |
| Clip `in`/`out` | source-relative | source-relative (**unchanged**) |

`clips.yaml` (`vided.clips/1`) is **unchanged** — definitions stay a separate
file for now.

## 2. The model

Three axes, deliberately distinct (pro editors: media pool → subclips →
timeline):

1. **Asset** — a file on disk. Owned by the manifest (`.vided/manifest.json`),
   machine-generated.
2. **Clip** — a reusable, named range/format/metadata of a source
   (`clips.yaml`). Ids are stable; `in`/`out` are **relative to the source**.
3. **Placement** — one *use* of a clip at an absolute time on one track
   (`edit.yaml`). A clip may be placed many times.

v4 changes **only** axis 3's shape. Axes 1 and 2 are untouched.

## 3. Schema (`vided.edl/4`)

```yaml
schema: vided.edl/4

output:
  format: 1080p30            # canonical format name (see AGENTS.md)
  path: out/final.mp4
  loudness_lufs: -14
  crf: 23
  preset: medium
  audio_bitrate: 192k
  duration: 42.5             # OPTIONAL; default = max item end across tracks

tracks:                      # ordered: later video tracks composite on top
  - id: v1
    kind: video
    items:
      - { id: intro, use: title-intro, start: 0 }
      - { id: shot-a, use: sel-a, start: 3, transition_in: { type: fade, duration: 0.5 } }
      - { id: shot-b, use: sel-b, start: 8, speed: 0.5 }
  - id: v2                   # a lower-third / b-roll layer
    kind: video
    items:
      - { id: gist, use: still-gist, start: 5, position: top-right, opacity: 0.9,
          transform: { scale: 640x360, pad: false } }
  - id: a1                    # narration
    kind: audio
    items:
      - { id: vo-intro, use: vo-intro, start: 0 }
      - { id: vo-body, use: vo-body, start: 3.5 }
  - id: music
    kind: audio
    items:
      - { id: bed, use: music, start: 0, gain_db: -18, duck_under: a1 }

captions:                     # unchanged from edl/3
  mode: soft
  file: work/captions.srt
  style: { font: "Inter", size: 42, position: bottom, margin_v: 64 }
  export: [srt, vtt]
```

### 3.1 Item fields

Common (all kinds):

- `id` — unique within the file.
- `use` — a clip id from `clips.yaml`.
- `start` — **absolute** seconds from timeline zero. Required.
- `transition_in` / `transition_out` — fades (see §4.4).

Video-track item:

- `speed` — playback rate (default `1`).
- `transform` — `{ scale, pad }` (as today).
- `position` — `top-left|top-right|bottom-left|bottom-right|center|top|bottom`
  (default `center`, i.e. full-frame). Non-center + a smaller `transform` makes
  a picture-in-picture / overlay element.
- `opacity` — `0..1` (default `1`).

Audio-track item:

- `gain_db` — per-placement gain (default `0`).
- `fade_in` / `fade_out` — seconds (already implemented in `render`).
- `duck_under` — a track id whose audio ducks this item (`sidechaincompress`);
  see §6.3 and Open Questions.

### 3.2 Defaults / normalization

- `start` defaults to `0` only for the first item of a track; elsewhere it is
  **required** (no implicit "append").
- `output.duration`, if omitted, is `max(start + itemDuration)` over all items.
- Tracks are ordered; `kind` is `video` or `audio`. Ordering is composition
  order for video (later = on top) and is irrelevant for audio (all mixed).

## 4. Timing semantics

### 4.1 Item duration

- **video clip**: `(out - in) / speed`.
- **image / title / slide / text clip**: `clip.duration` (source has no length).
- **audio clip**: `out - in` if `out` is set, else `clip.duration` if set, else
  `source_duration - in`.

An item occupies the half-open interval `[start, start + duration)`.

### 4.2 Non-overlap within a track

Items on the **same track must not overlap** (`compose --lint` errors). To stack
in time, use a **different track**. This keeps one track = one linear cut and
makes compositing explicit.

### 4.3 Gaps

Gaps are **not** auto-filled by concatenation. Uncovered ranges on a video track
render as the base canvas (black by default); on an audio track as silence. If
`output.duration` exceeds the last item, the tail is black/silent.

### 4.4 Transitions

v4 transitions are **fades to/from the base** (`fade=t=in|out`), exactly as
`edl/3` implements them (`src/render.ts:86`) — not crossfades. They are a
property of the item and need no adjacency to a neighbour. (Crossfades between
adjacent items are a possible later addition; see Open Questions.)

### 4.5 Two timing tools only

With absolute `start` everywhere, alignment needs just:

- an item's `start`, and
- (optionally) an explicit gap by leaving a hole between items.

This replaces the `edl/3` split between sequential-visual and offset-audio, and
retires `overlays`' bespoke timing.

## 5. Compositing and mixing

- **Video**: render tracks bottom-to-top. Track *n+1* items are drawn over the
  accumulated canvas of tracks ≤ *n*. Full-frame opaque items on a higher track
  cover lower ones (use a dedicated track for a full cutover). `opacity`,
  `position`, and a sub-frame `transform.scale` produce overlays/PiP.
- **Audio**: all audio-track items are trimmed, gained, faded, delayed to `start`
  and `amix`ed. A master chain (`loudnorm` + `dynaudnorm` + `aformat` +
  `alimiter`) runs once, as today (`src/render.ts:266`).
- Duplex: the visual output is `[vfinal]`; the audio mix is `[aout]`; both map to
  the single output.

## 6. Folding `overlays` into tracks

`edl/3`'s `overlays[]` (image + text, absolute `start`/`end`) is exactly a
video layer. v4 folds it:

- **image overlay** → an `image` clip placed on a video track with `start`,
  `opacity`, `position`, `transform`.
- **text overlay** → a **`text` generated clip kind** (sibling of
  `title`/`slide`): `{ kind: text, source: generated, text, style, duration }`,
  placed on a video track with `start`. Text becomes a reusable, placeable unit
  instead of an overlay-only concept.

There is **no compatibility reader** — `edl/3` is removed outright (see §9).

## 7. Renderer (`src/render.ts`)

The concat/cursor model is replaced by **placement overlays**:

1. Build a base canvas of `output.duration` (or the computed max end):
   `color=c=<bg>:s=WxH:r=<fps>:d=<duration>`.
2. For each video track, for each item (ordered by `start`): trim/scale/pad/
   fade as today; shift onto the timeline with
   `setpts=PTS-STARTPTS+<start>/TB`; composite with
   `overlay=eof_action=pass` (and `format=rgba` + `colorchannelmixer=aa=<opacity>`
   when `< 1`). Track order = z-order.
3. Audio items: `atrim`, `asetpts`, `afade`, `volume`, `aresample`,
   `adelay=<start*1000>` — unchanged from today's audio path
   (`src/render.ts:235`), just with `start` instead of `offset`.
4. Master video format (`format=yuv420p`) and audio chain as today.

Intermediates: for large graphs, render each track to an intermediate then
composite (behind a future `--debug`; single pass by default — see `SPEC.md`
§13.3).

## 8. Compose / explain / lint

- `resolveEdl` resolves `use:` refs and validates `kind`↔track.
- `--explain` reports, **per track**, items with absolute `start`/`end`, plus
  total duration, gaps, and whether the audio extent fits the video extent.
- `--lint` warns/errors on: unknown clip/source; duplicate ids; **overlapping
  items on one track**; gaps beyond a threshold; `start < 0`; transition/fade
  longer than the item; format mismatch with `output.format`; audio longer than
  video.

## 9. Breaking change (no compatibility)

`edl/3` is **removed** — there is **no converter and no `vided migrate`**. An
existing `edit.yaml` must be rewritten to v4 (the agent/human does it by hand;
for a sequential visual timeline, compute absolute `start`s from the running
cursor). Decisions (finalized):

- `clips.yaml` (`vided.clips/1`) is unchanged apart from the additive `text`
  kind.
- `vided render --clip <id>` (single-clip preview) is unaffected.
- Examples (`examples/edit.yaml`), the checked-in sample, `AGENTS.md`,
  `README.md`, `SPEC.md`, `DEVELOPMENT.md` are ported. The studio timeline UI is
  the remaining port (Phase 6).

## 10. Studio (`src/server/*`)

The timeline becomes **multi-lane**: one lane per track, items positioned by
absolute `start`, with drag/trim updating `start`/`in`/`out`. The existing single
audio lane (`b4dacf5`) generalizes to N audio + N video lanes. Same artifacts,
same history/staleness model.

## 11. Relationship to narration decomposition

Narration decomposition (sentence → clip + placement) lands cleanly on v4:
`tts` emits stable per-sentence wavs, `clips` adds `vo-<id>` audio clips, and a
command appends one `a1` item per sentence at `start = sentence.start`.

Because v4 gives **visual items an absolute `start`**, anchoring a shot to a
sentence is now *placing it at the same time* — no bespoke `align_to` field is
strictly required. Caveat: a same-track cutover still needs the previous item to
end at that start (or the new shot goes on a higher track). So v4 removes the
*gross* sync problem (positions are declared, not derived) but a small helper
("trim previous item to this start") may still be worth adding for the cut case.
This supersedes the `align_to` proposal in issue #5.

## 12. Agent impact

- **One position axis**: an agent sets `start`; it never computes cumulative
  durations. Re-worded narration no longer shifts the timeline silently.
- **Declarative layering**: "put this on `v2`" instead of juggling overlays.
- **Deterministic lint**: overlaps/gaps are reported, so an agent can self-correct.
- **Unchanged contracts elsewhere**: manifest, clips, captions, tts.

## 13. Non-goals (v4)

- Keyframes / animation of transform, opacity, gain.
- Crossfades / `xfade` between adjacent items (fades only).
- Speed ramps; per-clip colour/LUT nodes (Resolve-style).
- Nested sequences / compound clips.
- Multi-file projects or unifying `clips.yaml` + `edit.yaml` (explicitly deferred;
  see Open Questions).
- Track-level effect chains beyond `duck_under`.

## 14. Decisions (resolved) / open questions

Resolved:

1. **`duck_under` / ducking** — **deferred**; not in v4. Manual `gain_db` only.
2. **`text` clip kind** — **added**; `overlays` **removed** and folded into video
   tracks (image → `image` clip, text → `text` clip).
3. **Same-track overlap** — **hard error** (`lint`).
4. **`start` default** — a track's **first** item may omit `start` (defaults 0);
   later items must declare it.
5. **`start` units** — seconds (float).
6. **File unification** — **deferred**; `clips.yaml` + `edit.yaml` stay separate.
7. **v3** — **removed**; no converter (breaking change, §9).

Open:

- **Track ids**: free-form (`v1`, `music`); auto-generate if omitted (studio).
- **Transitions between adjacent items** (crossfades) — future; v4 fades only.
- **Keyframes / automation** — future.

## 15. Milestones / acceptance

- **V4a — model**: `src/schemas/edl.ts` becomes `vided.edl/4` in place (no
  converter); `resolveEdl` + `--explain`/`--lint` on the new shape.
- **V4b — renderer**: placement-based video compositor + audio mix; `--dry-run`
  plans; verified with a real `vided render`.
- **V4c — overlays fold**: `text` clip kind; `overlays` removed; the overlay
  render path retired.
- **V4d — docs/examples/studio**: port examples, sample, docs; multi-lane studio
  timeline.

Acceptance (met):

- The `edl/4` renderer produces correct output (verified on ffmpeg 6.1.1:
  multi-track composite, transparent text, black gaps, stereo mix).
- Narration decomposition produces `vo-<id>` clips + `a1` items at absolute
  starts; re-wording one sentence moves only that item.
- `--lint` flags same-track overlaps and gaps; `--explain` reports per-track
  absolute positions.
