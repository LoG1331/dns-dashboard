// PowerDNS HTTP API client (backend holds the API key, users never see it)
// Inspired by how PowerDNS-Admin forwards requests down to PowerDNS.
// Config is read dynamically from DB (Settings page) or env — see config.js

import { getConfig } from "./config.js";

const base = () => {
  const cfg = getConfig();
  return `${cfg.pdnsApiUrl}/api/v1/servers/${cfg.pdnsServerId}`;
};

export class PdnsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        "X-API-Key": getConfig().pdnsApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new PdnsError(502, "Cannot connect to PowerDNS API");
  }
  if (!res.ok) {
    let message = `PowerDNS error ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new PdnsError(res.status, message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const createPdnsZone = (name, nameservers, rrsets) =>
  request("POST", "/zones", {
    name,
    kind: getConfig().zoneKind, // Master if replication to secondaries is needed
    nameservers,
    // without a SOA in the request, PowerDNS seeds its placeholder
    // (a.misconfigured.dns.server.invalid.) — see default-soa-content
    ...(rrsets ? { rrsets } : {}),
  });

export const getPdnsZone = (name) =>
  request("GET", `/zones/${encodeURIComponent(name)}`);

export const deletePdnsZone = (name) =>
  request("DELETE", `/zones/${encodeURIComponent(name)}`);

export const patchPdnsZone = (name, rrsets) =>
  request("PATCH", `/zones/${encodeURIComponent(name)}`, { rrsets });

export async function exportPdnsZone(name) {
  const res = await fetch(
    `${base()}/zones/${encodeURIComponent(name)}/export`,
    {
      headers: { "X-API-Key": getConfig().pdnsApiKey, Accept: "text/plain" },
    }
  );
  if (!res.ok) throw new PdnsError(res.status, `Failed to export zone ${name}`);
  return res.text();
}

export const getStatistics = () => request("GET", "/statistics");

export const listPdnsZones = () => request("GET", "/zones");

// ---------- Secondary (slave) servers ----------

async function secondaryRequest(sec, method, path, body) {
  const res = await fetch(
    `${sec.apiUrl.replace(/\/$/, "")}/api/v1/servers/localhost${path}`,
    {
      method,
      headers: {
        "X-API-Key": sec.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    }
  );
  if (!res.ok) {
    let message = `secondary ${sec.name || sec.apiUrl} error ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = `${sec.name}: ${data.error}`;
    } catch {}
    throw new PdnsError(res.status, message);
  }
  return res.status === 204 ? null : res.json();
}

/** Create slave zone on all secondaries. Returns a list of errors (if any). */
export async function createSlaveZones(name) {
  const cfg = getConfig();
  const errors = [];
  for (const sec of cfg.secondaryList) {
    try {
      await secondaryRequest(sec, "POST", "/zones", {
        name,
        kind: "Slave",
        masters: [cfg.masterAddress],
        nameservers: [],
      });
    } catch (err) {
      errors.push(err.message);
    }
  }
  return errors;
}

/** Delete slave zone on all secondaries (ignores 404). */
export async function deleteSlaveZones(name) {
  const cfg = getConfig();
  const errors = [];
  for (const sec of cfg.secondaryList) {
    try {
      await secondaryRequest(
        sec,
        "DELETE",
        `/zones/${encodeURIComponent(name)}`
      );
    } catch (err) {
      if (err.status !== 404) errors.push(err.message);
    }
  }
  return errors;
}

/** Count "user-visible" records (excludes SOA and apex NS) */
export function countRecords(zoneDetail) {
  const apex = zoneDetail.name;
  return zoneDetail.rrsets
    .filter(
      (r) => r.type !== "SOA" && !(r.type === "NS" && r.name === apex)
    )
    .reduce((acc, r) => acc + r.records.length, 0);
}
