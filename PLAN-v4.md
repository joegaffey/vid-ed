# PLAN-v4 — implementing the absolute multi-track timeline

Status: DONE except release. Target: [`SPEC-v4.md`](./SPEC-v4.md)
(`vided.edl/4`). Baseline was `vided.edl/3` + `vided.clips/1` (now removed).
Audience: implementers.

## Strategy

- **Branch per phase**, merged in order into an integration branch
  (`feat/edl-v4`) or straight to `main` once each phase is green.
- **In place, big-bang.** `src/schemas/edl.ts` is rewritten to v4 on the branch;
  `edl/3` is **removed outright — no converter** (`SPEC-v4.md` §9). Examples,
  sample, tests and the studio are ported in the same branch.
- **Every phase** exits on `npm run verify` (typecheck + tests + studio build)
  plus phase-specific fixtures. `--dry-run` snapshots are the renderer contract.

Phase → PR mapping: **V4a = Phases 1–2**, **V4b = Phases 3–4**,
**V4c = Phase 5**, **V4d = Phases 6–7**, then Phase 8.

## Phase 0 — setup

- Branch `feat/edl-v4`.
- Add a v4 fixture project under `src/test/fixtures/` (a 2–3 track edit with a
  video clip, an image on a second video track, narration audio, and a gap).
- Decide module layout: **new `src/schemas/edl4.ts`** rather than mutating
  `src/schemas/edl.ts` (keeps v3 stable); version dispatcher in
  `edl.ts:loadEdlFromString`.

## Phase 1 — schema (`V4a`) — `src/schemas/edl4.ts`

- `OutputSchema4` — as v3 plus optional `duration`.
- `TrackSchema` — `{ id, kind: video|audio, items }`, unique ids.
- `VideoItemSchema4` — `start`, `speed`, `transform`, `position`, `opacity`,
  `transition_in`, `transition_out`.
- `AudioItemSchema4` — `start`, `gain_db`, `fade_in`, `fade_out`,
  `duck_under?` (deferred behavior; see Open Questions).
- `TracksSchema4 = z.array(TrackSchema).min(1)`.
- Reuse `CaptionsSchema` unchanged.
- Tests: accepts the `SPEC-v4.md` §3 example; rejects negative `start`,
  duplicate track ids, unknown `kind`.

**Exit:** a `vided.edl/4` JSON Schema is emitted via `zod-to-json-schema`;
typecheck green.

## Phase 2 — resolve / explain / lint (`V4a`)

- `src/edl.ts`:
  - `resolveEdl4` — bind `use`→clip, validate `kind`↔track, compute item
    durations (`SPEC-v4.md` §4.1) and absolute intervals.
  - `explainEdl4` — per-track items, total duration, gaps, audio-fit.
  - `lintEdl4` — same-track overlap (§4.2), gaps, `start < 0`, fade > item,
    format mismatch, audio-longer-than-video.
- `loadEdlFromString` — parses exactly one schema (`vided.edl/4`); no converter.
- Tests: `edl4.test.ts` (resolve/explain/overlap lint).

**Exit:** `compose --check/--explain/--lint` runs on both a v3 and a v4 file;
migration is lossless for the fixture.

## Phase 3 — renderer (`V4b`) — `src/render.ts`

- Replace the cursor/concat visual path (`src/render.ts:68`, `:159`) with
  placement compositing (`SPEC-v4.md` §7): base `color` canvas → each track's
  items shifted with `setpts=PTS-STARTPTS+<start>/TB` and composited with
  `overlay=eof_action=pass`; `format=rgba` + `colorchannelmixer=aa=<opacity>`
  and `position`/`transform` for sub-frame elements.
- Audio path (`src/render.ts:235`): `offset` → `start`; otherwise unchanged
  (`atrim`/`afade`/`volume`/`aresample`/`adelay`, then the master chain).
- Gaps render black/silence; `output.duration` default = max end.
- Tests: unit assertions on the generated filter; **real-render check** with a
  two-track edit (composite, transparent text, gaps, stereo mix).

**Exit:** v4 fixtures render correctly for `render` and `--preview`;
`render --clip <id>` unaffected.

## Phase 4 — CLI (`V4b`)

- `compose` / `render` operate on v4 (no `migrate` — `SPEC-v4.md` §9).
- Update help text and JSON payloads; update `SPEC.md` §7.

**Exit:** the command surface in `SPEC.md` §7 matches the implementation.

## Phase 5 — overlays fold + `text` kind (`V4c`)

- `src/schemas/clips.ts`: add the `text` generated kind (`text`, `style`,
  `duration`).
- `src/render.ts`: render text clips via libass (transparent, `alpha=1`); the
  old overlay render path is deleted.
- `src/clips.ts`, `src/preview.ts`: `text` is authored (not derived) and
  previewable.
- Tests: text clip renders transparent over a lower track.

**Exit:** `overlays` are gone; text clips composite correctly.

## Phase 6 — studio (`V4d`) — `src/server/*`, `src/edl-edit.ts`

- `src/edl-edit.ts`: v4 ops (move/trim/set by absolute `start`; add/remove
  items and tracks), AST-preserving as today.
- `src/server/`: timeline model becomes multi-lane; staleness/history unchanged.
- `src/server/public/app.js`: N video + N audio lanes; absolute positioning;
  drag/trim; per-lane add. Remove the single-lane assumption and the overlay
  panel.
- Tests: extend `studio-api.test.ts` (edit/apply/revert on v4).

**Exit:** the studio edits a v4 timeline end-to-end.

## Phase 7 — docs / examples / samples (`V4d`)

- Port `examples/edit.yaml` and `samples/rc-build-agent-demo/edit.yaml` to v4.
- Update `AGENTS.md`, `README.md`, `SPEC.md` §6.3, `DEVELOPMENT.md` status.
- Set `SPEC-v4.md` status → implemented.

## Phase 8 — cleanup / release

- v3 code path is already deleted (no converter).
- Bump `package.json` (0.3.0) with the release.

## Cross-cutting

- **Tests:** `node --test`; new `edl4.test.ts`; extend `m2.test.ts`,
  `example.test.ts`, `studio-api.test.ts`.
- **Verification:** `npm run verify` at every phase gate.
- **Risks:**
  1. Compositor correctness/perf with many layers → per-track intermediates
     behind a future `--debug`.
  2. Studio multi-lane is the largest UI change.
  3. `text` transparency (needs `ass=…:alpha=1`).
- **Deferred (per `SPEC-v4.md` §14):** `duck_under` (`sidechaincompress`, still
  unimplemented), `clips.yaml`/`edit.yaml` file unification, crossfades,
  keyframes.

## Where narration decomposition lands

After **Phase 3** (renderer v4), so it targets the final placement shape:
`tts` emits stable per-sentence wavs, `clips` adds `vo-<id>` audio clips, and a
command appends one `a1` item per sentence at `start = sentence.start`. It rides
on v4 with no extra schema work. (This supersedes issue #5's `align_to`.)

## Progress

- [x] Phase 0 — setup
- [x] Phase 1 — schema (`V4a`) — `src/schemas/edl.ts` (`vided.edl/4`)
- [x] Phase 2 — resolve / explain / lint (`V4a`) — `src/edl.ts`
- [x] Phase 3 — renderer (`V4b`) — `src/render.ts` (placement compositor)
- [x] Phase 4 — CLI (`V4b`) — `compose`/`render`/`preview` (no `migrate`, §9)
- [x] Phase 5 — overlays fold + `text` kind (`V4c`) — `src/schemas/clips.ts`
- [x] Phase 6 — studio (`V4d`) — multi-lane timeline (one lane per track),
      `start` editing, add-to-track; verified live in-browser
- [x] Phase 7 — docs / examples / samples (`V4d`) — examples, sample, `AGENTS.md`,
      `README.md`, `SPEC.md`, `DEVELOPMENT.md`, `SPEC-v4.md`, `STUDIO.md`
- [ ] Phase 8 — cleanup / release — package version bump pending (breaking
      change → candidate 0.3.0)

Notes: `edl/3` is removed outright (no converter) per the finalized decision;
`duck_under` deferred. Verified with `npm run verify` (typecheck + 78 tests +
studio build).
