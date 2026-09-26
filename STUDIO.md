# STUDIO.md — vid-ed Studio (proposed)

Status: DRAFT — plan only. Phasing (§13) is provisional pending spec review.

Implementation status: **P0 done** — `vided studio` starts a local server
(Node built-ins + existing `execa`, no new deps) that serves a static UI shell
and exposes `/api/status`, `/api/manifest`, `/api/jobs` (+ SSE) and `/api/jobs/:id`.

**P1 done** — uploads (files via raw body + URLs via `yt-dlp`), scan wiring,
context editing (`context.yaml` + per-input metadata), parameterized stage runs,
frame gallery (`/api/assets/:id/frames`, `/api/frames/...`), media serving with
HTTP Range, and outputs listing/download. Context is now read by
`manifest --context-pack` and `script` (brief, directives, per-input
title/role/tags/notes).

**UI redesign — Phase A done** — NLE-style shell: top bar (project, tool health,
refresh), a resizable **left rail with accordion sections** (Project, Media bin,
Analysis, Context, Vision, Output, Activity), a center **Details** view for the
selected artefact (asset Overview with a streaming preview + frame gallery), and a
resizable bottom **Timeline** placeholder. Built with **Lit** (client bundled by
`esbuild` via `npm run build:studio`), served statically from `dist/studio`.
Selection model `{ kind: 'none'|'asset'|'timelineItem', id }`; pane sizes and the
open section persist in `localStorage`.

**Details — Phase C done** — asset tabs are kind-aware, and actions live with
the output they produce: **Overview** (preview / text content + metadata; OCR
for images), **Transcript** (video/audio; transcribe/re-transcribe + segments),
**Frames** (video; sample/dedupe/build-packet + gallery), **Notes** (all; title/
role/tags/notes → `context.yaml`). Raw CLI output stays behind a collapsed
"technical log".

**Sections — Phase D done** — **Analysis** (project-wide parameterized stage
runs: scan/extract-text/sample/dedupe/manifest/script/tts/captions/render),
**Context** (full `context.yaml`: brief, audience, tone, target duration,
must-include, avoid, voice, language, pronunciation; save + build context pack),
**Vision** (selected/annotated counts; build packet / ingest results).

`vided Studio` is an optional local server + web UI for smart editing and
fine-tuning where the agent is insufficient. The agent remains master; the CLI
stays the source of truth. The studio is a **thin adapter**: it drives the same
commands and reads/writes the same artifacts. No business logic lives in the
server.

## 1. Purpose & identity

- Smart editing / fine-tuning of a project the agent has already analysed.
- Optional and out-of-baseline: existing CLI users are unaffected.
- Server = orchestration + UI only; every action maps to a CLI command or a
  read/write of an artifact the CLI owns.

## 2. Non-goals

- No auth (localhost only).
- No auto-merge of concurrent edits.
- No replacement for the agent's composition role.
- No new canonical artifacts — the studio edits the existing ones.

## 3. Architecture

- **Process:** one Node process (`src/server/`), binds `127.0.0.1`, serves the
  static UI and `/api/*`.
- **Integration:** spawn the CLI (`node dist/cli.js --dir … <cmd>`) for the MVP;
  later refactor commands to `runX(opts, { onProgress, signal })` core +
  thin wrapper for progress/cancel. The CLI contract is preserved.
- **State:** all on disk. Canonical artifacts unchanged; studio bookkeeping in
  `.studio/`.
- **Jobs:** serialized single-writer queue with status/logs/cancel; progress
  streamed via SSE.
- **Realtime:** SSE for job logs, watcher events and stale notifications.

## 4. Context model

- **`context.yaml`** (`vided.context.input/1`): prose `brief` plus
  `audience, tone, target_duration_s, must_include, avoid, pronunciation, voice,
  language`. `brief.md` remains a fallback for existing projects.
- **Per-input metadata:** `context.yaml` `assets:` map (path-keyed) for
  `title/role/tags/notes`.
- **Sidecars next to media:** `<media>.md` (notes), `<media>.srt|.vtt|.txt`
  (authored transcript).
- **Precedence: latest wins** (newest writer/mtime:
  edited > provided/sidecar > generated).
- **Consumers:** `tts` applies `pronunciation`; `compose --lint` warns when
  `target_duration_s` is exceeded; `must_include`/`avoid` are advisory in the
  context pack.

## 5. Stage registry (`src/stages.ts`)

Single source of stage metadata, used by both CLI flags and UI controls:

```ts
{ op, label, scope: "project" | "asset",
  params: [{ name, type, default, enum?, min?, max? }],
  reads: [...], writes: [...], forceable: boolean }
```

- CLI flags derive from it (behaviour-preserving refactor).
- The UI renders forms from it.
- `reads`/`writes` also define the staleness graph.

## 6. Processing controls

- Run stages **project-wide or per-asset** with parameters (e.g. re-transcribe a
  single asset with a different model).
- Cheap **dry-run preview** where available (e.g. "sample @0.25 → 43
  candidates").
- Resolved params are recorded in the history entry.

## 7. Change model (mandatory check)

- Every studio-originated change is a **proposal**; **Apply** is required before
  a canonical artifact is written.
- **History:** `.studio/history/<artifact>.json` — a JSON **array** of
  whole-artifact versions, **deduped** by content hash.
- **Entry:** `{ ts, writer, hash, content, stage?, params?, label? }`.
- Operations: diff any two versions, **restore** (append-only), discard.
- **No auto-merge:** an external change over unsaved edits → notify + diff +
  manual choice.

## 8. Provenance & staleness

- **Provenance:** `writer: "studio" | "agent"`.
- **Lineage:** not stored; generated entries carry `stage`/`params`.
- **Staleness:** **mtime-based along the registry graph** — artifact A is stale
  if any registry-declared input has `mtime > A.ts`. Studio-only; never surfaced
  by the CLI.
- **Watcher:** `fs.watch` with a **2s polling fallback**; on change append a
  `writer: "agent"` version and recompute staleness.

## 9. Storage layout

- **`.studio/`** (top level, gitignored, skipped by `scan`): `history/`,
  `drafts/`, watcher state. Off-limits to the agent.
- **Agent-space notification file:** `.vided/STUDIO_CHANGES.md`, maintained by
  the studio. It lists artifacts whose **latest writer is `studio`**, with the
  last-changed time; when the agent later writes an artifact, its entry is
  removed. This is the one intentional agent-facing studio file; everything else
  stays in `.studio/`. `AGENTS.md` references it.

## 10. API surface

- `GET /api/status|manifest|context`; `PUT /api/context`,
  `PUT /api/context/assets/:id`
- `POST /api/uploads` (files + URLs via optional `yt-dlp`); `POST /api/scan`
- `POST /api/jobs` `{ op, args }`, `GET /api/jobs`, `GET /api/jobs/:id`,
  `GET /api/jobs/:id/events` (SSE), `DELETE /api/jobs/:id`
- `GET /api/assets/:id/frames`, `GET|PUT /api/assets/:id/transcript`,
  `POST /api/assets/:id/reset`
- `GET /api/media/:assetId` (HTTP Range)
- `GET /api/history/:artifact`, `POST /api/diff`, `POST /api/apply`,
  `POST /api/revert`
- `GET|PUT /api/narration`, `POST /api/narration/:i/preview`;
  `GET|PUT /api/edl`, `POST /api/edl/check|lint|explain`, `POST /api/render`
- `GET /api/outputs`, `GET /api/outputs/:file`

## 11. UI surfaces

**Lit** components, client bundled with `esbuild` (`npm run build:studio`) and
served statically from `dist/studio`. No framework runtime beyond Lit.

**UI principle: never show raw JSON/YAML.** Artifacts are presented as
purpose-built views (cards, tables, forms, editors). Raw file contents are
available only behind an explicit, collapsed "technical" disclosure, never as
the primary presentation.

**NLE-style shell:** top bar (project, tool health, refresh); a resizable
**left rail with accordion sections** (one open at a time); a center **Details**
view for the selected artefact; a resizable bottom **Timeline**. Selection is
`{ kind: 'none'|'asset'|'timelineItem', id }`; pane sizes and the open section
persist in `localStorage`.

- **Project** — status, `doctor`, quick pipeline.
- **Media bin** — upload (files/URL), search, asset list (click → Details).
- **Analysis** — parameterized runs, candidate → selected frames.
- **Context** — brief/structured fields.
- **Vision** — frame gallery with editable descriptions/tags.
- **Script** — narration segments (text/timing/voice), per-segment TTS preview.
- **Output** — rendered files, sidecars, publish metadata.
- **Activity** — jobs list + live log (SSE).
- **Details** — asset tabs (kind-aware: Overview · Transcript · Frames · Notes;
  actions colocated with their output) or timeline-item editor
  (clip/title/slide/still).
- **Timeline** — read-only from `edit.yaml` first, editable later (P4).
- **Review** — diff/apply/revert, integrated into every editor (P2).

## 12. CLI impact

- New: `vided studio` (lazy-imported so existing commands never load server
  deps), optional `studio` config fields.
- Unchanged: all existing commands' JSON, flags and exit codes.
- `.studio/` is additive; the agent-space notification file is runtime-generated.
- No `vided changes` command (replaced by the notification file).

## 13. Phasing (provisional — revisit with spec)

- **P0** — server skeleton, static UI shell, job queue + SSE, status/manifest
  endpoints.
- **P1** — uploads (files + URLs), scan, context editing, analysis runs, frames,
  outputs.
- **P2** — history/proposals/diff/apply/revert + staleness + watcher +
  notification file.
- **P3** — narration editor (per-segment TTS preview), captions.
- **P4** — structured EDL editor + preview/full render.
- **P5** — vision description editing; publish metadata.
- **Later** — core-function refactor for progress/cancel; optional MCP.

## 14. Risks

- **Identity drift** → enforce the thin-adapter rule; UI-only logic stays in the
  UI.
- **Concurrent CLI/studio writers** → single-writer queue + `.studio/` watcher.
- **mtime false positives/negatives** → optional hash-confirm upgrade path.
- **No framework** → keep components small; adopt Lit if complexity grows.
