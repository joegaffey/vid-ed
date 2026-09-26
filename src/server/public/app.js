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
      case "analysis": return html`<p class="muted">Stage controls with parameters — next phase.</p>`;
      case "context": return this.renderContext();
      case "vision": return html`<p class="muted">Annotation review — next phase.</p>`;
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
        <input type="file" multiple @change=${this.onUpload} />
        <div class="urlrow">
          <input placeholder="YouTube / URL" .value=${this._url || ""}
            @input=${(e) => (this._url = e.target.value)} />
          <button @click=${this.downloadUrl}>get</button>
        </div>
        <span class="muted">${this.runhint}</span>
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

  renderContext() {
    const c = this.context;
    if (!c) return html`<p class="muted">No context.</p>`;
    return html`
      <label>Brief</label>
      <textarea rows="4" .value=${c.brief || ""} @input=${(e) => (this._brief = e.target.value)}></textarea>
      <label>Audience</label><input .value=${c.audience || ""} @input=${(e) => (this._audience = e.target.value)} />
      <label>Tone</label><input .value=${c.tone || ""} @input=${(e) => (this._tone = e.target.value)} />
      <label>Target duration (s)</label><input type="number" .value=${c.target_duration_s || ""} @input=${(e) => (this._target = e.target.value)} />
      <div class="actions"><button class="primary" @click=${this.saveContext}>Save</button></div>
    `;
  }
  async saveContext() {
    const body = {
      brief: this._brief ?? this.context.brief,
      audience: this._audience ?? this.context.audience,
      tone: this._tone ?? this.context.tone,
      target_duration_s: this._target ? Number(this._target) : this.context.target_duration_s,
      must_include: this.context.must_include || [],
      avoid: this.context.avoid || [],
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
      <details class="logbox" ?open=${!!this.logJob}>
        <summary>log ${this.logJob ? "· " + this.logJob : ""}</summary>
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
    const isVideo = a.kind === "video";
    const isImage = a.kind === "image";
    return html`
      <div class="detail-head">
        <div><span class="pill">${a.kind}</span> <strong>${a.path}</strong></div>
        <div class="muted">${fmtDur(a.technical?.duration_s)} · ${a.status}</div>
      </div>
      <div class="detail-body">
        <div class="preview">
          ${isVideo || a.kind === "audio"
            ? html`<video controls preload="metadata" src=${"/api/media/" + a.id}></video>`
            : isImage
            ? html`<img src=${"/api/media/" + a.id} alt=${a.path} />`
            : html`<div class="muted">No preview for ${a.kind}.</div>`}
        </div>
        <div class="frames">
          <h3>Frames ${this.frames ? html`<span class="muted">(${this.frames.frames.length})</span>` : ""}</h3>
          ${this.frames
            ? this.frames.frames.length
              ? html`<div class="gallery">
                  ${this.frames.frames.map((f) => html`<div class="frame">
                    <img loading="lazy" src=${f.url} alt=${"t=" + f.t} />
                    <div class="cap"><span>t=${f.t}${f.selected ? " ✓" : ""}</span>
                      ${f.description ? html`<span class="muted">${f.description}</span>` : ""}</div>
                  </div>`)}
                </div>`
              : html`<p class="muted">No frames — run sample.</p>`
            : html`<p class="muted">loading…</p>`}
        </div>
      </div>
    `;
  }

  renderTimeline() {
    return html`<div class="tl-empty muted">Timeline — rendered from edit.yaml (next phase).</div>`;
  }

  render() {
    return html`
      <header>
        <div class="brand">vided <span class="muted">studio</span></div>
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
    .urlrow { display: flex; gap: 6px; }
    .urlrow input { flex: 1; }
    table.media { table-layout: fixed; }
    table.media td { padding: 5px 6px; }
    table.media td:nth-child(1) { width: 46px; }
    table.media td:nth-child(3) { width: 42px; text-align: right; }
    table.media td:nth-child(4) { width: 30px; text-align: right; }
    td.path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .detail-head { padding: 14px 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .detail-body { padding: 16px; display: grid; gap: 16px; }
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
