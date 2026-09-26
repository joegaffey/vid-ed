import { LitElement, html, css } from "lit";
import { base } from "./styles.js";

const api = {
  get: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  },
  post: (url, body) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  put: (url, body) =>
    fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
};

const fmtDur = (s) => {
  if (s == null) return "–";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m + ":" + String(r).padStart(2, "0");
};
const fmtBytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");

const SECTIONS = [
  ["project", "Project"],
  ["media", "Media bin"],
  ["analysis", "Analysis"],
  ["context", "Context"],
  ["vision", "Vision"],
  ["output", "Output"],
  ["activity", "Activity"],
];

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
    context: { state: true },
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
  };

  constructor() {
    super();
    this.status = null;
    this.manifest = null;
    this.context = null;
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
    this._rail = Number(localStorage.getItem("vided.rail")) || 300;
    this._timeline = Number(localStorage.getItem("vided.timeline")) || 220;
    this._es = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.setProperty("--rail", this._rail + "px");
    this.style.setProperty("--timeline", this._timeline + "px");
    this.refresh();
    this._timer = setInterval(() => this.loadJobs(), 5000);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
    if (this._es) this._es.close();
  }

  async refresh() {
    this.loadStatus();
    this.loadManifest();
    this.loadContext();
    this.loadOutputs();
    this.loadJobs();
  }

  async loadStatus() {
    try { this.status = await api.get("/api/status"); } catch { this.status = null; }
  }
  async loadManifest() {
    try { this.manifest = await api.get("/api/manifest"); } catch { this.manifest = null; }
  }
  async loadContext() {
    try { this.context = await api.get("/api/context"); } catch { this.context = null; }
  }
  async loadOutputs() {
    try { this.outputs = await api.get("/api/outputs"); } catch { this.outputs = []; }
  }
  async loadJobs() {
    try { this.jobs = await api.get("/api/jobs"); } catch { /* ignore */ }
  }

  selectAsset(a) {
    this.selection = { kind: "asset", id: a.id, asset: a };
    this.detailTab = "overview";
    this.frames = null;
    this.loadFrames(a.id);
  }
  async loadFrames(id) {
    try { this.frames = await api.get("/api/assets/" + id + "/frames"); } catch { this.frames = { frames: [] }; }
  }

  async runStage(op, args = []) {
    this.runhint = "queued…";
    const r = await api.post("/api/jobs", { op, args });
    if (!r.ok) { this.runhint = "failed"; return; }
    const job = await r.json();
    await this.loadJobs();
    this.streamJob(job.id);
  }
  streamJob(id) {
    if (this._es) this._es.close();
    this.open = "activity";
    localStorage.setItem("vided.open", this.open);
    this.logJob = id;
    this.log = "";
    this.runhint = "running " + id + "…";
    const es = new EventSource("/api/jobs/" + id + "/events");
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
      case "analysis": return this.renderAnalysis();
      case "context": return this.renderContext();
      case "vision": return this.renderVision();
      case "output": return this.renderOutput();
      case "activity": return this.renderActivity();
      default: return "";
    }
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
      <div class="uploader">
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
      </div>
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
              </tr>`;
            })}
          </tbody></table>`}
    `;
  }

  async onUpload(e) {
    const files = e.target.files;
    if (!files || !files.length) return;
    this.fileNames = files.length === 1 ? files[0].name : files.length + " files";
    let i = 0;
    for (const f of files) {
      i++;
      this.runhint = `uploading ${i}/${files.length}…`;
      await fetch("/api/uploads?name=" + encodeURIComponent(f.name) + "&scan=" + (i === files.length ? "1" : "0"), {
        method: "POST",
        body: f,
      });
    }
    this.runhint = "uploaded";
    this.refresh();
  }
  async downloadUrl() {
    if (!this._url) return;
    const r = await api.post("/api/uploads/url", { url: this._url });
    if (!r.ok) { this.runhint = "download failed"; return; }
    const job = await r.json();
    await this.loadJobs();
    this.streamJob(job.id);
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

  renderContext() {
    const c = this.context;
    if (!c) return html`<p class="muted">No context.</p>`;
    const pron = Object.entries(c.pronunciation || {}).map(([k, v]) => k + ": " + v).join("\n");
    return html`
      <label>Brief</label><textarea id="cx_brief" rows="4">${c.brief || ""}</textarea>
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
    `;
  }
  async saveContext() {
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
    const r = await api.put("/api/context", body);
    this.runhint = r.ok ? "context saved" : "context save failed";
    await this.loadContext();
  }

  renderOutput() {
    if (!this.outputs.length) return html`<p class="muted">No renders yet.</p>`;
    return html`<table><tbody>
      ${this.outputs.map((f) => html`<tr>
        <td><a href=${"/api/outputs/" + encodeURIComponent(f.name)} target="_blank">${f.name}</a></td>
        <td class="muted">${fmtBytes(f.bytes)}</td>
      </tr>`)}
    </tbody></table>`;
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

  renderDetails() {
    const sel = this.selection;
    if (sel.kind !== "asset") {
      return html`<div class="empty">
        <div>Select an item</div>
        <div class="muted">Pick an asset in the Media bin, or an item on the timeline.</div>
      </div>`;
    }
    const a = sel.asset;
    const tabs = [["overview", "Overview"], ["transcript", "Transcript"], ["frames", "Frames"], ["notes", "Notes"], ["process", "Process"]];
    return html`
      <div class="detail-head">
        <div><span class="pill">${a.kind}</span> <strong>${a.path}</strong></div>
        <div class="muted">${fmtDur(a.technical?.duration_s)} · ${a.status}</div>
      </div>
      <div class="tabs">
        ${tabs.map(([id, label]) =>
          html`<button class="tab ${this.detailTab === id ? "active" : ""}" @click=${() => (this.detailTab = id)}>${label}</button>`)}
      </div>
      <div class="detail-body">
        ${this.detailTab === "overview" ? this.renderInfo(a)
          : this.detailTab === "transcript" ? this.renderTranscript(a)
          : this.detailTab === "frames" ? this.renderFrames()
          : this.detailTab === "notes" ? this.renderNotes(a)
          : this.renderProcess(a)}
      </div>
    `;
  }

  renderPreview(a) {
    if (a.kind === "video" || a.kind === "audio") return html`<video controls preload="metadata" src=${"/api/media/" + a.id}></video>`;
    if (a.kind === "image") return html`<img src=${"/api/media/" + a.id} alt=${a.path} />`;
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
    return html`
      <div class="info-grid">
        <div class="preview">${this.renderPreview(a)}</div>
        <div class="kv">${rows.map(([k, val]) => html`<div class="k">${k}</div><div class="v">${val}</div>`)}</div>
      </div>
    `;
  }

  renderTranscript(a) {
    const tr = a.extracted?.transcript;
    const segs = tr?.segments || [];
    if (!segs.length) return html`<p class="muted">No transcript — run <em>extract-text</em> from the Process tab.</p>`;
    return html`
      <div class="muted" style="margin-bottom:8px">
        ${tr.tool}${a.extracted.language ? " · " + a.extracted.language : ""} · ${segs.length} segments
      </div>
      <div class="segments">
        ${segs.map((s) => html`<div class="seg"><span class="t">${fmtDur(s.start)}</span><span>${s.text}</span></div>`)}
      </div>
    `;
  }

  renderFrames() {
    if (!this.frames) return html`<p class="muted">loading…</p>`;
    if (!this.frames.frames.length) return html`<p class="muted">No frames — run <em>sample</em> from the Process tab.</p>`;
    return html`<div class="gallery">
      ${this.frames.frames.map((f) => html`<div class="frame">
        <img loading="lazy" src=${f.url} alt=${"t=" + f.t} />
        <div class="cap"><span>t=${f.t}${f.selected ? " ✓" : ""}</span>
          ${f.description ? html`<span class="muted">${f.description}</span>` : ""}</div>
      </div>`)}
    </div>`;
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
    const q = (id) => this.renderRoot.getElementById(id);
    const body = {
      title: q("n_title").value || undefined,
      role: q("n_role").value || undefined,
      tags: q("n_tags").value.split(",").map((s) => s.trim()).filter(Boolean),
      notes: q("n_notes").value || undefined,
    };
    const r = await api.put("/api/context/assets/" + encodeURIComponent(a.id), body);
    this.runhint = r.ok ? "saved" : "save failed";
    await this.loadContext();
  }

  renderProcess(a) {
    return html`
      <div class="params">
        <fieldset>
          <legend>Transcribe</legend>
          <div class="row">
            <input id="p_lang" placeholder="language (auto)" style="width:120px" />
            <label class="inline"><input id="p_ocr" type="checkbox" /> OCR images</label>
            <button @click=${() => this.runAssetStage(a, "extract-text", [
              ...(this.renderRoot.getElementById("p_lang").value ? ["--language", this.renderRoot.getElementById("p_lang").value] : []),
              ...(this.renderRoot.getElementById("p_ocr").checked ? ["--ocr"] : []),
            ])}>Run</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Sample</legend>
          <div class="row">
            <label class="inline">threshold <input id="p_thr" type="number" step="0.05" value="0.25" style="width:70px" /></label>
            <label class="inline">rate/min <input id="p_rate" type="number" value="30" style="width:70px" /></label>
            <button @click=${() => this.runAssetStage(a, "sample", ["--threshold", this.renderRoot.getElementById("p_thr").value, "--rate", this.renderRoot.getElementById("p_rate").value])}>Run</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Dedupe</legend>
          <div class="row">
            <label class="inline">phash distance <input id="p_dist" type="number" value="6" style="width:70px" /></label>
            <label class="inline">budget <input id="p_budget" type="number" style="width:70px" /></label>
            <button @click=${() => this.runAssetStage(a, "dedupe", [
              "--phash-distance", this.renderRoot.getElementById("p_dist").value,
              ...(this.renderRoot.getElementById("p_budget").value ? ["--budget", this.renderRoot.getElementById("p_budget").value] : []),
            ])}>Run</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Vision</legend>
          <div class="row">
            <button @click=${() => this.runAssetStage(a, "annotate", ["--packet-out", "work/" + a.id + ".packet.json"])}>Build packet</button>
            <span class="muted">describe frames, then ingest results</span>
          </div>
        </fieldset>
      </div>
    `;
  }
  async runAssetStage(a, op, extraArgs) {
    await this.runStage(op, ["--assets", a.id, ...extraArgs]);
    this.loadJobs();
  }

  renderTimeline() {
    return html`<div class="tl-empty muted">Timeline — rendered from edit.yaml (next phase).</div>`;
  }

  render() {
    return html`
      <header>
        <div class="brand">vid-ed <span class="muted">studio</span></div>
        <div class="proj muted">${this.status ? "project: " + this.status.project : ""}</div>
        <div class="spacer"></div>
        <div class="toolrow">
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
              ${this.open === id ? html`<div class="acc-body">${this.renderSection(id)}</div>` : ""}
            </section>`)}
        </aside>
        <div class="rail-handle" @pointerdown=${this.startRailDrag}></div>
        <main class="details">${this.renderDetails()}</main>
      </div>

      <div class="timeline-resize" @pointerdown=${this.startTimelineDrag}></div>
      <footer class="timeline">${this.renderTimeline()}</footer>
    `;
  }

  static styles = [base, css`
    :host { display: grid; grid-template-rows: 44px 1fr 4px var(--timeline); height: 100vh; }
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
    .timeline { border-top: 1px solid var(--line); background: var(--panel); overflow: auto; scrollbar-width: thin; scrollbar-color: #2c3542 transparent; }
    .tl-empty { padding: 16px; }

    .acc { border-bottom: 1px solid var(--line); }
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
    table.media td { padding: 5px 6px; }
    table.media td:nth-child(1) { width: 46px; }
    table.media td:nth-child(3) { width: 42px; text-align: right; }
    table.media td:nth-child(4) { width: 30px; text-align: right; }
    td.path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .detail-head { padding: 14px 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 2; }
    .tab { border: 0; border-radius: 0; background: transparent; padding: 10px 12px; color: var(--muted); border-bottom: 2px solid transparent; }
    .tab:hover { color: var(--text); background: transparent; border-color: transparent; }
    .tab.active { color: var(--text); border-bottom-color: var(--accent); }
    .detail-body { padding: 16px; display: grid; gap: 16px; align-content: start; container-type: inline-size; }
    .info-grid { display: grid; gap: 18px; grid-template-columns: 1fr; align-items: start; }
    .info-grid .preview { max-width: none; }
    @container (min-width: 720px) {
      .info-grid { grid-template-columns: minmax(0, 1.6fr) minmax(220px, 1fr); }
    }
    .kv { display: grid; grid-template-columns: 130px 1fr; gap: 5px 12px; font-size: 12px; align-content: start; }
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
    .preview video, .preview img { width: 100%; display: block; max-height: 420px; object-fit: contain; }
    .frames h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 10px; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .frame { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
    .frame img { width: 100%; display: block; background: #000; }
    .frame .cap { padding: 6px 8px; font-size: 11px; display: flex; flex-direction: column; gap: 2px; }

    .empty { height: 100%; display: grid; place-content: center; text-align: center; gap: 6px; color: var(--text); }
    .empty > div:first-child { font-size: 15px; }
    .logbox { margin-top: 10px; }
    .logbox summary { cursor: pointer; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .logbox pre { max-height: 260px; overflow: auto; margin-top: 8px; scrollbar-width: thin; scrollbar-color: #2c3542 transparent; }
    .pill.queued { color: var(--warn); } .pill.running { color: var(--accent); }
    .pill.done { color: var(--ok); } .pill.failed { color: var(--err); } .pill.cancelled { color: var(--muted); }
  `];
}
customElements.define("vided-app", VidedApp);
