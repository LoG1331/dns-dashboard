import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth } from "../auth.js";
import {
  zonesByUser,
  zoneById,
  zoneByName,
  insertZone,
  updateZoneStatus,
  deleteZoneRow,
  templateById,
} from "../db.js";
import {
  createPdnsZone,
  getPdnsZone,
  deletePdnsZone,
  patchPdnsZone,
  exportPdnsZone,
  listPdnsZones,
  createSlaveZones,
  deleteSlaveZones,
  countRecords,
  PdnsError,
} from "../pdns.js";

const router = Router();
router.use(requireAuth);

// Nameservers resolved dynamically from config (DB overrides env)
import { getConfig } from "../config.js";
// Nameservers: primary NS list + NS hostname of each secondary
const NAMESERVERS = () => {
  const cfg = getConfig();
  return [
    ...cfg.nameservers,
    ...cfg.secondaryList.map((s) =>
      s.ns.endsWith(".") ? s.ns : `${s.ns}.`
    ),
  ];
};

const ALLOWED_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"];
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;
// wildcard allowed only as the leftmost label: "*" or "*.sub.domain"
const WILDCARD_RE = /^\*(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;

const fqdn = (name) => (name.endsWith(".") ? name : `${name}.`);

function zoneJson(z, recordsCount) {
  return {
    _id: z._id,
    name: z.name,
    status: z.status,
    records_count: recordsCount ?? z.records_count ?? 0,
    createdAt: z.created_at.replace(" ", "T") + "Z",
    updatedAt: z.updated_at.replace(" ", "T") + "Z",
  };
}

function ownedZone(req, res) {
  const z = zoneById.get(req.params.id);
  if (!z || z.user_id !== req.user.id) {
    res.status(404).json({ error: "Zone not found" });
    return null;
  }
  return z;
}

function pdnsError(res, err, fallback) {
  if (err instanceof PdnsError)
    return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: fallback });
}

/** Import zones present in PowerDNS but missing from DB (assigned to user, status active) */
export async function syncZones(userId) {
  try {
    const pdnsZones = await listPdnsZones();
    const imported = [];
    for (const z of pdnsZones) {
      const name = z.name.replace(/\.$/, "");
      if (!zoneByName.get(name)) {
        insertZone.run(crypto.randomUUID(), userId, name, "active");
        imported.push(name);
      }
    }
    return imported;
  } catch {
    return []; // PowerDNS unreachable → skip, zones in DB are still shown
  }
}

// ---------- POST /zones/sync (manual sync button) ----------
router.post("/sync", async (req, res) => {
  const imported = await syncZones(req.user.id);
  res.json({ message: "Sync completed", imported });
});

// ---------- GET /zones ----------
router.get("/", async (req, res) => {
  const zones = zonesByUser.all(req.user.id);
  const enriched = await Promise.all(
    zones.map(async (z) => {
      try {
        const detail = await getPdnsZone(fqdn(z.name));
        return zoneJson(z, countRecords(detail));
      } catch {
        return zoneJson(z, 0);
      }
    })
  );
  res.json({ zones: enriched });
});

// ---------- POST /zones ----------
router.post("/", async (req, res) => {
  const name = (req.body?.name || "").trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(name))
    return res.status(400).json({ error: "Invalid domain name" });

  if (zoneByName.get(name))
    return res.status(409).json({ error: "Domain already registered" });

  try {
    await createPdnsZone(fqdn(name), NAMESERVERS());
  } catch (err) {
    return pdnsError(res, err, "Failed to create zone");
  }

  // Create slave zones on secondaries (errors don't block zone creation)
  const slaveErrors = await createSlaveZones(fqdn(name));

  // Apply template records if provided
  const templateId = req.body?.template_id;
  if (templateId) {
    const tpl = templateById.get(templateId);
    if (!tpl) {
      deletePdnsZone(fqdn(name)).catch(() => {});
      return res.status(404).json({ error: "Template not found" });
    }
    const apex = fqdn(name);
    const records = JSON.parse(tpl.records);
    // Group records by (name, type) into rrsets
    const rrsetMap = new Map();
    for (const r of records) {
      const rname =
        r.name === "@" ? apex : fqdn(`${r.name}.${name}`);
      const key = `${rname}|${r.type}`;
      if (!rrsetMap.has(key)) {
        rrsetMap.set(key, {
          name: rname,
          type: r.type,
          ttl: Number(r.ttl) || 3600,
          changetype: "REPLACE",
          records: [],
        });
      }
      rrsetMap
        .get(key)
        .records.push({
          content: absolutize(String(r.content).trim(), r.type, apex),
          disabled: false,
        });
    }
    try {
      await patchPdnsZone(apex, [...rrsetMap.values()]);
    } catch (err) {
      return pdnsError(res, err, "Zone created but failed to apply template");
    }
  }

  const id = crypto.randomUUID();
  insertZone.run(id, req.user.id, name, "pending_verification");
  res.status(201).json({
    message: "Zone created",
    _id: id,
    secondaryErrors: slaveErrors.length ? slaveErrors : undefined,
  });
});

// ---------- GET /zones/:id ----------
router.get("/:id", async (req, res) => {
  const z = ownedZone(req, res);
  if (!z) return;
  try {
    const detail = await getPdnsZone(fqdn(z.name));
    res.json(zoneJson(z, countRecords(detail)));
  } catch (err) {
    if (err instanceof PdnsError && err.status === 404)
      return res.status(404).json({ error: "Zone not found on DNS server" });
    return pdnsError(res, err, "Unable to load zone");
  }
});

// ---------- DELETE /zones/:id ----------
router.delete("/:id", async (req, res) => {
  const z = ownedZone(req, res);
  if (!z) return;
  try {
    await deletePdnsZone(fqdn(z.name));
  } catch (err) {
    if (!(err instanceof PdnsError && err.status === 404))
      return pdnsError(res, err, "Failed to delete zone");
  }
  // Delete slave zones on secondaries (errors don't block zone deletion)
  await deleteSlaveZones(fqdn(z.name));
  deleteZoneRow.run(z._id);
  res.json({ message: "Zone deleted" });
});

// ---------- GET /zones/:id/records ----------
router.get("/:id/records", async (req, res) => {
  const z = ownedZone(req, res);
  if (!z) return;
  const q = (req.query.q || "").toLowerCase();
  const max = Math.min(Number(req.query.max) || 100, 1000);
  try {
    const detail = await getPdnsZone(fqdn(z.name));
    let rrsets = detail.rrsets.map((r) => ({
      name: r.name,
      type: r.type,
      ttl: r.ttl,
      records: r.records.map((rec) => ({ content: rec.content })),
    }));
    if (q) {
      rrsets = rrsets.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q) ||
          r.records.some((rec) => rec.content.toLowerCase().includes(q))
      );
    }
    res.json(rrsets.slice(0, max));
  } catch (err) {
    return pdnsError(res, err, "Unable to load records");
  }
});

// ---------- Validation for records ----------
function validateRecord(zoneName, { type, name, content, ttl }) {
  if (!ALLOWED_TYPES.includes(type))
    return `Record type ${type} is not supported`;
  if (!name || (name.includes("*") && !WILDCARD_RE.test(name)))
    return "Invalid record name";
  if (!content) return "Record content is required";
  ttl = Number(ttl);
  if (!Number.isInteger(ttl) || ttl < 3600)
    return "TTL must be at least 3600 seconds";

  if (type === "A" && !/^(\d{1,3}\.){3}\d{1,3}$/.test(content))
    return "Invalid IPv4 address";
  if (type === "AAAA" && !content.includes(":")) return "Invalid IPv6 address";
  if (type === "MX" && !/^\d{1,5}\s+\S+$/.test(content))
    return "MX must be: <priority> <host>";
  if (type === "SRV" && !/^\d{1,5}\s+\d{1,5}\s+\d{1,5}\s+\S+$/.test(content))
    return "SRV must be: <priority> <weight> <port> <target>";
  if (type === "CAA" && !/^\d{1,3}\s+(issue|issuewild|iodef)\s+".*"$/.test(content))
    return 'CAA must be: <flags> <tag> "<value>"';
  return null;
}

/** Normalize hostname in content to FQDN (CNAME/MX/SRV) */
function absolutize(content, type, apex) {
  const fix = (host) =>
    host === "@"
      ? apex
      : host.endsWith(".")
        ? host
        : host.includes(".")
          ? `${host}.`
          : `${host}.${apex}`;
  if (type === "CNAME") return fix(content);
  if (type === "MX") {
    const [prio, ...rest] = content.split(/\s+/);
    return `${prio} ${fix(rest.join(" "))}`;
  }
  if (type === "SRV") {
    const [prio, weight, port, ...rest] = content.split(/\s+/);
    return `${prio} ${weight} ${port} ${fix(rest.join(" "))}`;
  }
  if (type === "TXT" && !content.startsWith('"')) return `"${content}"`;
  return content;
}

// ---------- POST /zones/:id/records ----------
router.post("/:id/records", async (req, res) => {
  const z = ownedZone(req, res);
  if (!z) return;
  if (z.status !== "active")
    return res
      .status(400)
      .json({ error: "Complete your setup before adding records" });

  const { type, name, content, ttl } = req.body || {};
  const errMsg = validateRecord(z.name, { type, name, content, ttl });
  if (errMsg) return res.status(400).json({ error: errMsg });

  const apex = fqdn(z.name);
  const recordName = name === "@" ? apex : fqdn(`${name}.${z.name}`);
  const finalContent = absolutize(content.trim(), type, apex);

  try {
    const detail = await getPdnsZone(apex);
    const existing = detail.rrsets.find(
      (r) => r.name === recordName && r.type === type
    );
    const records = existing ? [...existing.records] : [];
    if (records.some((r) => r.content === finalContent))
      return res.status(409).json({ error: "Record already exists" });
    records.push({ content: finalContent, disabled: false });

    await patchPdnsZone(apex, [
      {
        name: recordName,
        type,
        ttl: Number(ttl),
        changetype: "REPLACE",
        records,
      },
    ]);
    res.status(201).json({ message: "Record added" });
  } catch (err) {
    return pdnsError(res, err, "Failed to add record");
  }
});

// ---------- DELETE /zones/:id/records ----------
router.delete("/:id/records", async (req, res) => {
  const z = ownedZone(req, res);
  if (!z) return;
  if (z.status !== "active")
    return res
      .status(400)
      .json({ error: "Complete your setup before managing records" });

  const { name, type, content } = req.body || {};
  if (!name || !type)
    return res.status(400).json({ error: "Missing record name or type" });

  const apex = fqdn(z.name);
  const recordName = fqdn(name);

  // Don't allow deleting SOA and apex NS
  if (type === "SOA" || (type === "NS" && recordName === apex))
    return res.status(400).json({ error: "Cannot delete this record" });

  try {
    const detail = await getPdnsZone(apex);
    const rrset = detail.rrsets.find(
      (r) => r.name === recordName && r.type === type
    );
    if (!rrset) return res.status(404).json({ error: "Record not found" });

    const remaining =
      content == null
        ? []
        : rrset.records.filter((r) => r.content !== content);

    if (content != null && remaining.length === rrset.records.length)
      return res.status(404).json({ error: "Record not found" });

    await patchPdnsZone(apex, [
      remaining.length === 0
        ? { name: recordName, type, changetype: "DELETE", records: [] }
        : {
            name: recordName,
            type,
            ttl: rrset.ttl,
            changetype: "REPLACE",
            records: remaining,
          },
    ]);
    res.json({ message: "Record deleted" });
  } catch (err) {
    return pdnsError(res, err, "Failed to delete record");
  }
});

// ---------- POST /zones/:id/verify (check NS delegation) ----------
router.post("/:id/verify", async (req, res) => {
  const z = ownedZone(req, res);
  if (!z) return;
  try {
    const resp = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(z.name)}&type=NS`
    );
    const data = await resp.json();
    const current = (data.Answer || [])
      .filter((a) => a.type === 2)
      .map((a) => a.data);
    const currentLower = current.map((ns) => ns.toLowerCase());
    const required = NAMESERVERS().map((ns) => ns.toLowerCase());
    const ok = required.every((ns) => currentLower.includes(ns));

    if (!ok) {
      return res.status(400).json({
        error: `Nameservers are not pointing to ${required.join(" and ")} yet`,
        current,
      });
    }
    updateZoneStatus.run("active", z._id);
    res.json({ message: "Zone verified successfully", current });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Unable to check nameservers right now" });
  }
});

// ---------- GET /zones/:id/export ----------
router.get("/:id/export", async (req, res) => {
  const z = ownedZone(req, res);
  if (!z) return;
  try {
    const text = await exportPdnsZone(fqdn(z.name));
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${z.name}.zone"`
    );
    res.send(text);
  } catch (err) {
    return pdnsError(res, err, "Failed to export zone");
  }
});

export default router;
