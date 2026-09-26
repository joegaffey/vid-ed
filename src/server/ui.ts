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
  header { padding:14px 22px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:baseline; }
  header h1 { font-size:16px; margin:0; }
  header .muted { color:var(--muted); }
  main { display:grid; grid-template-columns: 1fr 1fr; gap:16px; padding:18px 22px; max-width:1200px; margin:0 auto; }
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
  .muted { color:var(--muted); }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  select, input, button { background:#0d1117; color:#e6edf3; border:1px solid #30363d; border-radius:6px; padding:7px 9px; font:inherit; }
  button { cursor:pointer; background:#238636; border-color:#2ea043; }
  button.secondary { background:#21262d; border-color:#30363d; }
  button:disabled { opacity:.5; cursor:default; }
  .pill { padding:1px 8px; border-radius:999px; font-size:12px; border:1px solid #30363d; }
  .queued{color:#d29922}.running{color:#58a6ff}.done{color:#3fb950}.failed{color:#f85149}.cancelled{color:#8b949e}
  details { margin-top:12px; }
  summary { cursor:pointer; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  pre { white-space:pre-wrap; word-break:break-word; margin:8px 0 0; font:12px/1.5 ui-monospace, monospace; max-height:300px; overflow:auto; color:#9da7b3; }
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
    <h2>Media</h2>
    <div id="media"></div>
  </section>
  <section class="full">
    <h2>Run a stage</h2>
    <div class="row">
      <select id="op">
        <option>scan</option>
        <option>doctor</option>
        <option>status</option>
        <option>extract-text</option>
        <option>sample</option>
        <option>dedupe</option>
        <option>annotate</option>
        <option>manifest</option>
        <option>script</option>
        <option>tts</option>
        <option>captions</option>
        <option>compose</option>
        <option>render</option>
      </select>
      <input id="args" placeholder="optional arguments, e.g. --every 2" size="42" />
      <button id="run">Run</button>
      <span class="muted" id="runhint"></span>
    </div>
    <details id="tech">
      <summary>Technical output</summary>
      <pre id="log"></pre>
    </details>
  </section>
  <section>
    <h2>Jobs</h2>
    <table id="jobs"><tbody></tbody></table>
  </section>
  <section>
    <h2>Tools</h2>
    <div id="doctor" class="muted">run doctor to check</div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const fmtDur = (s) => { if (s == null) return "–"; const m = Math.floor(s / 60); const r = Math.round(s % 60); return m + ":" + String(r).padStart(2, "0"); };

async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + r.statusText); return r.json(); }

function stat(k, v) { const d = el("div", "stat"); d.appendChild(el("div", "v", v)); d.appendChild(el("div", "k", k)); return d; }

async function loadStatus() {
  try {
    const s = await jget("/api/status");
    $("root").textContent = "project: " + s.project;
    const stats = $("stats"); stats.innerHTML = "";
    stats.appendChild(stat("Assets", s.assets));
    stats.appendChild(stat("Duration", fmtDur(s.duration_s)));
    stats.appendChild(stat("Selected frames", s.unique_frames));
    stats.appendChild(stat("Annotated", s.cost ? s.cost.annotated_frames : 0));
    stats.appendChild(stat("Vision tokens", s.cost ? s.cost.estimated_vision_tokens : 0));
    stats.appendChild(stat("Saved by dedupe", s.cost ? s.cost.tokens_saved_by_dedupe : 0));
    const tools = $("tools"); tools.innerHTML = "";
    for (const [name, ok] of Object.entries(s.tools || {})) {
      tools.appendChild(el("span", "badge " + (ok ? "ok" : "missing"), name + (ok ? " ready" : " missing")));
    }
  } catch (e) { $("root").textContent = "status unavailable"; }
}

async function loadMedia() {
  const box = $("media");
  try {
    const m = await jget("/api/manifest");
    box.innerHTML = "";
    box.appendChild(el("div", "muted", m.totals.assets + " assets · " + fmtDur(m.totals.duration_s) + " · " + m.totals.unique_frames + " frames"));
    const t = el("table");
    const head = el("tr");
    for (const h of ["Kind", "Path", "Duration", "Frames", "Status"]) head.appendChild(el("th", null, h));
    t.appendChild(head);
    for (const a of m.assets) {
      const tr = el("tr");
      const sel = (a.visual && a.visual.frames ? a.visual.frames.filter(f => f.selected).length : 0);
      tr.appendChild(el("td", null, a.kind));
      tr.appendChild(el("td", null, a.path));
      tr.appendChild(el("td", null, fmtDur(a.technical && a.technical.duration_s)));
      tr.appendChild(el("td", null, String(sel)));
      tr.appendChild(el("td", "muted", a.status));
      t.appendChild(tr);
    }
    box.appendChild(t);
  } catch (e) { box.innerHTML = ""; box.appendChild(el("div", "muted", "No analysis yet — run scan to build the manifest.")); }
}

function jobRow(job) {
  const tr = el("tr");
  tr.appendChild(el("td", null, job.op + (job.args.length ? " " + job.args.join(" ") : "")));
  tr.appendChild(el("td", null, "")).appendChild(el("span", "pill " + job.status, job.status));
  const btn = el("button", "secondary", "view");
  btn.addEventListener("click", () => stream(job.id));
  const td = el("td"); td.appendChild(btn); tr.appendChild(td);
  return tr;
}
async function loadJobs() {
  const jobs = await jget("/api/jobs");
  const tb = $("jobs").querySelector("tbody"); tb.innerHTML = "";
  for (const job of jobs.slice().reverse()) tb.appendChild(jobRow(job));
}

let es = null;
function stream(id) {
  if (es) es.close();
  $("tech").open = true;
  $("log").textContent = "";
  $("runhint").textContent = "running " + id + "…";
  es = new EventSource("/api/jobs/" + id + "/events");
  es.addEventListener("log", (ev) => {
    const job = JSON.parse(ev.data);
    $("log").textContent = job.logs.join("\\n");
    $("log").scrollTop = $("log").scrollHeight;
  });
  es.addEventListener("status", (ev) => {
    const job = JSON.parse(ev.data);
    $("log").textContent = job.logs.join("\\n");
    if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
      es.close(); es = null;
      $("runhint").textContent = job.status + (job.exitCode != null ? " (exit " + job.exitCode + ")" : "");
      loadJobs(); loadStatus(); loadMedia();
    }
  });
}

$("run").addEventListener("click", async () => {
  const op = $("op").value;
  const args = $("args").value.trim() ? $("args").value.trim().split(/\\s+/) : [];
  $("runhint").textContent = "queued…";
  const r = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, args }) });
  if (!r.ok) { $("runhint").textContent = "failed to start"; return; }
  const job = await r.json();
  await loadJobs();
  stream(job.id);
});

loadStatus(); loadMedia(); loadJobs();
setInterval(loadJobs, 4000);
</script>
</body>
</html>
`;
