// webhook.js — Haraka plugin: accept mail for domains in host_list and
// forward to a webhook (and/or a local handler script). Replaces the old
// Postfix pipe forwarder.
//
// Accept domains: the rcpt hook below reads config/host_list directly
// (managed remotely by the zoner mail agent) — changes take effect
// immediately, no reload, no restart.
//
// Delivery config: /opt/zoner-mail/mail-forwarder.json (same schema as the
// old postfix pipe):
//   { "target_url": "...", "auth_token": "...", "worker_name": "haraka",
//     "headers": { "X-Custom": "..." },      // extra headers (optional)
//     "body_format": "raw|base64|json",
//     "handler": "script-from-handlers-dir" } // optional, runs BEFORE webhook
//
// Failure semantics: handler exit != 0 or webhook not 2xx → DENYSOFT (4xx),
// the sending MTA retries. Nothing is queued locally.
//
// Sandbox notes (Haraka runs plugins in a vm with restricted globals):
//   - no fetch / AbortSignal  → use core http/https (see post())
//   - txn.message_stream is NOT a standard Readable — data only flows
//     through its custom pipe() method (see readRaw())
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Writable } = require('stream');
const http = require('http');
const https = require('https');

const CONFIG_FILE = process.env.FORWARDER_CONFIG || '/opt/zoner-mail/mail-forwarder.json';
const HANDLERS_DIR = process.env.HANDLERS_DIR || '/opt/zoner-mail/handlers';
const HOST_LIST = process.env.HOST_LIST || '/opt/zoner-mail/haraka/config/host_list';
const HANDLER_RE = /^[A-Za-z0-9._-]+$/;
const MAX_ERROR_BODY = 500;

exports.register = function () {
  this.register_hook('rcpt', 'check_host_list');
  this.register_hook('queue', 'forward_all');
};

// Accept any recipient whose domain is in host_list. Read per-RCPT instead of
// relying on Haraka's config watcher — the agent's edits take effect
// immediately and there is no reload race (a 550 here is a HARD bounce).
exports.check_host_list = function (next, connection, params) {
  const txn = connection.transaction;
  if (!txn) return next();
  const rcpt = params[0];
  if (!rcpt.host) return next(); // RCPT TO without @ — not ours
  let domains = [];
  try {
    domains = fs.readFileSync(HOST_LIST, 'utf8')
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'));
  } catch (e) { /* missing file = no domains */ }
  if (domains.includes(rcpt.host.toLowerCase())) return next(OK);
  return next();
};

function loadConfig () {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function clean (value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

// message_stream is a custom stream: data flows only through its pipe().
// Default pipe options are right for us: CRLF line endings, dot-unstuffed.
function readRaw (txn) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({
      write (chunk, enc, cb) { chunks.push(Buffer.from(chunk)); cb(); },
    });
    sink.once('finish', () => resolve(Buffer.concat(chunks)));
    sink.once('error', reject);
    txn.message_stream.pipe(sink);
  });
}

function runHandler (name, sender, recipient, domain, raw) {
  return new Promise((resolve, reject) => {
    // only plain basenames from the handlers dir — never a remote-supplied path
    if (!HANDLER_RE.test(name) || name !== path.basename(name)) {
      return reject(new Error(`Invalid handler name: ${name}`));
    }
    const script = path.join(HANDLERS_DIR, name);
    if (!fs.existsSync(script)) {
      return reject(new Error(`Handler not found: ${name}`));
    }
    const proc = spawn(script, [], {
      env: {
        ...process.env,
        EMAIL_ENVELOPE_FROM: sender,
        EMAIL_ENVELOPE_TO: recipient,
        EMAIL_DOMAIN: domain,
        EMAIL_SIZE: String(raw.length),
      },
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Handler ${name} timed out`));
    }, 60000);
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`Handler ${name} exited ${code}`));
    });
    proc.stdin.write(raw);
    proc.stdin.end();
  });
}

function buildBody (cfg, txn, raw, sender, recipient, domain) {
  const fmt = cfg.body_format || 'raw';
  const receivedAt = new Date().toISOString();
  if (fmt === 'base64') {
    return [JSON.stringify({
      data: raw.toString('base64'),
      from: sender,
      to: recipient,
      domain,
      received_at: receivedAt,
    }), 'application/json'];
  }
  if (fmt === 'json') {
    let text = '';
    try { text = (txn.body && txn.body.bodytext) || ''; } catch (e) { text = ''; }
    return [JSON.stringify({
      from: sender,
      to: recipient,
      domain,
      subject: clean(txn.header.get_decoded('Subject')),
      date: clean(txn.header.get('Date')),
      text,
      received_at: receivedAt,
    }), 'application/json'];
  }
  return [raw, 'message/rfc822']; // raw
}

// core http/https with manual timeout — the plugin sandbox has no fetch
function post (target, headers, body) {
  return new Promise((resolve, reject) => {
    const mod = target.startsWith('https:') ? https : http;
    const req = mod.request(target, { method: 'POST', headers }, (res) => {
      let errBody = '';
      res.on('data', (c) => {
        if (errBody.length < MAX_ERROR_BODY) errBody += c.toString();
      });
      res.on('end', () => resolve({ status: res.statusCode, errBody }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('webhook timeout')));
    req.once('error', reject);
    req.write(body);
    req.end();
  });
}

async function postWebhook (plugin, cfg, txn, raw, sender, recipient) {
  const target = cfg.target_url;
  if (!target) return; // no webhook configured — handler-only mode
  const domain = recipient.includes('@') ? recipient.split('@').pop().toLowerCase() : '';
  const headers = {
    'X-Email-Envelope-From': sender,
    'X-Email-Envelope-To': recipient,
    'X-Email-Worker-Name': clean(cfg.worker_name || 'haraka'),
    'X-Email-Received-At': new Date().toISOString(),
    'X-Email-Size': String(raw.length),
  };
  if (domain) headers['X-Email-Domain'] = domain;
  if (cfg.auth_token) headers.Authorization = `Bearer ${cfg.auth_token}`;
  if (cfg.headers && typeof cfg.headers === 'object') {
    for (const [k, v] of Object.entries(cfg.headers)) headers[clean(k)] = clean(v);
  }
  const [body, contentType] = buildBody(cfg, txn, raw, sender, recipient, domain);
  headers['Content-Type'] = contentType;

  const res = await post(target, headers, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${res.errBody}`);
  }
  plugin.loginfo(`Forwarded ${recipient} -> ${target}`);
}

exports.forward_all = async function (next, connection) {
  const plugin = this;
  const txn = connection.transaction;
  const cfg = loadConfig();
  if (!cfg) {
    plugin.logerror('forwarder config unreadable: ' + CONFIG_FILE);
    return next(DENYSOFT, 'forwarder config error, retry later');
  }

  let raw;
  try {
    raw = await readRaw(txn);
  } catch (e) {
    plugin.logerror('message read error: ' + e.message);
    return next(DENYSOFT, 'message read error, retry later');
  }

  const sender = txn.mail_from.format();
  // one delivery per recipient (mirrors the old postfix recipient_limit=1)
  for (const rcpt of txn.rcpt_to) {
    const recipient = rcpt.format();
    const domain = recipient.includes('@') ? recipient.split('@').pop().toLowerCase() : '';
    try {
      if (cfg.handler) await runHandler(cfg.handler, sender, recipient, domain, raw);
      await postWebhook(plugin, cfg, txn, raw, sender, recipient);
    } catch (e) {
      plugin.logerror(`${recipient}: ${e.message}`);
      return next(DENYSOFT, 'forward failed, retry later');
    }
  }
  return next(OK);
};
