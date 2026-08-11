import "dotenv/config";
import express from "express";
import cors from "cors";
import authRouter from "./routes/auth.js";
import zonesRouter, { syncZones } from "./routes/zones.js";
import configRouter from "./routes/config.js";
import templatesRouter from "./routes/templates.js";
import { seedAdmin, firstUser } from "./db.js";
import { hashPassword } from "./auth.js";

seedAdmin(hashPassword);

// Sync zones from PowerDNS: once at startup + every 30 minutes
const SYNC_INTERVAL = 30 * 60 * 1000;
const runSync = () => {
  const user = firstUser.get();
  if (!user) return;
  syncZones(user.id)
    .then((imported) => {
      if (imported.length > 0)
        console.log(`[sync] Imported ${imported.length} zones: ${imported.join(", ")}`);
    })
    .catch(() => {});
};
runSync();
setInterval(runSync, SYNC_INTERVAL).unref();

const app = express();
const PORT = Number(process.env.PORT || 5001);
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors()); // Vite frontend runs on a different port
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/zones", zonesRouter);
app.use("/api/config", configRouter);
app.use("/api/templates", templatesRouter);

// 404 for remaining /api routes
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Serve frontend build (production: single port)
// SERVE_FRONTEND=true, FRONTEND_DIST=path to frontend/dist
if (process.env.SERVE_FRONTEND === "true") {
  const dist =
    process.env.FRONTEND_DIST ||
    new URL("../../frontend/dist", import.meta.url).pathname;
  app.use(express.static(dist));
  // SPA fallback: non-/api routes return index.html
  app.get("*", (_req, res) => res.sendFile(`${dist}/index.html`));
}

// Final error handler — always returns { error }
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, HOST, () => {
  console.log(`DNS backend listening on http://${HOST}:${PORT}/api`);
});
