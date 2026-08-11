#!/usr/bin/env node
// zoner mail agent — tiny HTTP API on the mail server that wraps the
// mail-domain script. The zoner dashboard talks to it remotely.
//
// Env:
//   AGENT_PORT   (default 9099)
//   AGENT_TOKEN  (required — Bearer token)
//   MAIL_CMD     (default /opt/zoner-mail/mail-domain)
import http from "node:http";
import { execFile } from "node:child_process";

const PORT = Number(process.env.AGENT_PORT || 9099);
const TOKEN = process.env.AGENT_TOKEN || "";
const MAIL_CMD = process.env.MAIL_CMD || "/opt/zoner-mail/mail-domain";
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;

if (!TOKEN) {
  console.error("AGENT_TOKEN is required");
  process.exit(1);
}

const json = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};

function runMailDomain(args) {
  return new Promise((resolve, reject) => {
    execFile(MAIL_CMD, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      resolve(stdout.trim());
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const auth = req.headers.authorization || "";

  if (url.pathname === "/health") return json(res, 200, { status: "ok" });
  if (auth !== `Bearer ${TOKEN}`) return json(res, 401, { error: "Unauthorized" });

  const match = url.pathname.match(/^\/domains(?:\/([^/]+))?$/);
  if (!match) return json(res, 404, { error: "Not found" });

  try {
    if (req.method === "GET" && !match[1]) {
      const out = await runMailDomain(["list"]);
      return json(res, 200, { domains: out ? out.split("\n").filter(Boolean) : [] });
    }

    let domain = match[1];
    if (req.method === "POST" && !match[1]) {
      let body = "";
      for await (const chunk of req) body += chunk;
      domain = JSON.parse(body || "{}").domain;
    }

    domain = (domain || "").toLowerCase().replace(/\.$/, "");
    if (!DOMAIN_RE.test(domain))
      return json(res, 400, { error: "Invalid domain name" });

    if (req.method === "POST") {
      await runMailDomain(["add", domain]);
      return json(res, 201, { message: "Mail domain added" });
    }
    if (req.method === "DELETE" && match[1]) {
      await runMailDomain(["remove", domain]);
      return json(res, 200, { message: "Mail domain removed" });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`zoner mail agent listening on :${PORT}`);
});
