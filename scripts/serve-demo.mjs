import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

/**
 * Serve the built static studio demo (dist/studio-demo) with HTTP Range
 * support. Plain `python3 -m http.server` ignores Range, so the browser can't
 * seek the master video and scrubbing appears broken. GitHub Pages (and the
 * live studio's own file server) support Range; this is for local preview only.
 *
 *   npm run build:studio && npm run build:studio-demo && npm run serve:demo
 */
const ROOT = process.argv[3] ?? process.env.DEMO_ROOT ?? "dist/studio-demo";
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8803);

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};

// The static demo's API files have no extension: image sources live under
// api/media/, everything else there is JSON.
function typeFor(abs) {
  const ext = extname(abs).toLowerCase();
  if (TYPES[ext]) return TYPES[ext];
  return abs.includes(`${join("api", "media")}`) ? "image/png" : "application/json";
}

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";
  const abs = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404);
    return res.end("not found");
  }
  const st = statSync(abs);
  const type = typeFor(abs);
  const m = req.headers.range ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null;
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : st.size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Content-Length": end - start + 1,
    });
    return createReadStream(abs, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes" });
  createReadStream(abs).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`studio demo (range-enabled) → http://127.0.0.1:${PORT}/  [${ROOT}]`);
});
