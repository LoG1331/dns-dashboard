import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getConfig, updateConfig } from "../config.js";
import { getStatistics } from "../pdns.js";

const router = Router();
router.use(requireAuth);

const MASK = "••••••••";

// Return a copy of cfg with secrets masked for API responses
function maskConfig(cfg) {
  const masked = {
    ...cfg,
    pdnsApiKey: cfg.pdnsApiKey ? MASK : "",
    mailAgentToken: cfg.mailAgentToken ? MASK : "",
  };
  try {
    const list = JSON.parse(cfg.secondaries);
    if (Array.isArray(list)) {
      masked.secondaries = JSON.stringify(
        list.map((s) => ({ ...s, apiKey: s.apiKey ? MASK : "" }))
      );
    }
  } catch {
    // leave secondaries as-is if it is not valid JSON
  }
  masked.secondaryList = (cfg.secondaryList || []).map((s) => ({
    ...s,
    apiKey: s.apiKey ? MASK : "",
  }));
  return masked;
}

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
  res.json({ ...maskConfig(cfg), pdnsConnected });
});

// PUT /config — update config
router.put("/", (req, res) => {
  const { pdnsApiUrl, pdnsApiKey: rawPdnsApiKey, pdnsServerId, zoneKind, nameservers, secondaries: rawSecondaries, mxHost, mailAgentUrl, mailAgentToken: rawMailAgentToken } = req.body || {};
  // masked secrets mean "keep the current value"
  const pdnsApiKey = rawPdnsApiKey === MASK ? undefined : rawPdnsApiKey;
  const mailAgentToken = rawMailAgentToken === MASK ? undefined : rawMailAgentToken;
  let secondaries = rawSecondaries;
  if (zoneKind !== undefined && !["Native", "Master", "Slave"].includes(zoneKind))
    return res.status(400).json({ error: "zoneKind must be Native, Master or Slave" });
  if (nameservers !== undefined) {
    if (!Array.isArray(nameservers) || nameservers.length === 0 || nameservers.some((n) => typeof n !== "string" || !n.trim()))
      return res.status(400).json({ error: "nameservers must be a non-empty array of hostnames" });
  }
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
      // entries with an empty or masked apiKey keep the key of the existing
      // entry with the same name + apiUrl
      const oldByKey = new Map(
        getConfig().secondaryList.map((s) => [`${s.name}|${s.apiUrl}`, s.apiKey])
      );
      for (const s of list) {
        if (!s.apiKey || s.apiKey === MASK)
          s.apiKey = oldByKey.get(`${s.name}|${s.apiUrl}`) || "";
        if (!s.apiUrl || !s.apiKey) throw new Error();
        if (!s.ns) s.ns = `ns${list.indexOf(s) + 2}.example.com`;
      }
      secondaries = JSON.stringify(list);
    } catch {
      return res.status(400).json({
        error: "Secondaries must be a JSON array like [{ name, apiUrl, apiKey }]",
      });
    }
  }
  const cfg = updateConfig({
    pdnsApiUrl, pdnsApiKey, pdnsServerId, zoneKind,
    nameservers: nameservers === undefined ? undefined : JSON.stringify(nameservers.map((n) => n.trim())),
    secondaries, mxHost, mailAgentUrl, mailAgentToken,
  });
  res.json({ message: "Config saved", ...maskConfig(cfg) });
});

export default router;
