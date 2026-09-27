import { LitElement, html, css } from "lit";
import { base } from "./styles.js";

// Host config (index.html): { "mode": "static" } for the read-only GH Pages demo.
const CONFIG = (() => {
  try {
    return JSON.parse(document.getElementById("vided-config")?.textContent || "{}");
  } catch {
    return {};
  }
})();
const DEMO = CONFIG.mode === "static";

const readOnly = () =>
  Promise.resolve(new Response(JSON.stringify({ error: "read-only demo" }), { status: 403 }));

const api = {
  get: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  },
  post: (url, body) =>
    DEMO
      ? readOnly()
      : fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  put: (url, body) =>
    DEMO
      ? readOnly()
      : fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
};

const fmtDur = (s) => {
  if (s == null) return "–";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m + ":" + String(r).padStart(2, "0");
};
const fmtBytes = (b) => (b < 1024 ? b + " B" : b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");
const fmtSec = (s) => {
  if (s == null) return "–";
  const m = Math.floor(s / 60);
  return m + ":" + (s % 60).toFixed(1).padStart(4, "0");
};
const NICE_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const niceInterval = (seconds) => NICE_STEPS.find((n) => n >= seconds) ?? 600;

const SECTIONS = [
  ["project", "Project"],
  ["media", "Media bin"],
  ["clips", "Clips"],
  ["analysis", "Analysis"],
  ["context", "Context"],
  ["vision", "Vision"],
  ["captions", "Captions"],
  ["output", "Output"],
  ["changes", "Changes"],
  ["activity", "Activity"],
];

// Short in-UI explanations for each major panel (the "?" popups).
const HELP = {
  project: {
    title: "Project",
    body: "Status of the analyzed project: asset count, total duration, frames selected by dedupe and frames annotated by vision, plus which native tools are available. The buttons run the analysis stages end-to-end (scan → extract-text → sample → dedupe).",
  },
  media: {
    title: "Media bin",
    body: "Every asset in the project. Upload files or fetch a URL to add media (the last file triggers a scan). Click a row to inspect it in Details; the + button on a video proposes adding it to the timeline. Search filters by path.",
  },
  clips: {
    title: "Clips",
    body: "The clip pool from clips.yaml — every clip an edit can use, by kind (video/image/audio/title/slide). Click a clip to inspect/preview it; ▶ renders it at its own format (cached); + proposes adding a placement to the timeline. Trimming a clip here affects every timeline item that uses it.",
  },
  analysis: {
    title: "Analysis",
    body: "Run a single pipeline stage with explicit parameters. Pick a stage, adjust its options, then Run. Results are cached by content hash, so re-running only recomputes that step — use Changes to see what has gone stale.",
  },
  context: {
    title: "Context",
    body: "The brief and directives the agent uses to compose the edit: audience, tone, target duration, must-include/avoid lists, voice and pronunciation. Save writes context.yaml; Build context pack produces the distilled work/context.md for the agent.",
  },
  vision: {
    title: "Vision",
    body: "Annotate the frames that survived dedupe. Build packet writes a vision packet for the agent; Ingest results merges the descriptions back into the manifest. Per-asset frames and controls live in Details → Frames.",
  },
  captions: {
    title: "Captions",
    body: "The captions layer of edit.yaml. None = no captions; Soft = muxed mov_text (toggleable); Burn = rendered into the picture. Save proposes the change to edit.yaml (which you then apply). The caption file is usually work/captions.ass from `vided captions`.",
  },
  output: {
    title: "Output",
    body: "Files produced by vided render. Click a render to open it in Details: play it there and scrub it with the timeline playhead. If the latest output is missing or stale, Details offers Render to preview (use ↗ to open the file in a new tab).",
  },
  changes: {
    title: "Changes",
    body: "Stale downstream stages (an input is newer than its output) with a one-click re-run, plus the tracked artifacts and their latest writer. Studio edits are proposals until you apply them; click a row for version history, diffs and reverts.",
  },
  activity: {
    title: "Activity",
    body: "Background jobs queued by the studio. Click a row to stream its output into the technical log below.",
  },
  "detail:overview": {
    title: "Overview",
    body: "Technical metadata and a preview for the selected asset. Images can be run through OCR here; text assets show their extracted content.",
  },
  "detail:transcript": {
    title: "Transcript",
    body: "Speech-to-text segments for this asset, produced by whisper.cpp. Re-transcribe with a specific language, or leave the field blank for auto-detection.",
  },
  "detail:frames": {
    title: "Frames",
    body: "Frames sampled from this asset after dedupe. Run Sample to detect scenes, Dedupe to cluster near-duplicates, or Build packet to annotate the selected frames. A ✓ marks frames chosen for vision.",
  },
  "detail:notes": {
    title: "Notes",
    body: "Per-asset metadata stored in context.yaml: title, role, tags and free-form notes. These feed the context pack the agent reads.",
  },
  timeline: {
    title: "Timeline",
    body: "The composed EDL (edit.yaml). Click or drag the track to move the playhead (it snaps to clip edges); ←/→ step, Shift for 5s, Home/End jump, Space plays. Moving the playhead opens the latest render in Output and scrubs it; play it there and the playhead follows. Click a clip to trim, reorder or remove it. Changes appear as a diff and are only written when you Apply. Use −/+ to zoom, or fit to fill the width.",
  },
};

// Project-wide stage parameters exposed in the Analysis panel.
const STAGE_PARAMS = {
  scan: [{ n: "fast-hash", label: "fast hash", type: "bool" }],
  "extract-text": [
    { n: "language", type: "text", def: "auto" },
    { n: "ocr", label: "OCR images", type: "bool" },
    { n: "model", label: "whisper model", type: "text" },
  ],
  sample: [
    { n: "threshold", type: "number", def: 0.25, step: 0.05 },
    { n: "rate", label: "rate/min", type: "number", def: 30 },
    { n: "max-width", label: "max width", type: "number", def: 512 },
  ],
  dedupe: [
    { n: "phash-distance", label: "phash distance", type: "number", def: 6 },
    { n: "budget", label: "budget/asset", type: "number" },
    { n: "total-budget", label: "total budget", type: "number" },
  ],
  manifest: [
    { n: "context-pack", label: "context pack", type: "text", def: "work/context.md" },
    { n: "max-chars", label: "max chars", type: "number" },
  ],
  script: [{ n: "out", label: "out file", type: "text", def: "narration.yaml" }],
  tts: [
    { n: "script", type: "text", def: "narration.yaml" },
    { n: "voice", type: "text" },
  ],
  captions: [
    { n: "from", type: "select", opts: ["narration", "transcript"], def: "narration" },
    { n: "formats", type: "text", def: "srt,vtt" },
  ],
  render: [
    { n: "file", label: "edit file", type: "text", def: "edit.yaml" },
    { n: "preview", type: "bool" },
  ],
};

class VidedApp extends LitElement {
  static properties = {
    status: { state: true },
    manifest: { state: true },
    clips: { state: true },
    clipFormats: { state: true },
    clipsError: { state: true },
    context: { state: true },
    contextPack: { state: true },
    outputs: { state: true },
    jobs: { state: true },
    selection: { state: true },
    open: { state: true },
    frames: { state: true },
    log: { state: true },
    logJob: { state: true },
    search: { state: true },
    runhint: { state: true },
    fileNames: { state: true },
    detailTab: { state: true },
    analysisOp: { state: true },
    textContent: { state: true },
    edl: { state: true },
    pps: { state: true },
    playhead: { state: true },
    changes: { state: true },
    diffText: { state: true },
    stale: { state: true },
    staleNodes: { state: true },
    demoBanner: { state: true },
    proposal: { state: true },
    renderMeta: { state: true },
  };

  constructor() {
    super();
    this.status = null;
    this.manifest = null;
    this.clips = [];
    this.clipFormats = [];
    this.clipsError = null;
    this.context = null;
    this.contextPack = null;
    this.outputs = [];
    this.jobs = [];
    this.selection = { kind: "none" };
    this.open = localStorage.getItem("vided.open") || "media";
    this.frames = null;
    this.log = "";
    this.logJob = null;
    this.search = "";
    this.runhint = "";
    this.fileNames = "";
    this.detailTab = "overview";
    this.analysisOp = "sample";
    this.textContent = null;
    this.edl = null;
    this.pps = null;
    this.playhead = 0;
    this.changes = [];
    this.diffText = null;
    this.stale = null;
    this.staleNodes = [];
    this.demoBanner = localStorage.getItem("vided.demoBanner") !== "0";
    this.proposal = null;
    this.renderMeta = null;
    this._rail = Number(localStorage.getItem("vided.rail")) || 300;
    this._timeline = Number(localStorage.getItem("vided.timeline")) || 220;
    this._es = null;
  }

  demoBlocked() { this.runhint = "read-only demo"; }
  connectedCallback() {
    super.connectedCallback();
    this.style.setProperty("--rail", this._rail + "px");
    this.style.setProperty("--timeline", this._timeline + "px");
    this.refresh();
    this._timer = setInterval(() => this.loadJobs(), 5000);
    this._kd = (e) => this.onKeyDown(e);
    window.addEventListener("keydown", this._kd);
    if (DEMO) return;
    this._events = new EventSource("api/events");
    this._events.onmessage = (ev) => {
      let e;
      try { e = JSON.parse(ev.data); } catch { return; }
      if (e.type === "changed") {
        this.loadHistory();
        if (e.writer === "agent") this.stale = e.artifact;
        else this.refresh();
      }
    };
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
    if (this._kd) window.removeEventListener("keydown", this._kd);
    if (this._es) this._es.close();
    if (this._events) this._events.close();
  }

  async refresh() {
    this.loadStatus();
    this.loadManifest();
    this.loadClips();
    this.loadContext();
    this.loadContextPack();
    this.loadOutputs();
    this.loadJobs();
    this.loadEdl();
    this.loadHistory();
    this.loadStaleness();
  }

  async loadStatus() {
    try { this.status = await api.get("api/status"); } catch { this.status = null; }
  }
  async loadManifest() {
    try { this.manifest = await api.get("api/manifest"); } catch { this.manifest = null; }
  }
  async loadClips() {
    try {
      const r = await api.get("api/clips");
      this.clips = r.clips || [];
      this.clipFormats = r.formats || [];
      this.clipsError = null;
    } catch (err) {
      this.clips = [];
      this.clipsError = String((err && err.message) || err);
    }
  }
  async loadContext() {
    try { this.context = await api.get("api/context"); } catch { this.context = null; }
  }
  async loadContextPack() {
    try { this.contextPack = await api.get("api/context-pack"); } catch { this.contextPack = null; }
  }
  async loadOutputs() {
    try { this.outputs = await api.get("api/renders"); } catch { this.outputs = []; }
  }
  async loadJobs() {
    try { this.jobs = await api.get("api/jobs"); } catch { /* ignore */ }
  }
  async loadEdl() {
    try { this.edl = await api.get("api/edl"); } catch { this.edl = { empty: true }; }
  }

  async loadHistory() {
    try { this.changes = await api.get("api/changes"); } catch { this.changes = []; }
  }
  async loadStaleness() {
    try { this.staleNodes = await api.get("api/staleness"); } catch { this.staleNodes = []; }
  }
  async openHistory(artifact) {
    try {
      const h = await api.get("api/history/" + encodeURIComponent(artifact));
      this.selection = { kind: "history", id: artifact, artifact, versions: h.versions };
      this.diffText = null;
    } catch { /* ignore */ }
  }
  async diffVersion(artifact, hash) {
    const r = await api.post("api/diff", { artifact, hash });
    if (r.ok) { const j = await r.json(); this.diffText = j.diff; }
  }
  async revertVersion(artifact, hash) {
    if (DEMO) return this.demoBlocked();
    await api.post("api/revert", { artifact, hash });
    await this.openHistory(artifact);
    this.refresh();
  }

  selectTimelineItem(it) {
    const raw = this.rawItem(it.id);
    const clip = (this.clips || []).find((c) => c.id === raw.use);
    this.selection = clip
      ? { kind: "clip", id: clip.id, clip, timelineItem: it }
      : { kind: "timelineItem", id: it.id, item: it };
  }
  rawItem(id) {
    const tracks = this.edl?.edl?.tracks || {};
    return [...(tracks.visual || []), ...(tracks.audio || [])].find((t) => t.id === id) || {};
  }
  async proposeEdl(ops) {
    if (DEMO) return this.demoBlocked();
    const r = await api.post("api/edl/edit", { ops });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { this.runhint = j.error || "edit failed"; return; }
    this.proposal = { artifact: "edit.yaml", yaml: j.yaml, diff: j.diff };
  }
  async applyProposal() {
    if (DEMO) return this.demoBlocked();
    if (!this.proposal) return;
    const r = await api.post("api/apply", { artifact: this.proposal.artifact, content: this.proposal.yaml, label: "studio edit" });
    this.proposal = null;
    this.runhint = r.ok ? "applied" : "apply failed";
    this.refresh();
  }
  discardProposal() { this.proposal = null; }
  fitPps() {
    const dur = this.edl?.duration || 1;
    const view = this.renderRoot?.querySelector(".tl-scroll")?.clientWidth || 900;
    return Math.max(1, view / dur);
  }
  zoomTimeline(dir) {
    const fit = this.fitPps();
    const base = this.pps ?? fit;
    this.pps = Math.max(fit, Math.min(400, dir > 0 ? base * 1.6 : base / 1.6));
  }
  setPlayhead(t) {
    const dur = this.edl?.duration || 0;
    this.playhead = Math.max(0, Math.min(dur, Number(t.toFixed(2))));
    this.seekMaster(this.playhead);
    if (this.selection.kind !== "output") {
      const m = this.masterOutput();
      if (m) this.selectOutput(m);
    }
  }
  masterOutput() {
    if ((this.staleNodes || []).some((s) => s.op === "render")) return null;
    if (!this.outputs.length) return null;
    const base = (this.edl?.edl?.output?.path || "").split("/").pop();
    return (
      this.outputs.find((o) => o.name === base) ||
      this.outputs.slice().sort((a, b) => String(a.mtime).localeCompare(String(b.mtime))).at(-1)
    );
  }
  timeFromEvent(e, track) {
    const rect = track.getBoundingClientRect();
    const dur = this.edl?.duration || 1;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return frac * dur;
  }
  snapTime(t) {
    const dur = this.edl?.duration || 1;
    const thr = this.pps ? 6 / this.pps : dur * 0.01;
    let best = t;
    for (const it of this.edl?.clips || []) {
      for (const b of [it.start, it.end]) if (Math.abs(b - t) <= thr) best = b;
    }
    return best;
  }
  onTimelineDown(e) {
    if (e.button) return;
    const track = e.currentTarget;
    this.setPlayhead(this.snapTime(this.timeFromEvent(e, track)));
    const move = (ev) => this.setPlayhead(this.snapTime(this.timeFromEvent(ev, track)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  seekMaster(t) {
    const v = this.renderRoot?.querySelector("video.master");
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : Infinity;
    const ct = Math.min(t, d);
    if (Math.abs((v.currentTime || 0) - ct) > 0.15) {
      try { v.currentTime = ct; } catch { /* ignore */ }
    }
  }
  onMasterTime(e) {
    // The playhead scrubs the video; a paused video must not drive the playhead
    // (a freshly-loaded <video> emits timeupdate at 0, which would snap it back).
    if (e.target.paused) return;
    const t = Number((e.target.currentTime || 0).toFixed(2));
    if (t !== this.playhead) this.playhead = t;
  }
  onMasterMeta() {
    this.seekMaster(this.playhead);
  }
  onKeyDown(e) {
    const tag = e.target?.tagName || "";
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag)) return;
    const dur = this.edl?.duration || 0;
    if (!dur) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowLeft") { this.setPlayhead(this.playhead - step); e.preventDefault(); }
    else if (e.key === "ArrowRight") { this.setPlayhead(this.playhead + step); e.preventDefault(); }
    else if (e.key === "Home") { this.setPlayhead(0); e.preventDefault(); }
    else if (e.key === "End") { this.setPlayhead(dur); e.preventDefault(); }
    else if (e.key === " ") {
      const v = this.renderRoot?.querySelector("video.master");
      if (v) { if (v.paused) v.play(); else v.pause(); e.preventDefault(); }
    }
  }

  selectAsset(a) {
    this.selection = { kind: "asset", id: a.id, asset: a };
    this.detailTab = "overview";
    this.frames = null;
    this.textContent = null;
    if (a.kind === "video") this.loadFrames(a.id);
    if (a.kind === "text") this.loadText(a.id);
  }
  async loadFrames(id) {
    try { this.frames = await api.get("api/assets/" + id + "/frames"); } catch { this.frames = { frames: [] }; }
  }
  async loadText(id) {
    try { this.textContent = await (await fetch("api/media/" + id)).text(); } catch { this.textContent = "(unavailable)"; }
  }

  async runStage(op, args = []) {
    if (DEMO) return this.demoBlocked();
    this.runhint = "queued…";
    const r = await api.post("api/jobs", { op, args });
    if (!r.ok) { this.runhint = "failed"; return; }
    const job = await r.json();
    await this.loadJobs();
    this.streamJob(job.id);
  }
  streamJob(id) {
    if (DEMO) return;
    if (this._es) this._es.close();
    this.open = "activity";
    localStorage.setItem("vided.open", this.open);
    this.logJob = id;
    this.log = "";
    this.runhint = "running " + id + "…";
    const es = new EventSource("api/jobs/" + id + "/events");
    this._es = es;
    const onData = (ev) => {
      const job = JSON.parse(ev.data);
      this.log = job.logs.join("\n");
      if (["done", "failed", "cancelled"].includes(job.status)) {
        es.close(); this._es = null;
        this.runhint = job.status;
        this.refresh();
      }
    };
    es.addEventListener("log", onData);
    es.addEventListener("status", onData);
  }

  toggle(id) {
    this.open = this.open === id ? "" : id;
    localStorage.setItem("vided.open", this.open);
  }

  startRailDrag(e) {
    e.preventDefault();
    const move = (ev) => {
      const w = Math.max(200, Math.min(520, ev.clientX));
      this._rail = w;
      this.style.setProperty("--rail", w + "px");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem("vided.rail", String(this._rail));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  startTimelineDrag(e) {
    e.preventDefault();
    const move = (ev) => {
      const h = Math.max(90, Math.min(window.innerHeight - 220, window.innerHeight - ev.clientY));
      this._timeline = h;
      this.style.setProperty("--timeline", h + "px");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem("vided.timeline", String(this._timeline));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  renderSection(id) {
    if (this.open !== id) return "";
    switch (id) {
      case "project": return this.renderProject();
      case "media": return this.renderMedia();
      case "clips": return this.renderClips();
      case "analysis": return this.renderAnalysis();
      case "context": return this.renderContext();
      case "vision": return this.renderVision();
      case "captions": return this.renderCaptions();
      case "output": return this.renderOutput();
      case "changes": return this.renderChanges();
      case "activity": return this.renderActivity();
      default: return "";
    }
  }

  renderHelpButton(key, cls = "") {
    const h = HELP[key];
    if (!h) return "";
    const id = "help-" + key.replace(/[^a-z0-9]+/gi, "-");
    return html`
      <button class="helpbtn ${cls}" title="What is this?"
        aria-label=${"Help: " + h.title}
        style=${"anchor-name:--" + id}
        popovertarget=${id}
        @click=${(e) => e.stopPropagation()}>?</button>
      <div id=${id} class="help-pop" popover role="note" style=${"position-anchor:--" + id}>
        <div class="help-head"><span class="help-ico">?</span><strong>${h.title}</strong></div>
        <p>${h.body}</p>
      </div>`;
  }

  renderProject() {
    const s = this.status;
    if (!s) return html`<p class="muted">No project status.</p>`;
    const stats = [
      ["Assets", s.assets],
      ["Duration", fmtDur(s.duration_s)],
      ["Selected frames", s.unique_frames],
      ["Annotated", s.cost ? s.cost.annotated_frames : 0],
    ];
    return html`
      <div class="stats">
        ${stats.map(([k, v]) => html`<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`)}
      </div>
      <div class="tools">
        ${Object.entries(s.tools || {}).map(([n, ok]) =>
          html`<span class="badge ${ok ? "ok" : "missing"}">${n}${ok ? " ready" : " missing"}</span>`)}
      </div>
      <div class="actions">
        <button @click=${() => this.runStage("scan")}>scan</button>
        <button @click=${() => this.runStage("extract-text")}>extract-text</button>
        <button @click=${() => this.runStage("sample")}>sample</button>
        <button @click=${() => this.runStage("dedupe")}>dedupe</button>
      </div>
    `;
  }

  renderMedia() {
    const assets = this.manifest?.assets || [];
    const q = this.search.toLowerCase();
    const shown = assets.filter((a) => !q || a.path.toLowerCase().includes(q));
    return html`
      ${DEMO ? "" : html`<div class="uploader">
        <div class="row">
          <label class="filebtn">
            <input type="file" multiple @change=${this.onUpload} />
            Choose files
          </label>
          <span class="muted ellip">${this.fileNames || "no file chosen"}</span>
        </div>
        <div class="urlrow">
          <input placeholder="YouTube / URL" .value=${this._url || ""}
            @input=${(e) => (this._url = e.target.value)} />
          <button class="sm" @click=${this.downloadUrl}>get</button>
        </div>
      </div>`}
      <input placeholder="search…" .value=${this.search} @input=${(e) => (this.search = e.target.value)} />
      ${assets.length === 0
        ? html`<p class="muted">No media yet — upload and run scan.</p>`
        : html`<table class="media"><tbody>
            ${shown.map((a) => {
              const sel = a.visual?.frames?.filter((f) => f.selected).length ?? 0;
              const active = this.selection.kind === "asset" && this.selection.id === a.id;
              return html`<tr class="clickable ${active ? "active" : ""}" @click=${() => this.selectAsset(a)}>
                <td>${a.kind}</td><td class="path" title=${a.path}>${a.path}</td>
                <td class="muted">${fmtDur(a.technical?.duration_s)}</td>
                <td class="muted">${sel ? sel + "f" : ""}</td>
                <td>${a.kind === "video"
                  ? html`<button class="sm secondary" title="add to timeline"
                      @click=${(e) => { e.stopPropagation(); this.addClip(a); }}>+</button>`
                  : ""}</td>
              </tr>`;
            })}
          </tbody></table>`}
    `;
  }

  renderClips() {
    const clips = this.clips || [];
    if (!clips.length) {
      return this.clipsError
        ? html`<p class="muted">Failed to load clips: ${this.clipsError}</p>`
        : html`<p class="muted">No clips yet — run the clips stage (Changes → run, or \`vided clips\`).</p>`;
    }
    const kinds = ["video", "image", "audio", "title", "slide"];
    return html`
      ${kinds.map((k) => {
        const list = clips.filter((c) => c.kind === k);
        if (!list.length) return "";
        return html`
          <div class="grouphead">${k} · ${list.length}</div>
          <table class="clips"><tbody>
            ${list.map((c) => {
              const active = this.selection.kind === "clip" && this.selection.id === c.id;
              const ctx = [c.tags && c.tags.length ? c.tags.join(" ") : "", c.note || ""].filter(Boolean).join(" — ");
              return html`<tr class="clickable ${active ? "active" : ""}" @click=${() => this.selectClip(c)}>
                <td class="path" title=${c.note || c.id}>
                  <div>${this.clipLabel(c)}</div>
                  ${ctx ? html`<div class="clipctx muted">${ctx}</div>` : ""}
                </td>
                <td class="muted">${c.format}</td>
                <td><button class="sm secondary" title="preview"
                  @click=${(e) => { e.stopPropagation(); this.selectClip(c); }}>▶</button></td>
                <td><button class="sm secondary" title=${c.kind === "audio" ? "add to audio track" : "add to timeline"}
                  @click=${(e) => { e.stopPropagation(); this.addPlacement(c); }}>+</button></td>
              </tr>`;
            })}
          </tbody></table>`;
      })}`;
  }
  clipLabel(c) {
    const base = (c.source || "").split(/[\/\\]/).pop() || c.source;
    if (c.kind === "title") return c.title;
    if (c.kind === "slide") return c.heading;
    if (c.kind === "audio") return base + (c.out !== undefined ? ` [${c.in}–${c.out}]` : "");
    if (c.kind === "image") return base + (c.duration ? ` ${c.duration}s` : "");
    return base + ` [${c.in}–${c.out}]`;
  }
  selectClip(c) {
    this.selection = { kind: "clip", id: c.id, clip: c };
  }
  assetFor(source) {
    return (this.manifest?.assets || []).find((a) => a.id === source || a.path === source);
  }
  // A still frame for a video source, nearest the given time. Used for the
  // read-only demo, where source video / clip renders aren't bundled.
  frameUrlFor(source, t = 0) {
    const a = this.assetFor(source);
    if (!a || a.kind !== "video") return null;
    const frames = a.visual?.frames || [];
    if (!frames.length) return null;
    const pool = frames.filter((f) => f.selected).length ? frames.filter((f) => f.selected) : frames;
    const best = pool.reduce((p, f) => (Math.abs(f.t - t) < Math.abs(p.t - t) ? f : p), pool[0]);
    return "api/frames/" + a.id + "/" + best.path.split("/").pop();
  }
  demoClipPreview(c) {
    const wrap = (inner) => html`<div class="preview">${inner}</div>`;
    if (c.kind === "video") {
      const u = this.frameUrlFor(c.source, c.poster ?? c.in ?? 0);
      return u ? wrap(html`<img src=${u} alt=${c.source} />`) : wrap(html`<div class="muted" style="padding:16px">No frame available.</div>`);
    }
    if (c.kind === "image") {
      const a = this.assetFor(c.source);
      return wrap(html`<img src=${"api/media/" + (a ? a.id : c.source)} alt=${c.source} />`);
    }
    if (c.kind === "audio") {
      return wrap(html`<div class="muted" style="padding:16px">🎧 audio</div>`);
    }
    const bg = (c.background || "#101820");
    const title = c.kind === "title" ? c.title : c.heading;
    const body = c.kind === "title" ? c.subtitle : c.body;
    return wrap(html`<div class="tl-card" style=${"background:" + bg}>
      <div class="t">${title}</div>
      ${body ? html`<div class=${c.kind === "slide" && c.variant === "mono" ? "b" : "s"}>${body}</div>` : ""}
    </div>`);
  }
  addPlacement(c) {
    this.proposeEdl([{ op: "add", track: c.kind === "audio" ? "audio" : "visual", use: c.id }]);
  }
  async proposeClipEdit(ops) {
    if (DEMO) return this.demoBlocked();
    const r = await api.post("api/clips/edit", { ops });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { this.runhint = j.error || "clip edit failed"; return; }
    this.proposal = { artifact: "clips.yaml", yaml: j.yaml, diff: j.diff };
  }
  renderClipDetail(c, item = null) {
    const asset = (this.manifest?.assets || []).find((a) => a.path === c.source);
    const meta = (this.context?.assets && (this.context.assets[c.source] || (asset && this.context.assets[asset.id]))) || {};
    const fields = [];
    const f = (k, v) => fields.push({ k, v });
    const edit = (k, id, type, value, step, options) => fields.push({ k, edit: { id, type, value, step, options } });

    f("Kind", c.kind);
    f("Source", c.source);
    const formats = this.clipFormats?.length ? this.clipFormats : [c.format];
    edit("Format", "f_format", "select", c.format, undefined, formats);
    if (asset) {
      const t = asset.technical || {};
      const v = t.video;
      const a = t.audio;
      const vp = v ? [v.width && v.height ? `${v.width}×${v.height}` : null, v.fps ? `${Math.round(v.fps)} fps` : null, v.codec, v.bitrate ? `${Math.round(v.bitrate / 1000)} kbps` : null].filter(Boolean).join(" · ") : "";
      const ap = a ? [a.codec, a.sample_rate ? `${a.sample_rate} Hz` : null, a.channels ? `${a.channels} ch` : null].filter(Boolean).join(" · ") : "";
      const sfmt = [vp, ap].filter(Boolean).join("  |  ");
      if (sfmt) f("Source format", sfmt);
    }
    f("Origin", c.origin);
    if (c.kind === "video") {
      edit("In (s)", "f_in", "number", c.in, 0.1);
      edit("Out (s)", "f_out", "number", c.out, 0.1);
      edit("Muted", "f_muted", "checkbox", c.muted);
    } else if (c.kind === "audio") {
      edit("In (s)", "f_in", "number", c.in, 0.1);
      edit("Out (s)", "f_out", "number", c.out ?? "", 0.1);
      edit("Gain (dB)", "f_gain", "number", c.gain_db ?? 0, 1);
    } else if (c.kind === "image") {
      edit("Duration (s)", "f_duration", "number", c.duration, 0.1);
      f("Fit", c.fit);
      if (c.zoom) f("Zoom", `${c.zoom.w}×${c.zoom.h} @ ${c.zoom.x},${c.zoom.y}`);
    } else if (c.kind === "title") {
      f("Title", c.title);
      if (c.subtitle) f("Subtitle", c.subtitle);
      edit("Duration (s)", "f_duration", "number", c.duration, 0.1);
    } else if (c.kind === "slide") {
      f("Heading", c.heading);
      if (c.body) f("Body", c.body);
      edit("Duration (s)", "f_duration", "number", c.duration, 0.1);
    }
    if (c.tags && c.tags.length) f("Tags", c.tags.join(", "));
    edit("Note", "f_note", "textarea", c.note || "");
    if (meta.title || asset?.title) f("Asset title", meta.title || asset?.title);
    if (meta.role || asset?.role) f("Asset role", meta.role || asset?.role);
    if (meta.notes || asset?.notes) f("Asset notes", meta.notes || asset?.notes);
    f("Id", c.id);

    const readClipPatch = () => {
      const g = (id) => this.renderRoot.getElementById(id);
      const noteEl = g("f_note");
      const base = { format: g("f_format").value, ...(noteEl ? { note: noteEl.value } : {}) };
      if (c.kind === "video") {
        return { ...base, in: Number(g("f_in").value), out: Number(g("f_out").value), muted: g("f_muted").checked };
      }
      if (c.kind === "audio") {
        const o = g("f_out").value;
        return { ...base, in: Number(g("f_in").value), out: o === "" ? undefined : Number(o), gain_db: Number(g("f_gain").value) };
      }
      return { ...base, duration: Number(g("f_duration").value) };
    };

    const src = "api/clips/preview?id=" + encodeURIComponent(c.id);
    const preview = c.kind === "audio"
      ? html`<audio controls preload="metadata" src=${src}></audio>`
      : html`<video controls preload="metadata" src=${src}></video>`;
    return html`
      <div class="detail-head">
        <div><span class="pill">${c.kind}</span> <strong>${this.clipLabel(c)}</strong></div>
        <div class="row">
          <button class="primary" @click=${() => this.addPlacement(c)}>add to timeline</button>
          <button class="secondary" @click=${() => this.proposeClipEdit([{ op: "rm", id: c.id }])}>remove clip</button>
        </div>
      </div>
      <div class="detail-body">
        <div class="info-grid">
          ${DEMO
            ? this.demoClipPreview(c)
            : (c.source === "generated" ? "" : html`<div class="preview">${preview}</div>`)}
          <div class="clip-side">
            ${item
              ? html`<div class="block">
                  <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">Placement · ${item.id}</div>
                  <div class="row">
                    ${item.kind === "audio"
                      ? html`<div><label>offset (s)</label><input id="p_offset" type="number" step="0.1" value=${this.rawItem(item.id).offset ?? 0} /></div>
                             <div><label>gain (dB)</label><input id="p_gain" type="number" step="1" value=${this.rawItem(item.id).gain_db ?? c.gain_db ?? 0} /></div>`
                      : html`<div><label>speed</label><input id="p_speed" type="number" step="0.1" value=${this.rawItem(item.id).speed ?? 1} /></div>`}
                  </div>
                  <div class="actions">
                    <button class="sm secondary" title="move earlier" @click=${() => this.proposeEdl([{ op: "reorder", id: item.id, delta: -1 }])}>◀</button>
                    <button class="sm secondary" title="move later" @click=${() => this.proposeEdl([{ op: "reorder", id: item.id, delta: 1 }])}>▶</button>
                    <button class="sm secondary" @click=${() => this.proposeEdl([{ op: "remove", id: item.id }])}>remove from timeline</button>
                    <button class="primary" @click=${() => {
                      const q = (id) => Number(this.renderRoot.getElementById(id).value);
                      this.proposeEdl([item.kind === "audio"
                        ? { op: "set", id: item.id, patch: { offset: q("p_offset"), gain_db: q("p_gain") } }
                        : { op: "set", id: item.id, patch: { speed: q("p_speed") } }]);
                    }}>Review change</button>
                  </div>
                </div>`
              : ""}
            <div class="fields">
              ${fields.map((x) => html`
                <div class="fk">${x.k}</div>
                <div class="fv">${x.edit
                  ? x.edit.type === "checkbox"
                    ? html`<input id=${x.edit.id} type="checkbox" ?checked=${x.edit.value} />`
                    : x.edit.type === "textarea"
                      ? html`<textarea id=${x.edit.id} rows="3">${x.edit.value}</textarea>`
                      : x.edit.type === "select"
                        ? html`<select id=${x.edit.id}>
                            ${(x.edit.options || []).map((o) => html`<option value=${o} ?selected=${o === x.edit.value}>${o}</option>`)}
                          </select>`
                        : html`<input id=${x.edit.id} type=${x.edit.type} step=${x.edit.step ?? "any"} value=${x.edit.value} />`
                  : x.v}</div>`)}
            </div>
            <div class="actions">
              <button class="primary" @click=${() => this.proposeClipEdit([{ op: "set", id: c.id, patch: readClipPatch() }])}>Update clip</button>
              <span class="muted">applies to every use of this clip</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  async onUpload(e) {
    if (DEMO) return this.demoBlocked();
    const files = e.target.files;
    if (!files || !files.length) return;
    this.fileNames = files.length === 1 ? files[0].name : files.length + " files";
    let i = 0;
    for (const f of files) {
      i++;
      this.runhint = `uploading ${i}/${files.length}…`;
      await fetch("api/uploads?name=" + encodeURIComponent(f.name) + "&scan=" + (i === files.length ? "1" : "0"), {
        method: "POST",
        body: f,
      });
    }
    this.runhint = "uploaded";
    this.refresh();
  }
  async downloadUrl() {
    if (DEMO) return this.demoBlocked();
    if (!this._url) return;
    const r = await api.post("api/uploads/url", { url: this._url });
    if (!r.ok) { this.runhint = "download failed"; return; }
    const job = await r.json();
    await this.loadJobs();
    this.streamJob(job.id);
  }

  addClip(a) {
    const clip = (this.clips || []).find(
      (c) => c.source === a.path && (c.kind === "video" || c.kind === "image"),
    );
    if (clip) {
      this.addPlacement(clip);
      return;
    }
    const out = Math.min(5, Math.round(a.technical?.duration_s ?? 5)) || 1;
    this.proposeClipEdit([
      { op: "add", clip: { id: "clip-" + a.id.slice(0, 8), kind: "video", source: a.path, format: "1080p30", in: 0, out } },
    ]);
    this.runhint = "clip created — add it from the Clips panel";
  }

  renderAnalysis() {
    const ops = Object.keys(STAGE_PARAMS);
    const params = STAGE_PARAMS[this.analysisOp] || [];
    return html`
      <label>Stage</label>
      <select @change=${(e) => (this.analysisOp = e.target.value)}>
        ${ops.map((o) => html`<option value=${o} ?selected=${o === this.analysisOp}>${o}</option>`)}
      </select>
      <div class="params">
        ${params.map((p) => this.renderParam(this.analysisOp, p))}
      </div>
      <div class="actions">
        <button class="primary" @click=${() => this.runAnalysis()}>Run</button>
        <span class="muted">${this.runhint}</span>
      </div>
    `;
  }
  renderParam(op, p) {
    const id = "s_" + op + "_" + p.n;
    if (p.type === "bool") {
      return html`<label class="inline"><input id=${id} type="checkbox" ?checked=${p.def === true} /> ${p.label || p.n}</label>`;
    }
    if (p.type === "select") {
      return html`<label>${p.label || p.n}</label><select id=${id}>
        ${p.opts.map((o) => html`<option ?selected=${o === p.def}>${o}</option>`)}</select>`;
    }
    return html`<label>${p.label || p.n}</label>
      <input id=${id} type=${p.type === "number" ? "number" : "text"} step=${p.step ?? "any"} value=${p.def ?? ""} />`;
  }
  runAnalysis() {
    if (DEMO) return this.demoBlocked();
    const op = this.analysisOp;
    const args = [];
    for (const p of STAGE_PARAMS[op] || []) {
      const el = this.renderRoot.getElementById("s_" + op + "_" + p.n);
      if (!el) continue;
      if (p.type === "bool") { if (el.checked) args.push("--" + p.n); }
      else if (el.value !== "" && el.value != null) args.push("--" + p.n, el.value);
    }
    this.runStage(op, args);
  }

  renderVision() {
    const s = this.status?.cost;
    return html`
      <div class="stats">
        <div class="stat"><div class="v">${s ? s.selected_frames : 0}</div><div class="k">selected frames</div></div>
        <div class="stat"><div class="v">${s ? s.annotated_frames : 0}</div><div class="k">annotated</div></div>
      </div>
      <div class="actions">
        <button @click=${() => this.runStage("annotate", ["--packet-out", "work/vision.packet.json"])}>Build packet</button>
        <button @click=${() => this.runStage("annotate", ["--ingest", "work/vision.results.json"])}>Ingest results</button>
      </div>
      <p class="muted">Describe the selected frames (agent), then ingest the results to merge descriptions into the manifest. Frames are per-asset in the Details → Frames tab.</p>
    `;
  }

  renderCaptions() {
    const cap = this.edl?.edl?.captions || {};
    if (!this.edl?.edl) return html`<p class="muted">No edit.yaml yet.</p>`;
    const mode = cap.mode || "none";
    const exps = cap.export || [];
    return html`
      <label>Mode</label>
      <select id="cap_mode">
        ${["none", "soft", "burn"].map((m) => html`<option value=${m} ?selected=${m === mode}>${m}</option>`)}
      </select>
      <label>Caption file (.ass for burn)</label>
      <input id="cap_file" .value=${cap.file || ""} placeholder="work/captions.ass" />
      <label>Export on render</label>
      <div class="row">
        ${["srt", "vtt", "ass"].map((v) =>
          html`<label class="inline"><input type="checkbox" id=${"cap_ex_" + v} ?checked=${exps.includes(v)} /> ${v}</label>`)}
      </div>
      <div class="actions">
        <button class="primary" @click=${this.saveCaptions}>Save</button>
        <span class="muted">${this.runhint}</span>
      </div>
      <p class="muted">Save proposes a change to edit.yaml; you then apply it.</p>
    `;
  }
  saveCaptions() {
    const g = (id) => this.renderRoot.getElementById(id);
    const file = g("cap_file").value;
    const patch = {
      mode: g("cap_mode").value,
      export: ["srt", "vtt", "ass"].filter((v) => g("cap_ex_" + v).checked),
      ...(file ? { file } : {}),
    };
    this.proposeEdl([{ op: "set-captions", patch }]);
  }

  renderContext() {
    const c = this.context;
    if (!c) return html`<p class="muted">No context.</p>`;
    const pron = Object.entries(c.pronunciation || {}).map(([k, v]) => k + ": " + v).join("\n");
    return html`
      <label>Brief <span class="muted">(brief.md)</span></label>
      <textarea id="cx_brief" rows="4">${c.brief || ""}</textarea>
      <label>Audience</label><input id="cx_audience" .value=${c.audience || ""} />
      <label>Tone</label><input id="cx_tone" .value=${c.tone || ""} />
      <label>Target duration (s)</label><input id="cx_target" type="number" .value=${c.target_duration_s || ""} />
      <label>Must include (comma)</label><input id="cx_must" .value=${(c.must_include || []).join(", ")} />
      <label>Avoid (comma)</label><input id="cx_avoid" .value=${(c.avoid || []).join(", ")} />
      <div class="row">
        <div style="flex:1"><label>Voice</label><input id="cx_voice" .value=${c.voice || ""} /></div>
        <div style="flex:1"><label>Language</label><input id="cx_lang" .value=${c.language || ""} /></div>
      </div>
      <label>Pronunciation (word: say, one per line)</label>
      <textarea id="cx_pron" rows="3">${pron}</textarea>
      <div class="actions">
        <button class="primary" @click=${this.saveContext}>Save</button>
        <button @click=${() => this.runStage("manifest", ["--context-pack", "work/context.md"])}>Build context pack</button>
        <span class="muted">${this.runhint}</span>
      </div>
      <div class="grouphead">Generated context pack</div>
      ${this.contextPack?.exists
        ? html`<details class="logbox" open>
            <summary>${this.contextPack.file} · ${this.contextPack.chars} chars (what the agent reads)</summary>
            <pre class="textbox">${this.contextPack.markdown}</pre>
          </details>`
        : html`<p class="muted">Not built yet — click <b>Build context pack</b>.</p>`}
    `;
  }
  async saveContext() {
    if (DEMO) return this.demoBlocked();
    const q = (id) => this.renderRoot.getElementById(id);
    const pronunciation = {};
    for (const line of q("cx_pron").value.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) pronunciation[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const body = {
      brief: q("cx_brief").value || undefined,
      audience: q("cx_audience").value || undefined,
      tone: q("cx_tone").value || undefined,
      target_duration_s: q("cx_target").value ? Number(q("cx_target").value) : undefined,
      must_include: q("cx_must").value.split(",").map((s) => s.trim()).filter(Boolean),
      avoid: q("cx_avoid").value.split(",").map((s) => s.trim()).filter(Boolean),
      voice: q("cx_voice").value || undefined,
      language: q("cx_lang").value || undefined,
      pronunciation,
    };
    const r = await api.put("api/context", body);
    this.runhint = r.ok ? "brief.md + context.yaml saved" : "context save failed";
    await this.loadContext();
  }

  renderChanges() {
    const stale = this.staleNodes || [];
    return html`
      ${stale.length
        ? html`
          <div class="muted" style="margin-bottom:6px">Stale downstream</div>
          <table><tbody>
            ${stale.map((s) => html`<tr>
              <td>${s.label}
                <div class="muted" style="font-size:11px">${s.output} · newer: ${s.staleInputs.join(", ")}</div>
              </td>
              <td class="row" style="justify-content:flex-end">
                <button class="sm" @click=${() => this.runStage(s.op, s.args)}>re-run</button>
              </td>
            </tr>`)}
          </tbody></table>`
        : ""}
      <div class="muted" style="margin:10px 0 6px">Tracked artifacts</div>
      ${!this.changes.length
        ? html`<p class="muted">No tracked artifacts yet.</p>`
        : html`<table><tbody>
            ${this.changes.map((c) => html`<tr class="clickable" @click=${() => this.openHistory(c.artifact)}>
              <td>${c.artifact}</td>
              <td><span class="pill ${c.writer === "studio" ? "done" : "cancelled"}">${c.writer}</span></td>
              <td class="muted">${new Date(c.ts).toLocaleTimeString()}</td>
            </tr>`)}
          </tbody></table>`}
    `;
  }

  renderHistory() {
    const sel = this.selection;
    return html`
      <div class="detail-head">
        <div><span class="pill">history</span> <strong>${sel.artifact}</strong></div>
        <div class="muted">${sel.versions.length} versions</div>
      </div>
      <div class="detail-body">
        <table><tbody>
          ${sel.versions.slice().reverse().map((v) => html`<tr>
            <td><span class="pill ${v.writer === "studio" ? "done" : "cancelled"}">${v.writer}</span></td>
            <td class="muted">${new Date(v.ts).toLocaleString()}</td>
            <td>${v.label || ""}</td>
            <td class="muted mono">${v.hash}</td>
            <td class="row" style="justify-content: flex-end">
              <button class="sm secondary" @click=${() => this.diffVersion(sel.artifact, v.hash)}>diff</button>
              <button class="sm" @click=${() => this.revertVersion(sel.artifact, v.hash)}>revert</button>
            </td>
          </tr>`)}
        </tbody></table>
        ${this.diffText ? html`<pre class="textbox">${this.diffText}</pre>` : ""}
      </div>`;
  }

  renderOutput() {
    if (!this.outputs.length) {
      return html`<p class="muted">No renders yet.
        <button class="sm" @click=${() => this.runStage("render", ["edit.yaml"])}>Render to preview</button>
      </p>`;
    }
    return html`<table><tbody>
      ${this.outputs.map((f) => {
        const active = this.selection.kind === "output" && this.selection.id === f.name;
        return html`<tr class="clickable ${active ? "active" : ""}" @click=${() => this.selectOutput(f)}>
          <td class="path" title=${f.name}>${f.name}</td>
          <td class="muted">${fmtBytes(f.bytes)}</td>
          <td><a href=${"api/outputs/" + encodeURIComponent(f.name)} target="_blank" title="open in new tab"
            @click=${(e) => e.stopPropagation()}>↗</a></td>
        </tr>`;
      })}
    </tbody></table>`;
  }
  selectOutput(f) {
    this.selection = { kind: "output", id: f.name, output: f };
    this.renderMeta = null;
    api.get("api/render-info/" + encodeURIComponent(f.name))
      .then((r) => { if (this.selection.kind === "output" && this.selection.id === f.name) this.renderMeta = r; })
      .catch(() => { this.renderMeta = {}; });
    this.updateComplete?.then(() => this.seekMaster(this.playhead));
  }

  renderOutputDetail(o) {
    const info = this.renderMeta || {};
    const v = info.video || {};
    const a = info.audio || {};
    const src = "api/outputs/" + encodeURIComponent(o.name);
    const stale = (this.staleNodes || []).some((s) => s.op === "render");
    const rows = [
      ["Name", o.name],
      ["Size", fmtBytes(o.bytes)],
      ["Modified", new Date(o.mtime).toLocaleString()],
      ...(Number.isFinite(info.duration_s) ? [["Duration", fmtDur(info.duration_s)]] : []),
      ...(v.width ? [["Video", [v.width + "×" + v.height, v.fps ? Math.round(v.fps) + " fps" : null, v.codec].filter(Boolean).join(" · ")]] : []),
      ...(a.codec ? [["Audio", [a.codec, a.sample_rate ? a.sample_rate + " Hz" : null, a.channels ? a.channels + " ch" : null].filter(Boolean).join(" · ")]] : []),
    ];
    const kv = html`<div class="kv">
      ${rows.map(([k, val]) => html`<div class="k">${k}</div><div class="v">${val}</div>`)}
    </div>`;
    if (!this.renderMeta) {
      return html`<div class="detail-head"><div><span class="pill">output</span> <strong>${o.name}</strong></div></div>
        <div class="detail-body"><p class="muted">Loading…</p></div>`;
    }
    if (stale) {
      return html`
        <div class="detail-head">
          <div><span class="pill">output</span> <strong>${o.name}</strong></div>
          <div class="row">
            <button class="primary" @click=${() => this.runStage("render", ["edit.yaml"])}>Render to preview</button>
            <a href=${src} target="_blank">open ↗</a>
          </div>
        </div>
        <div class="detail-body">
          <p class="muted">This output is stale — re-render to preview and scrub it.</p>
          ${kv}
        </div>`;
    }
    return html`
      <div class="detail-head">
        <div><span class="pill">output</span> <strong>${o.name}</strong></div>
        <div class="row"><a href=${src} target="_blank">open ↗</a></div>
      </div>
      <div class="detail-body">
        <div class="info-grid">
          <div class="preview"><video class="master" controls preload="metadata" src=${src} @loadedmetadata=${this.onMasterMeta} @timeupdate=${this.onMasterTime}></video></div>
          <div class="clip-side">${kv}</div>
        </div>
        <p class="muted">Move the red playhead on the timeline to scrub this render; play it and the playhead follows.</p>
      </div>`;
  }

  renderActivity() {
    return html`
      ${this.jobs.length === 0 ? html`<p class="muted">No jobs yet.</p>` : html`
        <table><tbody>
          ${this.jobs.slice().reverse().map((j) => html`<tr class="clickable" @click=${() => this.streamJob(j.id)}>
            <td>${j.op}${j.args.length ? " " + j.args.join(" ") : ""}</td>
            <td><span class="pill ${j.status}">${j.status}</span></td>
          </tr>`)}
        </tbody></table>`}
      <details class="logbox">
        <summary>technical log ${this.logJob ? "· " + this.logJob : ""}</summary>
        <pre>${this.log}</pre>
      </details>
    `;
  }

  tabsFor(kind) {
    const tabs = [["overview", "Overview"]];
    if (kind === "video" || kind === "audio") tabs.push(["transcript", "Transcript"]);
    if (kind === "video") tabs.push(["frames", "Frames"]);
    tabs.push(["notes", "Notes"]);
    return tabs;
  }

  renderDetails() {
    const sel = this.selection;
    if (this.proposal) return this.renderProposal();
    if (sel.kind === "history") return this.renderHistory();
    if (sel.kind === "output") return this.renderOutputDetail(sel.output);
    if (sel.kind === "clip") return this.renderClipDetail(sel.clip, sel.timelineItem);
    if (sel.kind === "timelineItem") return this.renderTimelineItem(sel.item);
    if (sel.kind !== "asset") {
      return html`<div class="empty">
        <div>Select an item</div>
        <div class="muted">Pick an asset in the Media bin, or an item on the timeline.</div>
      </div>`;
    }
    const a = sel.asset;
    const tabs = this.tabsFor(a.kind);
    const active = tabs.some(([id]) => id === this.detailTab) ? this.detailTab : "overview";
    return html`
      <div class="detail-head">
        <div><span class="pill">${a.kind}</span> <strong>${a.path}</strong></div>
        <div class="muted">${fmtDur(a.technical?.duration_s)} · ${a.status}</div>
      </div>
      <div class="tabs">
        ${tabs.map(([id, label]) =>
          html`<button class="tab ${active === id ? "active" : ""}" @click=${() => (this.detailTab = id)}>${label}</button>`)}
        <span class="spacer"></span>
        ${this.renderHelpButton("detail:" + active, "tabs-help")}
      </div>
      <div class="detail-body">
        ${active === "overview" ? this.renderInfo(a)
          : active === "transcript" ? this.renderTranscript(a)
          : active === "frames" ? this.renderFrames(a)
          : this.renderNotes(a)}
      </div>
    `;
  }

  renderPreview(a) {
    if (DEMO) {
      if (a.kind === "video") {
        const u = this.frameUrlFor(a.id, 0);
        return u ? html`<img src=${u} alt=${a.path} />` : html`<div class="muted" style="padding:16px">No frame available.</div>`;
      }
      if (a.kind === "image") return html`<img src=${"api/media/" + a.id} alt=${a.path} />`;
      return html`<div class="muted" style="padding:16px">No preview for ${a.kind}.</div>`;
    }
    if (a.kind === "video" || a.kind === "audio") return html`<video controls preload="metadata" src=${"api/media/" + a.id}></video>`;
    if (a.kind === "image") return html`<img src=${"api/media/" + a.id} alt=${a.path} />`;
    return html`<div class="muted" style="padding:16px">No preview for ${a.kind}.</div>`;
  }

  renderInfo(a) {
    const t = a.technical || {};
    const v = t.video;
    const au = t.audio;
    const rows = [
      ["Kind", a.kind],
      ["Path", a.path],
      ["Status", a.status],
      ["Duration", fmtDur(t.duration_s)],
      ["Size", a.bytes != null ? fmtBytes(a.bytes) : "–"],
      ["Container", t.container || "–"],
    ];
    if (v) rows.push(["Video", [v.codec, v.width && v.height ? v.width + "×" + v.height : null, v.fps ? v.fps + " fps" : null, v.bitrate ? Math.round(v.bitrate / 1000) + " kbps" : null].filter(Boolean).join(" · ")]);
    if (au) rows.push(["Audio", [au.codec, au.sample_rate ? au.sample_rate + " Hz" : null, au.channels ? au.channels + " ch" : null].filter(Boolean).join(" · ")]);
    if (t.creation_time) rows.push(["Created", t.creation_time]);
    rows.push(["Hash", a.content_hash ? a.content_hash.slice(0, 19) + "…" : "–"]);
    const preview = a.kind === "text"
      ? html`<pre class="textbox">${this.textContent ?? "(loading…)"}</pre>`
      : html`<div class="preview">${this.renderPreview(a)}</div>`;
    const ocr = a.kind === "image" ? html`
      <div class="block">
        <div class="row"><strong>Extracted text</strong>
          <button class="secondary" @click=${() => this.runAssetStage(a, "extract-text", ["--ocr"])}>Run OCR</button>
          <span class="muted">${this.runhint}</span>
        </div>
        ${a.extracted?.ocr ? html`<pre class="textbox">${a.extracted.ocr}</pre>` : html`<p class="muted">No OCR text yet.</p>`}
      </div>` : "";
    return html`
      <div class="info-grid">
        ${preview}
        <div class="kv">${rows.map(([k, val]) => html`<div class="k">${k}</div><div class="v">${val}</div>`)}</div>
      </div>
      ${ocr}
    `;
  }

  renderTranscript(a) {
    const tr = a.extracted?.transcript;
    const segs = tr?.segments || [];
    return html`
      <div class="actions">
        <input id="t_lang" placeholder="language (auto)" style="width: 140px" />
        <button class="primary" @click=${() => {
          const lang = this.renderRoot.getElementById("t_lang").value;
          this.runAssetStage(a, "extract-text", lang ? ["--language", lang] : []);
        }}>${segs.length ? "Re-transcribe" : "Transcribe"}</button>
        <span class="muted">${this.runhint}</span>
      </div>
      ${segs.length ? html`
        <div class="muted" style="margin: 10px 0 8px">
          ${tr.tool}${a.extracted.language ? " · " + a.extracted.language : ""} · ${segs.length} segments
        </div>
        <div class="segments">
          ${segs.map((s) => html`<div class="seg"><span class="t">${fmtDur(s.start)}</span><span>${s.text}</span></div>`)}
        </div>
      ` : html`<p class="muted">No transcript yet.</p>`}
    `;
  }

  renderFrames(a) {
    const gallery = !this.frames
      ? html`<p class="muted">loading…</p>`
      : !this.frames.frames.length
        ? html`<p class="muted">No frames yet — run Sample.</p>`
        : html`<div class="gallery">
            ${this.frames.frames.map((f) => html`<div class="frame">
              <img loading="lazy" src=${f.url} alt=${"t=" + f.t} />
              <div class="cap"><span>t=${f.t}${f.selected ? " ✓" : ""}</span>
                ${f.description ? html`<span class="muted">${f.description}</span>` : ""}</div>
            </div>`)}
          </div>`;
    return html`
      <div class="actions">
        <label class="inline">threshold <input id="f_thr" type="number" step="0.05" value="0.25" style="width: 70px" /></label>
        <label class="inline">rate/min <input id="f_rate" type="number" value="30" style="width: 70px" /></label>
        <button @click=${() => this.runAssetStage(a, "sample", ["--threshold", this.renderRoot.getElementById("f_thr").value, "--rate", this.renderRoot.getElementById("f_rate").value])}>Sample</button>
        <label class="inline">phash <input id="f_dist" type="number" value="6" style="width: 60px" /></label>
        <label class="inline">budget <input id="f_budget" type="number" style="width: 60px" /></label>
        <button @click=${() => this.runAssetStage(a, "dedupe", [
          "--phash-distance", this.renderRoot.getElementById("f_dist").value,
          ...(this.renderRoot.getElementById("f_budget").value ? ["--budget", this.renderRoot.getElementById("f_budget").value] : []),
        ])}>Dedupe</button>
        <button class="secondary" @click=${() => this.runAssetStage(a, "annotate", ["--packet-out", "work/" + a.id + ".packet.json"])}>Build packet</button>
      </div>
      ${gallery}
    `;
  }

  assetMeta(a) {
    return (this.context?.assets && (this.context.assets[a.id] || this.context.assets[a.path])) || {};
  }

  renderNotes(a) {
    const m = this.assetMeta(a);
    return html`
      <div class="form">
        <label>Title</label><input id="n_title" .value=${m.title || ""} />
        <label>Role</label><input id="n_role" .value=${m.role || ""} placeholder="intro / b-roll / outro…" />
        <label>Tags (comma separated)</label><input id="n_tags" .value=${(m.tags || []).join(", ")} />
        <label>Notes</label><textarea id="n_notes" rows="4">${m.notes || ""}</textarea>
        <div class="actions"><button class="primary" @click=${() => this.saveNotes(a)}>Save</button><span class="muted">${this.runhint}</span></div>
      </div>
    `;
  }
  async saveNotes(a) {
    if (DEMO) return this.demoBlocked();
    const q = (id) => this.renderRoot.getElementById(id);
    const body = {
      title: q("n_title").value || undefined,
      role: q("n_role").value || undefined,
      tags: q("n_tags").value.split(",").map((s) => s.trim()).filter(Boolean),
      notes: q("n_notes").value || undefined,
    };
    const r = await api.put("api/context/assets/" + encodeURIComponent(a.id), body);
    this.runhint = r.ok ? "saved" : "save failed";
    await this.loadContext();
  }

  async runAssetStage(a, op, extraArgs) {
    if (DEMO) return this.demoBlocked();
    await this.runStage(op, ["--assets", a.id, ...extraArgs]);
    this.loadJobs();
  }

  renderProposal() {
    const p = this.proposal;
    return html`
      <div class="detail-head">
        <div><span class="pill running">proposal</span> <strong>${p.artifact}</strong></div>
        <div class="row">
          <button class="secondary" @click=${() => this.discardProposal()}>discard</button>
          <button class="primary" @click=${() => this.applyProposal()}>apply</button>
        </div>
      </div>
      <div class="detail-body">
        <div class="muted">Review the change, then apply.</div>
        <pre class="textbox">${p.diff}</pre>
      </div>
    `;
  }

  renderTimelineItem(it) {
    const raw = this.rawItem(it.id);
    const clip = (this.clips || []).find((c) => c.id === raw.use) || {};
    const rows = [
      ["Kind", it.kind],
      ["Clip", raw.use ?? ""],
      ["Source", clip.source ?? it.source ?? ""],
      ["Format", it.format ?? clip.format ?? ""],
      ["Path", it.path ?? ""],
      ...(raw.offset !== undefined ? [["Offset", raw.offset + "s"]] : []),
    ];
    return html`
      <div class="detail-head">
        <div><span class="pill">${it.kind}</span> <strong>${it.id}</strong></div>
        <div class="row">
          <button class="sm secondary" title="move earlier" @click=${() => this.proposeEdl([{ op: "reorder", id: it.id, delta: -1 }])}>◀</button>
          <button class="sm secondary" title="move later" @click=${() => this.proposeEdl([{ op: "reorder", id: it.id, delta: 1 }])}>▶</button>
          <button class="sm secondary" @click=${() => this.proposeEdl([{ op: "remove", id: it.id }])}>remove</button>
        </div>
      </div>
      <div class="detail-body">
        <div class="form">
          <div class="row">
            ${it.kind === "audio"
              ? html`<div><label>offset (s)</label><input id="ti_offset" type="number" step="0.1" value=${raw.offset ?? 0} /></div>
                     <div><label>gain (dB)</label><input id="ti_gain" type="number" step="1" value=${raw.gain_db ?? clip.gain_db ?? 0} /></div>`
              : html`<div><label>speed</label><input id="ti_speed" type="number" step="0.1" value=${raw.speed ?? 1} /></div>`}
          </div>
          <div class="actions">
            <button class="primary" @click=${() => {
              const q = (id) => Number(this.renderRoot.getElementById(id).value);
              this.proposeEdl([it.kind === "audio"
                ? { op: "set", id: it.id, patch: { offset: q("ti_offset"), gain_db: q("ti_gain") } }
                : { op: "set", id: it.id, patch: { speed: q("ti_speed") } }]);
            }}>Review change</button>
            ${raw.use ? html`<button class="secondary" @click=${() => {
              const c = (this.clips || []).find((x) => x.id === raw.use);
              if (c) this.selectClip(c);
            }}>edit clip</button>` : ""}
            <span class="muted">${this.runhint}</span>
          </div>
        </div>
        <div class="kv">${rows.map(([k, v]) => html`<div class="k">${k}</div><div class="v">${v}</div>`)}</div>
      </div>
    `;
  }

  renderTimeline() {
    const edl = this.edl;
    if (!edl) return html`<div class="tl-empty muted">loading…</div>`;
    if (edl.empty) return html`<div class="tl-empty muted">No edit.yaml yet — compose an EDL to see the timeline.</div>`;
    const dur = edl.duration || 1;
    const items = edl.clips || [];
    const trackWidth = this.pps ? dur * this.pps + "px" : "100%";
    const tickEvery = niceInterval(this.pps ? 90 / this.pps : dur / 10);
    const ticks = [];
    for (let t = 0; t <= dur + 1e-6; t += tickEvery) ticks.push(t);

    return html`
      <div class="tl-bar">
        <span class="muted">${items.length} items · ${fmtDur(dur)} @ ${edl.output?.format || ""}</span>
        <span class="spacer"></span>
        <span class="muted mono">${fmtDur(this.playhead)}</span>
        <button class="sm" @click=${() => this.zoomTimeline(-1)}>−</button>
        <button class="sm" @click=${() => this.zoomTimeline(1)}>+</button>
        <button class="sm" @click=${() => (this.pps = null)}>fit</button>
        ${this.renderHelpButton("timeline", "tl-help")}
      </div>
      <div class="tl-scroll">
        <div class="tl-track" style=${"width:" + trackWidth} @pointerdown=${this.onTimelineDown}>
          <div class="tl-ruler">
            ${ticks.map((t) => html`<div class="tl-tick" style=${"left:" + (t / dur) * 100 + "%"}><span>${fmtDur(t)}</span></div>`)}
          </div>
          <div class="tl-lane">
            ${items.map((it) => html`
              <div class="tl-item ${it.kind} ${(this.selection.kind === "timelineItem" && this.selection.id === it.id) || (this.selection.timelineItem && this.selection.timelineItem.id === it.id) ? "active" : ""}"
                style=${"left:" + (it.start / dur) * 100 + "%;width:" + (it.duration / dur) * 100 + "%"}
                title=${it.id + " · " + it.kind + " · " + fmtSec(it.start) + "–" + fmtSec(it.end) + (it.source ? " · " + it.source : "")}
                @pointerdown=${(e) => e.stopPropagation()}
                @click=${(e) => { e.stopPropagation(); this.selectTimelineItem(it); }}>
                ${it.id}
              </div>`)}
          </div>
          ${this.edl.audio?.items?.length
            ? html`<div class="tl-lane audio">
                ${this.edl.audio.items.map((it) => html`
                  <div class="tl-item audio ${(this.selection.kind === "timelineItem" && this.selection.id === it.id) || (this.selection.timelineItem && this.selection.timelineItem.id === it.id) ? "active" : ""}"
                    style=${"left:" + (it.start / dur) * 100 + "%;width:" + (it.duration / dur) * 100 + "%"}
                    title=${it.id + " · audio · " + fmtSec(it.start) + "–" + fmtSec(it.end) + " · " + it.source}
                    @pointerdown=${(e) => e.stopPropagation()}
                    @click=${(e) => { e.stopPropagation(); this.selectTimelineItem({ id: it.id }); }}>
                    ${it.id}
                  </div>`)}
              </div>`
            : ""}
          <div class="tl-playhead" style=${"left:" + (this.playhead / dur) * 100 + "%"}></div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      ${DEMO && this.demoBanner
        ? html`<div class="demo-banner">
            <span>🎬 Read-only demo — this is a static snapshot; editing, uploads and rendering are disabled.</span>
            <button class="demo-close" title="Dismiss" aria-label="Dismiss" @click=${() => this.dismissDemoBanner()}>✕</button>
          </div>`
        : ""}
      <div class="shell">
      <header>
        <div class="brand">vid-ed <span class="muted">studio</span></div>
        <div class="proj muted">${this.status ? "project: " + this.status.project : ""}</div>
        <div class="spacer"></div>
        <div class="toolrow">
          ${this.staleNodes.length
            ? html`<span class="badge missing" title="Downstream artifacts are stale">${this.staleNodes.length} stale</span>`
            : ""}
          ${this.status
            ? Object.entries(this.status.tools || {}).map(([n, ok]) =>
                html`<span class="badge ${ok ? "ok" : "missing"}">${n}</span>`)
            : ""}
        </div>
        <button @click=${() => this.refresh()}>refresh</button>
      </header>

      <div class="main">
        <aside class="rail">
          ${SECTIONS.map(([id, label]) => html`
            <section class="acc ${this.open === id ? "open" : ""}">
              <button class="acc-head" @click=${() => this.toggle(id)}>
                <span class="chev">${this.open === id ? "▾" : "▸"}</span>${label}
              </button>
              ${this.renderHelpButton(id, "acc-help")}
              ${this.open === id ? html`<div class="acc-body">${this.renderSection(id)}</div>` : ""}
            </section>`)}
        </aside>
        <div class="rail-handle" @pointerdown=${this.startRailDrag}></div>
        <main class="details">${this.renderDetails()}</main>
      </div>

      <div class="timeline-resize" @pointerdown=${this.startTimelineDrag}></div>
      <footer class="timeline">${this.renderTimeline()}</footer>
      </div>
      ${this.stale
        ? html`<div class="banner">
            ⚠️ <b>${this.stale}</b> changed on disk (agent) ·
            <button class="sm" @click=${() => { this.stale = null; this.refresh(); }}>reload</button>
          </div>`
        : ""}
    `;
  }

  dismissDemoBanner() {
    this.demoBanner = false;
    try { localStorage.setItem("vided.demoBanner", "0"); } catch { /* ignore */ }
  }

  static styles = [base, css`
    :host { display: flex; flex-direction: column; height: 100vh; width: 100%; overflow: hidden; }
    .shell { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: 44px 1fr 4px var(--timeline); flex: 1; min-height: 0; }
    .demo-banner { flex: none; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 6px 12px; background: var(--panel-3); border-bottom: 1px solid var(--warn); color: var(--text); font-size: 13px; }
    .demo-close { flex: none; border: 1px solid var(--line-strong); background: var(--panel-2); color: var(--muted); border-radius: 6px; padding: 2px 8px; cursor: pointer; line-height: 1.2; }
    .demo-close:hover { color: var(--text); border-color: var(--accent); }
    header { display: flex; align-items: center; gap: 12px; padding: 0 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .brand { font-weight: 700; }
    .brand .muted { font-weight: 400; }
    .proj { font-size: 12px; }
    .spacer { flex: 1; }
    .toolrow { display: flex; gap: 6px; }
    .main { display: grid; grid-template-columns: var(--rail) 4px 1fr; min-height: 0; position: relative; }
    .rail { overflow: auto; border-right: 1px solid var(--line); background: var(--panel); scrollbar-width: none; }
    .rail::-webkit-scrollbar { width: 0; height: 0; }
    .rail-handle { cursor: col-resize; background: transparent; }
    .rail-handle:hover { background: var(--accent); }
    .details { overflow: auto; min-width: 0; scrollbar-width: thin; scrollbar-color: #2c3542 transparent; }
    .timeline-resize { cursor: row-resize; background: var(--line); }
    .timeline-resize:hover { background: var(--accent); }
    .timeline { border-top: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
    .tl-empty { padding: 16px; }
    .tl-bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--line); flex: none; }
    .tl-bar .spacer { flex: 1; }
    .tl-scroll { flex: 1; overflow: auto; scrollbar-width: thin; scrollbar-color: #3a4553 #0f141b; }
    .tl-track { position: relative; min-width: 100%; height: 100%; min-height: 92px; cursor: crosshair; }
    .tl-ruler { position: relative; height: 22px; border-bottom: 1px solid var(--line-soft); }
    .tl-tick { position: absolute; top: 0; height: 22px; border-left: 1px solid var(--line-soft); padding-left: 4px; font: 10px/22px var(--mono); color: var(--muted); white-space: nowrap; }
    .tl-lane { position: relative; height: 52px; margin: 10px 0; background: var(--bg); border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); }
    .tl-lane.audio { height: 34px; margin-top: 0; }
    .tl-lane.audio .tl-item { height: 26px; top: 4px; }
    .tl-item { position: absolute; top: 4px; height: 44px; border-radius: 6px; border: 1px solid; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 4px 6px; font-size: 11px; cursor: pointer; }
    .tl-item.video { background: #1f6feb33; border-color: #4c8dff; }
    .tl-item.image { background: #d2992233; border-color: #e3b341; }
    .tl-item.audio { background: #2ea04333; border-color: #3fb950; }
    .tl-item.title { background: #8957e533; border-color: #a371f7; }
    .tl-item.slide { background: #2ea04333; border-color: #3fb950; }
    .tl-item.active { outline: 2px solid var(--accent); outline-offset: 1px; }
    .tl-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--err); pointer-events: none; }

    .acc { border-bottom: 1px solid var(--line); position: relative; }
    .acc-head { width: 100%; text-align: left; background: transparent; border: 0; border-radius: 0; padding: 9px 12px; color: var(--text); font-weight: 600; font-size: 12px; letter-spacing: .02em; display: flex; gap: 8px; align-items: center; }
    .acc-head:hover { background: var(--panel-2); border-color: transparent; }
    .acc.open .acc-head { background: var(--panel-2); box-shadow: inset 3px 0 0 var(--accent); }
    .chev { color: var(--muted); width: 10px; }
    .acc-body { padding: 10px 12px 14px; }

    .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .stat { background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--radius); padding: 8px 10px; }
    .stat .v { font-size: 18px; font-weight: 600; }
    .stat .k { color: var(--muted); font-size: 11px; }
    .tools { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }

    .uploader { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
    .row { display: flex; gap: 8px; align-items: center; }
    .ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .filebtn {
      display: inline-flex; align-items: center; cursor: pointer; white-space: nowrap;
      background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 6px 12px; color: var(--text); margin: 0;
      transition: background .12s, border-color .12s;
    }
    .filebtn:hover { background: var(--panel-3); border-color: var(--line-strong); }
    .filebtn input { display: none; }
    .urlrow { display: flex; gap: 6px; }
    .urlrow input { flex: 1; }
    table.media { table-layout: fixed; }
    .grouphead { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    table.clips { table-layout: fixed; }
    table.clips td { padding: 4px 6px; }
    table.clips td:nth-child(2) { width: 72px; }
    table.clips td:nth-child(3), table.clips td:nth-child(4) { width: 30px; text-align: right; }
    .clipctx { font-size: 11px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    table.media td { padding: 5px 6px; }
    table.media td:nth-child(1) { width: 46px; }
    table.media td:nth-child(3) { width: 42px; text-align: right; }
    table.media td:nth-child(4) { width: 34px; text-align: right; }
    table.media td:nth-child(5) { width: 30px; text-align: right; }
    td.path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .detail-head { padding: 14px 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 2; }
    .tab { border: 0; border-radius: 0; background: transparent; padding: 10px 12px; color: var(--muted); border-bottom: 2px solid transparent; }
    .tab:hover { color: var(--text); background: transparent; border-color: transparent; }
    .tab.active { color: var(--text); border-bottom-color: var(--accent); }
    .detail-body { padding: 16px; display: grid; gap: 16px; align-content: start; container-type: inline-size; }
    .info-grid { display: grid; gap: 18px; grid-template-columns: 1fr; align-items: start; }
    .info-grid .preview { max-width: none; }
    .clip-side { display: grid; gap: 12px; align-content: start; }
    @container (min-width: 720px) {
      .info-grid { grid-template-columns: minmax(0, 1.6fr) minmax(220px, 1fr); }
    }
    .kv { display: grid; grid-template-columns: 130px 1fr; gap: 5px 12px; font-size: 12px; align-content: start; }
    .fields { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 6px 12px; align-items: center; font-size: 12px; align-content: start; }
    .fields .fk { color: var(--muted); }
    .fields .fv { word-break: break-word; }
    .fields input[type="number"], .fields input[type="text"] { width: 130px; }
    .fields select { width: 140px; }
    .fields input[type="checkbox"] { width: auto; }
    .fields textarea { width: 100%; resize: vertical; }
    .kv .k { color: var(--muted); }
    .kv .v { word-break: break-word; }
    .segments { display: flex; flex-direction: column; }
    .seg { display: grid; grid-template-columns: 56px 1fr; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line-soft); }
    .seg .t { color: var(--muted); font-family: var(--mono); font-size: 11px; }
    .params { display: flex; flex-direction: column; gap: 12px; }
    fieldset { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; margin: 0; }
    legend { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; padding: 0 4px; }
    label.inline { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; margin: 0; }
    label.inline input[type="checkbox"] { width: auto; }
    .form { display: flex; flex-direction: column; }
    .preview { background: #000; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; max-width: 720px; }
    .textbox { background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; max-height: 420px; overflow: auto; }
    .block { margin-top: 16px; display: grid; gap: 8px; }
    .block .row strong { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .preview video, .preview img { width: 100%; height: auto; display: block; max-height: 60vh; object-fit: contain; }
    .tl-card { aspect-ratio: 16 / 9; display: grid; place-content: center; gap: 6px; text-align: center; padding: 18px; }
    .tl-card .t { font-size: 26px; font-weight: 700; }
    .tl-card .s { color: #c9d1d9; font-size: 15px; }
    .tl-card .b { font-family: var(--mono); font-size: 14px; white-space: pre-wrap; text-align: left; }
    .frames h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 10px; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .frame { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
    .frame img { width: 100%; display: block; background: #000; }
    .frame .cap { padding: 6px 8px; font-size: 11px; display: flex; flex-direction: column; gap: 2px; }

    .empty { height: 100%; display: grid; place-content: center; text-align: center; gap: 6px; color: var(--text); }
    .empty > div:first-child { font-size: 15px; }
    .banner { position: fixed; top: 54px; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; align-items: center; gap: 8px; background: var(--panel-3); border: 1px solid var(--warn); border-radius: 8px; padding: 8px 12px; box-shadow: 0 6px 18px #0008; }
    .logbox { margin-top: 10px; }
    .logbox summary { cursor: pointer; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .logbox pre { max-height: 260px; overflow: auto; margin-top: 8px; scrollbar-width: thin; scrollbar-color: #2c3542 transparent; }
    .pill.queued { color: var(--warn); } .pill.running { color: var(--accent); }
    .pill.done { color: var(--ok); } .pill.failed { color: var(--err); } .pill.cancelled { color: var(--muted); }

    .helpbtn {
      width: 18px; height: 18px; padding: 0; border-radius: 50%;
      border: 1px solid var(--line-strong); background: var(--panel-2);
      color: var(--muted); font: 600 11px/1 inherit;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; flex: none;
    }
    .helpbtn:hover { color: var(--text); border-color: var(--accent); background: var(--panel-3); }
    .acc-help { position: absolute; top: 7px; right: 8px; }
    .tabs-help { margin: 8px 8px 6px 0; align-self: center; }
    .tl-help { margin-left: 2px; align-self: center; }

    .help-pop {
      width: max-content; max-width: min(340px, 72vw);
      padding: 10px 12px; color: var(--text);
      background: var(--panel); border: 1px solid var(--line-strong);
      border-radius: var(--radius); box-shadow: 0 8px 24px #0007;
    }
    .help-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
    .help-ico {
      width: 18px; height: 18px; border-radius: 50%; background: var(--accent);
      color: #06101f; font: 700 11px/1 inherit;
      display: inline-flex; align-items: center; justify-content: center; flex: none;
    }
    .help-pop p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    @supports (position-anchor: --x) {
      .help-pop {
        position: fixed; inset: auto; margin: 6px 0 0;
        position-area: bottom span-right;
        position-try-fallbacks: flip-inline, flip-block;
      }
    }
  `];
}
customElements.define("vided-app", VidedApp);
