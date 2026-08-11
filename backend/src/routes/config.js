import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getConfig, updateConfig } from "../config.js";
import { getStatistics } from "../pdns.js";

const router = Router();
router.use(requireAuth);

// GET /config — returns current config + PowerDNS connection status
router.get("/", async (_req, res) => {
  const cfg = getConfig();
  let pdnsConnected = false;
  try {
    await Promise.race([
      getStatistics(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000)
      ),
    ]);
    pdnsConnected = true;
  } catch {
    pdnsConnected = false;
  }
  res.json({ ...cfg, pdnsConnected });
});

// PUT /config — update config
router.put("/", (req, res) => {
  const { pdnsApiUrl, pdnsApiKey, pdnsServerId, zoneKind, ns1, ns2, masterAddress, secondaries, mxHost, mailAgentUrl, mailAgentToken } = req.body || {};
  if (zoneKind !== undefined && !["Native", "Master", "Slave"].includes(zoneKind))
    return res.status(400).json({ error: "zoneKind must be Native, Master or Slave" });
  if (pdnsApiUrl !== undefined && pdnsApiUrl) {
    try {
      new URL(pdnsApiUrl);
    } catch {
      return res.status(400).json({ error: "Invalid PowerDNS API URL" });
    }
  }
  if (secondaries !== undefined) {
    try {
      const list = JSON.parse(secondaries);
      if (!Array.isArray(list)) throw new Error();
      for (const s of list) {
        if (!s.apiUrl || !s.apiKey) throw new Error();
      }
    } catch {
      return res.status(400).json({
        error: "Secondaries must be a JSON array like [{ name, apiUrl, apiKey }]",
      });
    }
  }
  const cfg = updateConfig({ pdnsApiUrl, pdnsApiKey, pdnsServerId, zoneKind, ns1, ns2, masterAddress, secondaries, mxHost, mailAgentUrl, mailAgentToken });
  res.json({ message: "Config saved", ...cfg });
});

export default router;
