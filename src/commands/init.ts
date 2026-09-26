import { basename } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigSchema, ensureProjectDirs, isProject, projectPaths, writeConfig } from "../config.js";
import type { OutputOptions } from "../ui.js";
import { emit, fail } from "../ui.js";

export interface InitOptions extends OutputOptions {
  dir: string;
  project?: string;
  inputs: string[];
  force?: boolean;
}

const AGENT_STUB = `# vided project

This directory is managed by \`vided\`. See the repository AGENTS.md for the
agent workflow. Key artifacts:

- \`.vided/config.json\`   project configuration
- \`.vided/manifest.json\` the analysis contract (read this, not raw media)
- \`clips.yaml\`           the pool of clips you select from (\`vided clips\`): each
                         has a kind (video/image/audio/title/slide) and a format
                         from the set in the repo AGENTS.md
- \`edit.yaml\`            the edit you compose; tracks.visual/audio reference
                         clips by \`use:\` (\`vided compose\`)
- \`brief.md\`             project-level context: audience, tone, target length
- \`<media>.md\`           per-input notes (next to the media file)

Gather context through conversation, then write it to \`brief.md\` and the
per-input sidecars so it persists. Run \`vided manifest --context-pack\` to fold
it into the agent-facing digest.

Typical ask: "Make a narrated video from these clips." See the repository
AGENTS.md for the ordered workflow, the vision (frame description) step and
starter prompts.
`;

export async function cmdInit(opts: InitOptions): Promise<void> {
  const paths = projectPaths(opts.dir);
  if (isProject(paths) && !opts.force) {
    fail(`A vided project already exists at ${paths.root}. Use --force to reinitialise.`);
  }
  await mkdir(paths.root, { recursive: true });
  await ensureProjectDirs(paths);

  const config = ConfigSchema.parse({
    schema: "vided.config/1",
    project: opts.project ?? basename(paths.root),
    input_roots: opts.inputs.length ? opts.inputs : ["input"],
    profile: "default",
  });
  await writeConfig(paths, config);

  const agentsPath = join(paths.root, "AGENTS.md");
  await writeFile(agentsPath, AGENT_STUB, { encoding: "utf8", flag: opts.force ? "w" : "wx" }).catch(
    () => undefined,
  );

  emit(
    { ok: true, root: paths.root, project: config.project, input_roots: config.input_roots },
    () => `Initialised vided project "${config.project}" at ${paths.root}`,
    opts,
  );
}
