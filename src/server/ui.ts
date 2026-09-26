export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>vided studio</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background:#0d1117; color:#e6edf3; }
  header { padding: 12px 20px; border-bottom: 1px solid #21262d; display:flex; gap:12px; align-items:baseline; }
  header h1 { font-size: 16px; margin: 0; }
  header .muted { color:#8b949e; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 20px; max-width: 1200px; }
  section { background:#161b22; border:1px solid #21262d; border-radius:8px; padding:12px 14px; }
  section h2 { font-size: 13px; text-transform: uppercase; letter-spacing:.06em; color:#8b949e; margin:0 0 8px; }
  pre { white-space: pre-wrap; word-break: break-word; margin:0; font: 12px/1.5 ui-monospace, monospace; max-height: 320px; overflow:auto; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  select, input, button { background:#0d1117; color:#e6edf3; border:1px solid #30363d; border-radius:6px; padding:6px 8px; font:inherit; }
  button { cursor:pointer; background:#238636; border-color:#2ea043; }
  button.secondary { background:#21262d; border-color:#30363d; }
  .pill { padding:1px 7px; border-radius:999px; font-size:12px; border:1px solid #30363d; }
  .queued{color:#d29922}.running{color:#58a6ff}.done{color:#3fb950}.failed{color:#f85149}.cancelled{color:#8b949e}
  table { width:100%; border-collapse: collapse; }
  td, th { text-align:left; padding:4px 6px; border-bottom:1px solid #21262d; font-weight:400; }
  .full { grid-column: 1 / -1; }
</style>
</head>
<body>
<header>
  <h1>vided studio</h1>
  <span class="muted" id="root">connecting…</span>
</header>
<main>
  <section>
    <h2>Project status</h2>
    <pre id="status">loading…</pre>
  </section>
  <section>
    <h2>Manifest</h2>
    <pre id="manifest">loading…</pre>
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
      <input id="args" placeholder="extra args, e.g. --every 2" size="40" />
      <button id="run">Run</button>
    </div>
  </section>
  <section>
    <h2>Jobs</h2>
    <table id="jobs"><tbody></tbody></table>
  </section>
  <section>
    <h2>Log <span class="muted" id="logid"></span></h2>
    <pre id="log"></pre>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + r.statusText); return r.json(); }

async function loadStatus() {
  try {
    const s = await jget("/api/status");
    $("root").textContent = "project: " + s.project + "  (" + s.root + ")";
    $("status").textContent = JSON.stringify(s, null, 2);
  } catch (e) { $("status").textContent = "status unavailable: " + e.message; }
}
async function loadManifest() {
  try {
    const m = await jget("/api/manifest");
    $("manifest").textContent = JSON.stringify(m.totals, null, 2) + "\\n\\n" +
      m.assets.map(a => a.kind + "  " + a.path).join("\\n");
  } catch (e) { $("manifest").textContent = "no manifest yet (" + e.message + ")"; }
}

function jobRow(job) {
  const tr = document.createElement("tr");
  tr.innerHTML = '<td><code>' + job.id + '</code></td><td>' + job.op + ' ' + job.args.join(" ") +
    '</td><td><span class="pill ' + job.status + '">' + job.status + '</span></td>' +
    '<td><button class="secondary" data-id="' + job.id + '">logs</button></td>';
  return tr;
}
async function loadJobs() {
  const jobs = await jget("/api/jobs");
  const tb = $("jobs").querySelector("tbody");
  tb.innerHTML = "";
  for (const job of jobs.slice().reverse()) tb.appendChild(jobRow(job));
}

function stream(id) {
  $("logid").textContent = id;
  $("log").textContent = "";
  const es = new EventSource("/api/jobs/" + id + "/events");
  es.addEventListener("log", (ev) => {
    const job = JSON.parse(ev.data);
    $("log").textContent = job.logs.join("\\n");
    $("log").scrollTop = $("log").scrollHeight;
  });
  es.addEventListener("status", (ev) => {
    const job = JSON.parse(ev.data);
    $("log").textContent = job.logs.join("\\n");
    if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
      es.close(); loadJobs(); loadStatus(); loadManifest();
    }
  });
}

$("run").addEventListener("click", async () => {
  const op = $("op").value;
  const args = $("args").value.trim() ? $("args").value.trim().split(/\\s+/) : [];
  const r = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, args }) });
  if (!r.ok) { alert("failed to start: " + (await r.text())); return; }
  const job = await r.json();
  await loadJobs();
  stream(job.id);
});
$("jobs").addEventListener("click", (e) => {
  const id = e.target && e.target.getAttribute && e.target.getAttribute("data-id");
  if (id) stream(id);
});

loadStatus(); loadManifest(); loadJobs();
setInterval(loadJobs, 4000);
</script>
</body>
</html>
`;
