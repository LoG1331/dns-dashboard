// Serves the frontend from an in-memory file map (used by the bundled
// single-file build where frontend/dist is embedded as base64).

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

/**
 * @param {import("express").Express} app
 * @param {Record<string, string>} files - path -> base64 content
 */
export function serveEmbedded(app, files) {
  app.get("*", (req, res) => {
    const p = req.path === "/" ? "/index.html" : req.path;
    const b64 = files[p] ?? files["/index.html"]; // SPA fallback
    if (!b64) return res.status(404).end();
    const ext = p.slice(p.lastIndexOf("."));
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(b64, "base64"));
  });
}
