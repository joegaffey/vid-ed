# vided project

This directory is managed by `vided`. You compose an edit from the analysed
media; `vided` does the deterministic ffmpeg work. Write `edit.yaml`, never raw
ffmpeg commands, and read the manifest/context pack, never the raw media.

Key artifacts:

- `.vided/config.json`   project configuration
- `.vided/manifest.json` the analysis contract (read this, not raw media)
- `brief.md`             project-level context: audience, tone, target length
- `<media>.md`           per-input notes (next to the media file)
- `clips.yaml`           the pool of clips you select from (`vided clips`)
- `edit.yaml`            the edit you compose (`vided compose`)

Typical ask: "Make a narrated video from these clips."

## Workflow (order matters)

    vided scan
    vided extract-text          # optional; needs whisper
    vided sample
    vided dedupe
    vided clips
    vided manifest --context-pack work/context.md   # read this, then write edit.yaml
    vided compose edit.yaml --check --lint
    vided render edit.yaml
    vided render --clip <id>    # preview one clip at its own format (cached)

With narration, between `clips` and `compose`:

    vided script --out narration.yaml     # rewrite the prose
    vided tts narration.yaml
    vided captions --from narration --formats srt,vtt,ass
    # register the wav as an audio clip; set captions: { mode: burn, file: work/captions.ass }

## Vision (describe the footage)

    vided annotate --packet-out work/vision.packet.json   # read the frame JPEGs
    vided annotate --ingest work/vision.results.json
    vided manifest --context-pack work/context.md         # re-run after ingest

## Clips and edit

Every clip has a `kind` (video/image/audio/title/slide), a `source` (or
`"generated"` for title/slide) and a `format` from: 1080p30, 1080p60, 720p30,
540p30, 480p30, 360p30, vertical1080p30, square1080p30, audio48k.

    # clips.yaml
    schema: vided.clips/1
    clips:
      - { id: sel-a, kind: video, source: input/a.mp4, format: 1080p30, in: 0, out: 4 }
      - { id: title-open, kind: title, source: generated, format: 1080p30, title: "Demo", duration: 3 }

    # edit.yaml
    schema: vided.edl/3
    output: { format: 1080p30, path: out/final.mp4 }
    tracks:
      visual:
        - { id: intro, use: title-open }
        - { id: a, use: sel-a }
      audio: []

Gather context through conversation and persist it to `brief.md` + per-input
sidecars. `vided <command> --help` lists flags; all commands emit JSON.

A human may edit the shared artifacts (`clips.yaml`, `edit.yaml`,
`context.yaml`, `narration.yaml`, `brief.md`) via `vided studio` or by hand. If
`.vided/STUDIO_CHANGES.md` exists, read it and re-read those files before
assuming your copy is current.
