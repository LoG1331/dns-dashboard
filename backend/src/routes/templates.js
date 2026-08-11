import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth } from "../auth.js";
import {
  templatesAll,
  templateById,
  insertTemplate,
  updateTemplate,
  deleteTemplateRow,
} from "../db.js";

const router = Router();
router.use(requireAuth);

const ALLOWED_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA", "NS", "PTR"];

function templateJson(t) {
  return {
    id: t.id,
    name: t.name,
    records: JSON.parse(t.records),
    createdAt: t.created_at.replace(" ", "T") + "Z",
  };
}

// GET /templates
router.get("/", (_req, res) => {
  res.json(templatesAll.all().map(templateJson));
});

// POST /templates { name, records: [{name, type, ttl, content}] }
router.post("/", (req, res) => {
  const { name, records } = req.body || {};
  if (!name?.trim())
    return res.status(400).json({ error: "Template name is required" });
  if (!Array.isArray(records))
    return res.status(400).json({ error: "Records must be an array" });

  for (const r of records) {
    if (!r.name || !ALLOWED_TYPES.includes(r.type))
      return res
        .status(400)
        .json({ error: `Invalid record: ${r.name || "?"} ${r.type || "?"}` });
    if (!r.content)
      return res.status(400).json({ error: `Record ${r.name} missing content` });
    r.ttl = Number(r.ttl) || 3600;
  }

  const id = crypto.randomUUID();
  try {
    insertTemplate.run(id, name.trim(), "", JSON.stringify(records));
  } catch {
    return res.status(409).json({ error: "Template name already exists" });
  }
  res.status(201).json(templateJson(templateById.get(id)));
});

// GET /templates/:id
router.get("/:id", (req, res) => {
  const t = templateById.get(req.params.id);
  if (!t) return res.status(404).json({ error: "Template not found" });
  res.json(templateJson(t));
});

// PUT /templates/:id { name?, records? }
router.put("/:id", (req, res) => {
  const t = templateById.get(req.params.id);
  if (!t) return res.status(404).json({ error: "Template not found" });
  const { name, records } = req.body || {};
  if (records !== undefined) {
    if (!Array.isArray(records))
      return res.status(400).json({ error: "Records must be an array" });
    for (const r of records) {
      if (!r.name || !ALLOWED_TYPES.includes(r.type))
        return res
          .status(400)
          .json({ error: `Invalid record: ${r.name || "?"} ${r.type || "?"}` });
      if (!r.content)
        return res
          .status(400)
          .json({ error: `Record ${r.name} missing content` });
      r.ttl = Number(r.ttl) || 3600;
    }
  }
  updateTemplate.run(
    name !== undefined ? name.trim() : t.name,
    "",
    records !== undefined ? JSON.stringify(records) : t.records,
    t.id
  );
  res.json(templateJson(templateById.get(t.id)));
});

// DELETE /templates/:id
router.delete("/:id", (req, res) => {
  if (!templateById.get(req.params.id))
    return res.status(404).json({ error: "Template not found" });
  deleteTemplateRow.run(req.params.id);
  res.json({ message: "Template deleted" });
});

export default router;
