// Dynamic config: stored in DB, edited from the Settings page.
// Sensitive values (API keys, tokens) are encrypted at rest with
// AES-256-GCM, key derived from JWT_SECRET.
import "dotenv/config"; // also load .env when used from standalone scripts
import crypto from "node:crypto";
import { getSetting, setSetting } from "./db.js";

export const CONFIG_KEYS = [
  "pdnsApiUrl",
  "pdnsApiKey",
  "pdnsServerId",
  "zoneKind",
  "nameservers", // JSON array of NS hostnames — default: just the primary's
  "secondaries", // JSON: [{ name, apiUrl, apiKey, ns }]
  "mxHost", // mail receiver hostname (e.g. mx.example.com) — empty = mail off
  "mailAgentUrl", // zoner mail agent URL on the mail server
  "mailAgentToken", // Bearer token of the mail agent
];

// Keys encrypted at rest
const SECRET_KEYS = new Set(["pdnsApiKey", "mailAgentToken", "secondaries"]);

const DEFAULTS = {
  pdnsApiUrl: "http://127.0.0.1:8081",
  pdnsApiKey: "",
  pdnsServerId: "localhost",
  zoneKind: "Native",
  nameservers: '["ns1.example.com"]',
  secondaries: "[]",
  mxHost: "",
  mailAgentUrl: "",
  mailAgentToken: "",
};

// ---------- AES-256-GCM at rest ----------
const encKey = () =>
  crypto
    .createHash("sha256")
    .update(process.env.JWT_SECRET || "zoner-insecure-default")
    .digest();

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

function decrypt(value) {
  if (!value.startsWith("enc:v1:")) return value; // legacy plaintext
  const [, , iv, tag, ct] = value.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encKey(),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const readKey = (key) => {
  const v = getSetting(key);
  if (v == null || v === "") return null;
  return SECRET_KEYS.has(key) ? decrypt(v) : v;
};

const writeKey = (key, value) =>
  setSetting(key, SECRET_KEYS.has(key) && value !== "" ? encrypt(value) : value);

export function getConfig() {
  const cfg = {};
  for (const key of CONFIG_KEYS) {
    cfg[key] = readKey(key) ?? DEFAULTS[key];
  }
  cfg.pdnsApiUrl = cfg.pdnsApiUrl.replace(/\/$/, "");

  // Nameservers: new `nameservers` key, migrated from legacy ns1/ns2
  let ns;
  try {
    ns = JSON.parse(cfg.nameservers);
    if (!Array.isArray(ns)) ns = [];
  } catch {
    ns = [];
  }
  if (ns.length === 0) {
    const legacy = [readKey("ns1"), readKey("ns2")].filter(Boolean);
    ns = legacy.length ? legacy : ["ns1.example.com"];
  }
  cfg.nameserverList = ns;
  // FQDN form used when talking to PowerDNS
  cfg.nameservers = ns.map((n) => (n.endsWith(".") ? n : `${n}.`));

  // Master address for AXFR: legacy override from DB, else derive from the API URL host
  const legacyMaster = readKey("masterAddress");
  if (legacyMaster) {
    cfg.masterAddress = legacyMaster;
  } else {
    try {
      cfg.masterAddress = new URL(cfg.pdnsApiUrl).hostname;
    } catch {
      cfg.masterAddress = "127.0.0.1";
    }
  }

  try {
    cfg.secondaryList = JSON.parse(cfg.secondaries);
  } catch {
    cfg.secondaryList = [];
  }
  // Legacy secondaries may lack `ns` — suggest nsN.<domain of ns1>
  const baseDomain = (cfg.nameserverList[0] || "example.com").split(".").slice(1).join(".") || "example.com";
  cfg.secondaryList = cfg.secondaryList.map((s, i) => ({
    ...s,
    ns: s.ns || `ns${i + 2}.${baseDomain}`,
  }));
  return cfg;
}

export function updateConfig(values) {
  for (const key of CONFIG_KEYS) {
    // skip keys not present in the request — undefined means "don't touch"
    if (key in values && values[key] !== undefined)
      writeKey(key, String(values[key]));
  }
  return getConfig();
}
