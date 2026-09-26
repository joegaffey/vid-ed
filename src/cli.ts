#!/usr/bin/env node
import { Command } from "commander";
import { cmdInit } from "./commands/init.js";
import { cmdDoctor } from "./commands/doctor.js";
import { cmdScan } from "./commands/scan.js";
import { cmdStatus } from "./commands/status.js";
import { cmdExtractText } from "./commands/extract-text.js";
import { cmdSample } from "./commands/sample.js";
import { cmdDedupe } from "./commands/dedupe.js";
import { cmdCompose } from "./commands/compose.js";
import { cmdRender } from "./commands/render.js";
import { cmdTts } from "./commands/tts.js";
import { cmdCaptions } from "./commands/captions.js";
import { cmdModels, cmdVoicesSearch } from "./commands/models.js";
import { cmdAnnotate } from "./commands/annotate.js";
import { cmdManifest } from "./commands/manifest.js";
import { cmdClips } from "./commands/clips.js";
import { cmdScript } from "./commands/script.js";
import type { OutputOptions } from "./ui.js";
import { fail } from "./ui.js";

const program = new Command();

program
  .name("vided")
  .description("Agentic video editor toolset")
  .version("0.1.0")
  .option("--human", "human-readable output (default is JSON)", false)
  .option("--json", "JSON output (default)", true)
  .option("-q, --quiet", "suppress output", false)
  .option("--dir <dir>", "project directory", process.cwd());

function outputOptions(): OutputOptions {
  const o = program.opts();
  return { json: !o.human, quiet: Boolean(o.quiet) };
}

function projectDir(): string {
  return program.opts().dir as string;
}

program
  .command("init")
  .description("create a new vided project")
  .option("--project <name>", "project name")
  .option("-i, --input <dir...>", "input roots", [])
  .option("--force", "reinitialise an existing project", false)
  .action(async (opts) => {
    await cmdInit({
      ...outputOptions(),
      dir: projectDir(),
      project: opts.project,
      inputs: opts.input,
      force: opts.force,
    });
  });

program
  .command("doctor")
  .description("check that required tools are installed")
  .option("--install-missing", "attempt to install missing tools", false)
  .action(async (opts) => {
    await cmdDoctor({ ...outputOptions(), dir: projectDir(), installMissing: opts.installMissing });
  });

program
  .command("scan")
  .description("discover and probe media files")
  .option("-i, --input <dir...>", "input roots", [])
  .option("--fast-hash", "use a fast non-cryptographic hash", false)
  .action(async (opts) => {
    await cmdScan({
      ...outputOptions(),
      dir: projectDir(),
      inputs: opts.input,
      fastHash: opts.fastHash,
    });
  });

program
  .command("status")
  .description("show project status")
  .action(async () => {
    await cmdStatus({ ...outputOptions(), dir: projectDir() });
  });

program
  .command("extract-text")
  .description("transcribe audio/video, OCR images, read sidecars")
  .option("--assets <id...>", "limit to asset ids")
  .option("--ocr", "run OCR on images", false)
  .option("--model <path>", "whisper model path")
  .option("--language <lang>", "transcription language")
  .option("--force", "ignore cache", false)
  .action(async (opts) => {
    await cmdExtractText({
      ...outputOptions(),
      dir: projectDir(),
      assets: opts.assets,
      ocr: opts.ocr,
      model: opts.model,
      language: opts.language,
      force: opts.force,
    });
  });

program
  .command("sample")
  .description("extract candidate frames via scene detection")
  .option("--assets <id...>", "limit to asset ids")
  .option("--threshold <n>", "scene-change threshold", parseFloat)
  .option("--rate <n>", "initial sample rate (frames per minute)", parseFloat)
  .option("--every <s>", "also sample uniformly every N seconds", parseFloat)
  .option("--max-width <px>", "max frame width", parseInt)
  .option("--force", "ignore cache", false)
  .action(async (opts) => {
    await cmdSample({
      ...outputOptions(),
      dir: projectDir(),
      assets: opts.assets,
      threshold: opts.threshold,
      rate: opts.rate,
      every: opts.every,
      maxWidth: opts.maxWidth,
      force: opts.force,
    });
  });

program
  .command("dedupe")
  .description("cluster frames by perceptual hash and select representatives")
  .option("--assets <id...>", "limit to asset ids")
  .option("--phash-distance <n>", "max hamming distance to cluster", parseInt)
  .option("--budget <n>", "max selected frames per asset", parseInt)
  .option("--total-budget <n>", "max selected frames overall", parseInt)
  .option("--force", "ignore cache", false)
  .action(async (opts) => {
    await cmdDedupe({
      ...outputOptions(),
      dir: projectDir(),
      assets: opts.assets,
      phashDistance: opts.phashDistance,
      budget: opts.budget,
      totalBudget: opts.totalBudget,
      force: opts.force,
    });
  });

program
  .command("compose <file>")
  .description("validate, explain or lint an edit script (EDL)")
  .option("--check", "validate against the EDL schema", false)
  .option("--explain", "print the resolved timeline", false)
  .option("--lint", "report errors and warnings", false)
  .action(async (file, opts) => {
    await cmdCompose({
      ...outputOptions(),
      dir: projectDir(),
      file,
      check: opts.check,
      explain: opts.explain,
      lint: opts.lint,
    });
  });

program
  .command("render [file]")
  .description("render an edit to video, or preview a single clip (--clip <id>)")
  .option("--clip <id>", "render one clip from clips.yaml to its own format (cached)")
  .option("--dry-run", "print the ffmpeg command without running", false)
  .option("--preview", "render a low-res fast preview", false)
  .option("--output <path>", "override the output path")
  .action(async (file, opts) => {
    await cmdRender({
      ...outputOptions(),
      dir: projectDir(),
      file,
      clip: opts.clip,
      dryRun: opts.dryRun,
      preview: opts.preview,
      output: opts.output,
    });
  });

program
  .command("tts <script>")
  .description("synthesise a narration voice-over from a script")
  .option("--voice <name>", "piper voice/model name or path")
  .option("--engine <engine>", "tts engine (piper)")
  .option("--output <path>", "output wav path")
  .option("--force", "ignore cache", false)
  .action(async (script, opts) => {
    await cmdTts({
      ...outputOptions(),
      dir: projectDir(),
      script,
      voice: opts.voice,
      engine: opts.engine,
      output: opts.output,
      force: opts.force,
    });
  });

program
  .command("captions")
  .description("build closed captions from narration or a transcript")
  .requiredOption("--from <source>", "narration or transcript")
  .option("--asset <id>", "asset id for transcript source")
  .option("--timing <path>", "narration timing json")
  .option("--formats <list>", "comma-separated: srt,vtt,ass", "srt,vtt")
  .option("--out <path>", "output base path (without extension)")
  .option("--width <px>", "ass PlayRes width", parseInt)
  .option("--height <px>", "ass PlayRes height", parseInt)
  .action(async (opts) => {
    await cmdCaptions({
      ...outputOptions(),
      dir: projectDir(),
      from: opts.from,
      asset: opts.asset,
      timing: opts.timing,
      formats: String(opts.formats).split(",").map((s: string) => s.trim()).filter(Boolean),
      out: opts.out,
      width: opts.width,
      height: opts.height,
    });
  });

program
  .command("models")
  .description("list or install local models (piper binary, voices)")
  .option("--install <target>", "install target: piper, voice, or all")
  .option("--voice <id>", "voice id, e.g. en_US-amy-medium")
  .option("--list", "list installed models", false)
  .option("--force", "reinstall even if present", false)
  .action(async (opts) => {
    await cmdModels({
      ...outputOptions(),
      dir: projectDir(),
      install: opts.install,
      voice: opts.voice,
      list: opts.list,
      force: opts.force,
    });
  });

program
  .command("voices [query]")
  .description("search the Piper voice catalogue")
  .action(async (query, opts) => {
    await cmdVoicesSearch(query ?? "", { ...outputOptions(), dir: projectDir() });
  });

program
  .command("annotate")
  .description("build a vision packet or ingest agent frame descriptions")
  .option("--packet-out <file>", "write a vision packet for the agent")
  .option("--ingest <file>", "merge agent vision results into the manifest")
  .option("--assets <id...>", "limit to asset ids")
  .option("--window <s>", "transcript context window around a frame", parseFloat)
  .action(async (opts) => {
    await cmdAnnotate({
      ...outputOptions(),
      dir: projectDir(),
      packetOut: opts.packetOut,
      ingest: opts.ingest,
      assets: opts.assets,
      window: opts.window,
    });
  });

program
  .command("manifest")
  .description("rebuild the manifest and optionally write a context pack")
  .option("--context-pack <file>", "write context pack (markdown + json)")
  .option("--max-chars <n>", "context pack size cap", parseInt)
  .action(async (opts) => {
    await cmdManifest({
      ...outputOptions(),
      dir: projectDir(),
      contextPack: opts.contextPack,
      maxChars: opts.maxChars,
    });
  });

program
  .command("clips")
  .description("derive, validate or edit the clips pool (clips.yaml)")
  .option("--out <file>", "output clips yaml", "clips.yaml")
  .option("--assets <id...>", "limit to asset ids")
  .option("--force", "regenerate derived clips (preserves authored)", false)
  .option("--check", "validate clips.yaml", false)
  .option("--add <json>", "add a clip (JSON)")
  .option("--set <id=json...>", "patch a clip's fields")
  .option("--rm <id...>", "remove clips by id")
  .option("--merge-gap <s>", "merge transcript beats across pauses", parseFloat)
  .option("--frame-gap <s>", "group frames within this gap", parseFloat)
  .option("--pad <s>", "pad frame clusters", parseFloat)
  .action(async (opts) => {
    await cmdClips({
      ...outputOptions(),
      dir: projectDir(),
      out: opts.out,
      assets: opts.assets,
      force: opts.force,
      check: opts.check,
      add: opts.add,
      set: opts.set,
      remove: opts.rm,
      mergeGap: opts.mergeGap,
      frameGap: opts.frameGap,
      pad: opts.pad,
    });
  });

program
  .command("script")
  .description("scaffold a narration script from annotated frames")
  .requiredOption("--out <file>", "output narration yaml")
  .option("--assets <id...>", "limit to asset ids")
  .option("--gap <s>", "gap_after per segment", parseFloat)
  .option("--voice <name>", "voice to record in the script")
  .action(async (opts) => {
    await cmdScript({
      ...outputOptions(),
      dir: projectDir(),
      out: opts.out,
      assets: opts.assets,
      gap: opts.gap,
      voice: opts.voice,
    });
  });

program
  .command("studio")
  .description("start the optional local studio server (web UI)")
  .option("--port <n>", "port to bind", parseInt)
  .option("--host <host>", "host to bind (default 127.0.0.1)", "127.0.0.1")
  .action(async (opts) => {
    // Lazily imported so the server code is never loaded for other commands.
    const { cmdStudio } = await import("./commands/studio.js");
    await cmdStudio({
      ...outputOptions(),
      dir: projectDir(),
      port: opts.port,
      host: opts.host,
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
