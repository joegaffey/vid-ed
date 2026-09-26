export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>vided studio</title>
<style>
  :root { color-scheme: dark; --bg:#0d1117; --panel:#161b22; --line:#21262d; --muted:#8b949e; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:#e6edf3; }
  header { padding:14px 22px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:baseline; position:sticky; top:0; background:var(--bg); z-index:5; }
  header h1 { font-size:16px; margin:0; }
  header .muted { color:var(--muted); }
  main { display:grid; grid-template-columns: 1fr 1fr; gap:16px; padding:18px 22px; max-width:1300px; margin:0 auto; align-items:start; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  section h2 { font-size:12px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin:0 0 12px; font-weight:600; }
  .full { grid-column: 1 / -1; }
  .stats { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; }
  .stat { background:#0d1117; border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
  .stat .v { font-size:20px; font-weight:600; }
  .stat .k { color:var(--muted); font-size:12px; }
  .tools { margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; }
  .badge { border:1px solid var(--line); border-radius:999px; padding:2px 10px; font-size:12px; }
  .badge.ok { color:#3fb950; border-color:#238636; }
  .badge.missing { color:#d29922; border-color:#9e6a03; }
  table { width:100%; border-collapse:collapse; }
  td, th { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); font-weight:400; vertical-align:top; }
  th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  tr.clickable { cursor:pointer; }
  tr.clickable:hover td { background:#1c2128; }
  tr.active td { background:#1f6feb22; }
  .muted { color:var(--muted); }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .col { display:flex; flex-direction:column; gap:8px; }
  label { display:block; color:var(--muted); font-size:12px; margin-top:8px; }
  select, input, textarea, button { background:#0d1117; color:#e6edf3; border:1px solid #30363d; border-radius:6px; padding:7px 9px; font:inherit; width:100%; }
  textarea { min-height:70px; resize:vertical; }
  button { cursor:pointer; background:#238636; border-color:#2ea043; width:auto; }
  button.secondary { background:#21262d; border-color:#30363d; }
  button:disabled { opacity:.5; cursor:default; }
  .pill { padding:1px 8px; border-radius:999px; font-size:12px; border:1px solid #30363d; }
  .queued{color:#d29922}.running{color:#58a6ff}.done{color:#3fb950}.failed{color:#f85149}.cancelled{color:#8b949e}
  details { margin-top:12px; }
  summary { cursor:pointer; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  pre { white-space:pre-wrap; word-break:break-word; margin:8px 0 0; font:12px/1.5 ui-monospace, monospace; max-height:300px; overflow:auto; color:#9da7b3; }
  .gallery { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:10px; }
  .frame { background:#0d1117; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .frame img { width:100%; display:block; background:#000; }
  .frame .cap { padding:6px 8px; font-size:12px; color:#c9d1d9; }
  .frame .cap .muted { display:block; }
  a { color:#58a6ff; }
</style>
</head>
<body>
<header>
  <h1>vided studio</h1>
  <span class="muted" id="root">connecting…</span>
</header>
<main>
  <section>
    <h2>Project</h2>
    <div class="stats" id="stats"></div>
    <div class="tools" id="tools"></div>
  </section>

  <section>
    <h2>Context</h2>
    <div class="col">
      <div><label>Brief</label><textarea id="c_brief" placeholder="What is this edit about, for whom, tone…"></textarea></div>
      <div class="row">
        <div style="flex:1"><label>Audience</label><input id="c_audience" /></div>
        <div style="flex:1"><label>Tone</label><input id="c_tone" /></div>
        <div style="width:130px"><label>Target (s)</label><input id="c_target" type="number" /></div>
      </div>
      <div class="row">
        <div style="flex:1"><label>Must include (comma)</label><input id="c_must" /></div>
        <div style="flex:1"><label>Avoid (comma)</label><input id="c_avoid" /></div>
      </div>
      <div class="row"><button id="c_save">Save context</button><span class="muted" id="c_status"></span></div>
    </div>
  </section>

  <section>
    <h2>Media</h2>
    <div id="media"></div>
  </section>

  <section>
    <h2>Selected input</h2>
    <div id="assetEdit" class="muted">Select an asset from Media.</div>
  </section>

  <section>
    <h2>Upload</h2>
    <div class="col">
      <div><label>Files</label><input id="up_file" type="file" multiple /></div>
      <div class="row"><button id="up_go" class="secondary">Upload &amp; scan</button><span class="muted" id="up_status"></span></div>
      <div><label>or YouTube / URL</label><div class="row"><input id="up_url" placeholder="https://youtu.be/…" /><button id="up_url_go" class="secondary">Download</button></div></div>
    </div>
  </section>

  <section class="full">
    <h2>Run a stage</h2>
    <div class="row">
      <select id="op" style="width:auto">
        <option>scan</option><option>doctor</option><option>status</option>
        <option>extract-text</option><option>sample</option><option>dedupe</option>
        <option>annotate</option><option>manifest</option><option>script</option>
        <option>tts</option><option>captions</option><option>compose</option><option>render</option>
      </select>
      <span id="params" class="row"></span>
      <button id="run">Run</button>
      <span class="muted" id="runhint"></span>
    </div>
    <details id="tech"><summary>Technical output</summary><pre id="log"></pre></details>
  </section>

  <section>
    <h2>Jobs</h2>
    <table id="jobs"><tbody></tbody></table>
  </section>

  <section>
    <h2>Outputs</h2>
    <div id="outputs" class="muted">No renders yet.</div>
  </section>

  <section class="full">
    <h2>Frames <span class="muted" id="framesFor"></span></h2>
    <div class="gallery" id="frames"></div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const fmtDur = (s) => { if (s == null) return "–"; const m = Math.floor(s/60); const r = Math.round(s%60); return m + ":" + String(r).padStart(2,"0"); };
const fmtBytes = (b) => b > 1048576 ? (b/1048576).toFixed(1)+" MB" : Math.round(b/1024)+" KB";
async function jget(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); }
function stat(k,v){ const d=el("div","stat"); d.appendChild(el("div","v",v)); d.appendChild(el("div","k",k)); return d; }

let selected = null;

async function loadStatus() {
  try {
    const s = await jget("/api/status");
    $("root").textContent = "project: " + s.project;
    const g = $("stats"); g.innerHTML = "";
    g.appendChild(stat("Assets", s.assets));
    g.appendChild(stat("Duration", fmtDur(s.duration_s)));
    g.appendChild(stat("Selected frames", s.unique_frames));
    g.appendChild(stat("Annotated", s.cost ? s.cost.annotated_frames : 0));
    g.appendChild(stat("Vision tokens", s.cost ? s.cost.estimated_vision_tokens : 0));
    g.appendChild(stat("Saved by dedupe", s.cost ? s.cost.tokens_saved_by_dedupe : 0));
    const t = $("tools"); t.innerHTML = "";
    for (const [n, ok] of Object.entries(s.tools||{})) t.appendChild(el("span","badge "+(ok?"ok":"missing"), n+(ok?" ready":" missing")));
  } catch { $("root").textContent = "status unavailable"; }
}

async function loadMedia() {
  const box = $("media");
  try {
    const m = await jget("/api/manifest");
    box.innerHTML = "";
    box.appendChild(el("div","muted", m.totals.assets+" assets · "+fmtDur(m.totals.duration_s)+" · "+m.totals.unique_frames+" frames"));
    const t = el("table"); const head = el("tr");
    for (const h of ["Kind","Path","Dur","Frames"]) head.appendChild(el("th",null,h));
    t.appendChild(head);
    for (const a of m.assets) {
      const tr = el("tr","clickable"); if (selected && selected.id === a.id) tr.className += " active";
      const sel = a.visual && a.visual.frames ? a.visual.frames.filter(f=>f.selected).length : 0;
      tr.appendChild(el("td",null,a.kind));
      tr.appendChild(el("td",null,a.path));
      tr.appendChild(el("td",null,fmtDur(a.technical && a.technical.duration_s)));
      tr.appendChild(el("td",null,String(sel)));
      tr.addEventListener("click", () => selectAsset(a));
      t.appendChild(tr);
    }
    box.appendChild(t);
  } catch { box.innerHTML = ""; box.appendChild(el("div","muted","No analysis yet — upload media and run scan.")); }
}

function selectAsset(a) {
  selected = a;
  loadMedia();
  loadFrames(a.id);
  renderAssetEdit(a);
}

function renderAssetEdit(a) {
  const box = $("assetEdit"); box.className = ""; box.innerHTML = "";
  box.appendChild(el("div","muted", a.path));
  const meta = (window.__ctx && window.__ctx.assets && (window.__ctx.assets[a.id] || window.__ctx.assets[a.path])) || {};
  const mk = (label, id, val) => { const d = el("div"); d.appendChild(el("label",null,label)); const i = el("input"); i.id = id; i.value = val || ""; d.appendChild(i); return d; };
  box.appendChild(mk("Title","a_title",meta.title));
  box.appendChild(mk("Role","a_role",meta.role));
  box.appendChild(mk("Tags (comma)","a_tags",(meta.tags||[]).join(", ")));
  const d = el("div"); d.appendChild(el("label",null,"Notes")); const ta = el("textarea"); ta.id = "a_notes"; ta.value = meta.notes || ""; d.appendChild(ta); box.appendChild(d);
  const row = el("div","row"); const btn = el("button",null,"Save input"); const st = el("span","muted");
  btn.addEventListener("click", async () => {
    const body = { title: $("a_title").value || undefined, role: $("a_role").value || undefined,
      tags: $("a_tags").value.split(",").map(s=>s.trim()).filter(Boolean), notes: $("a_notes").value || undefined };
    const r = await fetch("/api/context/assets/"+encodeURIComponent(a.id), { method:"PUT", headers:{"content-type":"application/json"}, body: JSON.stringify(body) });
    st.textContent = r.ok ? "saved" : "failed";
    await loadContext();
  });
  row.appendChild(btn); row.appendChild(st); box.appendChild(row);
}

async function loadContext() {
  try {
    const c = await jget("/api/context");
    window.__ctx = c;
    $("c_brief").value = c.brief || "";
    $("c_audience").value = c.audience || "";
    $("c_tone").value = c.tone || "";
    $("c_target").value = c.target_duration_s || "";
    $("c_must").value = (c.must_include||[]).join(", ");
    $("c_avoid").value = (c.avoid||[]).join(", ");
  } catch {}
}

$("c_save").addEventListener("click", async () => {
  const body = {
    brief: $("c_brief").value || undefined,
    audience: $("c_audience").value || undefined,
    tone: $("c_tone").value || undefined,
    target_duration_s: $("c_target").value ? Number($("c_target").value) : undefined,
    must_include: $("c_must").value.split(",").map(s=>s.trim()).filter(Boolean),
    avoid: $("c_avoid").value.split(",").map(s=>s.trim()).filter(Boolean),
  };
  const r = await fetch("/api/context", { method:"PUT", headers:{"content-type":"application/json"}, body: JSON.stringify(body) });
  $("c_status").textContent = r.ok ? "saved" : "failed";
  await loadContext();
});

$("up_go").addEventListener("click", async () => {
  const files = $("up_file").files;
  if (!files || !files.length) return;
  let done = 0;
  for (const f of files) {
    $("up_status").textContent = "uploading " + (++done) + "/" + files.length + "…";
    await fetch("/api/uploads?name=" + encodeURIComponent(f.name) + "&scan=" + (done === files.length ? "1" : "0"), { method:"POST", body: f });
  }
  $("up_status").textContent = "uploaded " + files.length + " file(s); scanning…";
  loadJobs(); loadMedia(); loadStatus();
});
$("up_url_go").addEventListener("click", async () => {
  const url = $("up_url").value.trim(); if (!url) return;
  $("up_status").textContent = "starting download…";
  const r = await fetch("/api/uploads/url", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ url }) });
  if (!r.ok) { $("up_status").textContent = "failed"; return; }
  const job = await r.json(); loadJobs(); stream(job.id, true);
});

const PARAMS = {
  "sample": [ {n:"threshold",t:"number",d:0.25}, {n:"rate",t:"number",d:30} ],
  "dedupe": [ {n:"phash-distance",t:"number",d:6}, {n:"budget",t:"number"} ],
  "extract-text": [ {n:"language",t:"text",d:"auto"}, {n:"ocr",t:"checkbox"} ],
  "tts": [ {n:"voice",t:"text"} ],
  "render": [ {n:"preview",t:"checkbox"} ],
  "captions": [ {n:"formats",t:"text",d:"srt,vtt"} ],
};
function renderParams() {
  const box = $("params"); box.innerHTML = "";
  for (const p of (PARAMS[$("op").value] || [])) {
    const wrap = el("span","row"); wrap.appendChild(el("span","muted",p.n));
    if (p.t === "checkbox") { const i = el("input"); i.type="checkbox"; i.id="p_"+p.n; i.style.width="auto"; wrap.appendChild(i); }
    else { const i = el("input"); i.type = p.t; i.id="p_"+p.n; if (p.d != null) i.value = p.d; i.style.width = "90px"; wrap.appendChild(i); }
    box.appendChild(wrap);
  }
}
$("op").addEventListener("change", renderParams);

function collectArgs() {
  const args = [];
  for (const p of (PARAMS[$("op").value] || [])) {
    const i = $("p_"+p.n); if (!i) continue;
    if (p.t === "checkbox") { if (i.checked) args.push("--"+p.n); }
    else if (i.value !== "" && i.value != null) args.push("--"+p.n, i.value);
  }
  return args;
}

$("run").addEventListener("click", async () => {
  const op = $("op").value;
  $("runhint").textContent = "queued…";
  const r = await fetch("/api/jobs", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ op, args: collectArgs() }) });
  if (!r.ok) { $("runhint").textContent = "failed"; return; }
  const job = await r.json(); await loadJobs(); stream(job.id);
});

function jobRow(job) {
  const tr = el("tr");
  tr.appendChild(el("td",null, job.op + (job.args.length ? " " + job.args.join(" ") : "")));
  const td = el("td"); td.appendChild(el("span","pill "+job.status, job.status)); tr.appendChild(td);
  const b = el("button","secondary","view"); b.addEventListener("click",()=>stream(job.id));
  const tdb = el("td"); tdb.appendChild(b); tr.appendChild(tdb);
  return tr;
}
async function loadJobs() {
  const jobs = await jget("/api/jobs");
  const tb = $("jobs").querySelector("tbody"); tb.innerHTML = "";
  for (const job of jobs.slice().reverse()) tb.appendChild(jobRow(job));
}

let es = null;
function stream(id, thenScan) {
  if (es) es.close();
  $("tech").open = true; $("log").textContent = ""; $("runhint").textContent = "running "+id+"…";
  es = new EventSource("/api/jobs/"+id+"/events");
  es.addEventListener("log", (ev) => { const j = JSON.parse(ev.data); $("log").textContent = j.logs.join("\\n"); $("log").scrollTop = $("log").scrollHeight; });
  es.addEventListener("status", async (ev) => {
    const j = JSON.parse(ev.data); $("log").textContent = j.logs.join("\\n");
    if (["done","failed","cancelled"].includes(j.status)) {
      es.close(); es = null;
      $("runhint").textContent = j.status;
      loadJobs(); loadStatus(); loadMedia(); loadOutputs(); loadContext();
      if (thenScan && j.status === "done") {
        const r = await fetch("/api/jobs", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ op:"scan", args:[] }) });
        if (r.ok) { const nj = await r.json(); loadJobs(); stream(nj.id); }
      }
    }
  });
}

async function loadFrames(id) {
  const box = $("frames"); const forEl = $("framesFor");
  try {
    const data = await jget("/api/assets/"+id+"/frames");
    forEl.textContent = "— " + data.asset;
    box.innerHTML = "";
    for (const f of data.frames) {
      const c = el("div","frame");
      const img = el("img"); img.src = f.url; img.loading = "lazy"; img.alt = "t="+f.t; c.appendChild(img);
      const cap = el("div","cap");
      cap.appendChild(el("div",null, "t="+f.t + (f.selected ? "  ✓" : "")));
      if (f.description) cap.appendChild(el("span","muted", f.description));
      c.appendChild(cap); box.appendChild(c);
    }
    if (!data.frames.length) box.appendChild(el("div","muted","No frames yet — run sample."));
  } catch { forEl.textContent = ""; box.innerHTML = ""; box.appendChild(el("div","muted","No frames yet.")); }
}

async function loadOutputs() {
  const box = $("outputs");
  try {
    const list = await jget("/api/outputs");
    box.innerHTML = "";
    if (!list.length) { box.appendChild(el("div","muted","No renders yet.")); return; }
    const t = el("table");
    for (const f of list) {
      const tr = el("tr");
      const a = el("a", null, f.name); a.href = "/api/outputs/"+encodeURIComponent(f.name); a.target = "_blank";
      const td = el("td"); td.appendChild(a); tr.appendChild(td);
      tr.appendChild(el("td","muted", fmtBytes(f.bytes)));
      t.appendChild(tr);
    }
    box.appendChild(t);
  } catch {}
}

renderParams();
loadStatus(); loadMedia(); loadContext(); loadJobs(); loadOutputs();
setInterval(loadJobs, 5000);
</script>
</body>
</html>
`;
