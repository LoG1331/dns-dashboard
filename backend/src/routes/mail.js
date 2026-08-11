// Mail domains: quản lý /etc/postfix/transport qua script mail-domain
// (chạy cùng máy với Postfix — xem docs/SETUP-PDNS.md).
// Cần sudoers NOPASSWD cho lệnh mail-domain với user chạy backend:
//   <user> ALL=(root) NOPASSWD: /usr/local/sbin/mail-domain
import { Router } from "express";
import { execFile } from "node:child_process";
import { requireAuth } from "../auth.js";
import { getConfig } from "../config.js";
import { zoneByName, zonesByUser } from "../db.js";
import { getPdnsZone, patchPdnsZone, PdnsError } from "../pdns.js";

const router = Router();
router.use(requireAuth);

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;

const mailCmd = () => getConfig().mailCmd || "/usr/local/sbin/mail-domain";

function runMailDomain(args) {
  return new Promise((resolve, reject) => {
    // execFile không qua shell → an toàn với input
    execFile(
      "sudo",
      ["-n", mailCmd(), ...args],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim()));
        resolve(stdout.trim());
      }
    );
  });
}

// GET /mail/domains
router.get("/domains", async (_req, res) => {
  try {
    const out = await runMailDomain(["list"]);
    res.json({ domains: out ? out.split("\n").filter(Boolean) : [] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** Nếu domain trùng với 1 zone đang quản lý → tự thêm MX record về mxHost */
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
    await runMailDomain(["add", domain]);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  // Tự thêm MX record nếu zone tồn tại trong dashboard
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
    await runMailDomain(["remove", domain]);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  res.json({ message: "Mail domain removed" });
});

export default router;
