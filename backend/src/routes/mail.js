// Mail domains: remote control of the mail receiver via the zoner mail agent
// (HTTP + Bearer token, same pattern as PowerDNS API). The agent runs on the
// mail server and manages /etc/postfix/transport — see docs/MAIL.md.
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getConfig } from "../config.js";
import { zoneByName } from "../db.js";
import { getPdnsZone, patchPdnsZone, PdnsError } from "../pdns.js";

const router = Router();
router.use(requireAuth);

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;

async function agentRequest(method, path, body) {
  const cfg = getConfig();
  if (!cfg.mailAgentUrl || !cfg.mailAgentToken) {
    const err = new Error(
      "Mail agent is not configured — set Agent URL + token in Settings"
    );
    err.status = 400;
    throw err;
  }
  let res;
  try {
    res = await fetch(`${cfg.mailAgentUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.mailAgentToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    const err = new Error(`Cannot reach mail agent at ${cfg.mailAgentUrl}`);
    err.status = 502;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Mail agent error ${res.status}`);
    err.status = res.status === 401 ? 502 : res.status;
    throw err;
  }
  return data;
}

// GET /mail/domains
router.get("/domains", async (_req, res) => {
  try {
    res.json(await agentRequest("GET", "/domains"));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** If the domain matches a managed zone → auto-create MX record to mxHost */
async function ensureMxRecord(domain, userId) {
  const cfg = getConfig();
  if (!cfg.mxHost) return null;
  const z = zoneByName.get(domain);
  if (!z || z.user_id !== userId) return null;
  const apex = domain.endsWith(".") ? domain : `${domain}.`;
  const mxTarget = cfg.mxHost.endsWith(".") ? cfg.mxHost : `${cfg.mxHost}.`;
  const detail = await getPdnsZone(apex);
  const existing = detail.rrsets.find((r) => r.name === apex && r.type === "MX");
  const records = existing ? [...existing.records] : [];
  const content = `10 ${mxTarget}`;
  if (records.some((r) => r.content === content)) return null;
  records.push({ content, disabled: false });
  await patchPdnsZone(apex, [
    { name: apex, type: "MX", ttl: 3600, changetype: "REPLACE", records },
  ]);
  return content;
}

// POST /mail/domains { domain }
router.post("/domains", async (req, res) => {
  const domain = (req.body?.domain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(domain))
    return res.status(400).json({ error: "Invalid domain name" });
  try {
    await agentRequest("POST", "/domains", { domain });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
  // Auto-create the MX record if the zone is managed in the dashboard
  let mx = null;
  try {
    mx = await ensureMxRecord(domain, req.user.id);
  } catch (err) {
    if (!(err instanceof PdnsError)) throw err;
  }
  res.status(201).json({ message: "Mail domain added", mx });
});

// DELETE /mail/domains/:domain
router.delete("/domains/:domain", async (req, res) => {
  const domain = req.params.domain.toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(domain))
    return res.status(400).json({ error: "Invalid domain name" });
  try {
    await agentRequest("DELETE", `/domains/${domain}`);
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
  res.json({ message: "Mail domain removed" });
});

export default router;
