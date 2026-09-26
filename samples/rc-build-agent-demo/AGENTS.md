# vided project

This directory is managed by `vided`. See the repository AGENTS.md for the
agent workflow. Key artifacts:

- `.vided/config.json`   project configuration
- `.vided/manifest.json` the analysis contract (read this, not raw media)
- `clips.yaml`           the pool of clips you select from (`vided clips`): each
                         has a kind (video/image/audio/title/slide) and a format
                         from the set in the repo AGENTS.md
- `edit.yaml`            the edit you compose; tracks.visual/audio reference
                         clips by `use:` (`vided compose`)
- `brief.md`             project-level context: audience, tone, target length
- `<media>.md`           per-input notes (next to the media file)

Gather context through conversation, then write it to `brief.md` and the
per-input sidecars so it persists. Run `vided manifest --context-pack` to fold
it into the agent-facing digest.

Typical ask: "Make a narrated video from these clips." See the repository
AGENTS.md for the ordered workflow, the vision (frame description) step and
starter prompts.
