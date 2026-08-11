// Dynamic config: stored in DB, edited from the Settings page
import { getSetting, setSetting } from "./db.js";

export const CONFIG_KEYS = [
  "pdnsApiUrl",
  "pdnsApiKey",
  "pdnsServerId",
  "zoneKind",
  "ns1",
  "ns2",
  "masterAddress", // IP/hostname secondaries use to AXFR from master
  "secondaries", // JSON: [{ name, apiUrl, apiKey }]
  "mxHost", // hostname nhận mail (vd mx.example.com) — trống = tắt tính năng mail
  "mailCmd", // đường dẫn script mail-domain
];

const DEFAULTS = {
  pdnsApiUrl: "http://127.0.0.1:8081",
  pdnsApiKey: "",
  pdnsServerId: "localhost",
  zoneKind: "Native",
  ns1: "ns1.example.com",
  ns2: "ns2.example.com",
  masterAddress: "127.0.0.1",
  secondaries: "[]",
  mxHost: "",
  mailCmd: "/usr/local/sbin/mail-domain",
};

export function getConfig() {
  const cfg = {};
  for (const key of CONFIG_KEYS) {
    const fromDb = getSetting(key);
    cfg[key] = fromDb != null && fromDb !== "" ? fromDb : DEFAULTS[key];
  }
  cfg.pdnsApiUrl = cfg.pdnsApiUrl.replace(/\/$/, "");
  cfg.nameservers = [cfg.ns1, cfg.ns2]
    .filter(Boolean)
    .map((ns) => (ns.endsWith(".") ? ns : `${ns}.`));
  try {
    cfg.secondaryList = JSON.parse(cfg.secondaries);
  } catch {
    cfg.secondaryList = [];
  }
  return cfg;
}

export function updateConfig(values) {
  for (const key of CONFIG_KEYS) {
    if (key in values) setSetting(key, String(values[key] ?? ""));
  }
  return getConfig();
}
