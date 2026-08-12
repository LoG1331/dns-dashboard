#!/usr/bin/env python3
# zoner mail agent — tiny HTTP API on the mail server that manages the
# Haraka host_list (accepted domains) and the webhook forwarder config.
# The zoner dashboard talks to it remotely.
#
# Security model: everything runs as an unprivileged user — no root, no
# sudo. The dashboard can manage mail domains and the webhook forwarder
# config, but it can NEVER set an arbitrary command — only pick a
# pre-installed handler from the handlers dir (managed locally).
#
# Env:
#   AGENT_HOST     (default 0.0.0.0 — bind a private IP + firewall instead!)
#   AGENT_PORT     (default 9099)
#   AGENT_TOKEN    (required — Bearer token)
#   HOST_LIST      (default /opt/zoner-mail/haraka/config/host_list;
#                   the Haraka webhook plugin reads it on every RCPT,
#                   so edits take effect immediately)
#   FORWARDER_CONFIG (default /opt/zoner-mail/mail-forwarder.json)
#   HANDLERS_DIR   (default /opt/zoner-mail/handlers)

import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("AGENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("AGENT_PORT", "9099"))
TOKEN = os.environ.get("AGENT_TOKEN", "")
HOST_LIST = os.environ.get("HOST_LIST", "/opt/zoner-mail/haraka/config/host_list")
FORWARDER_CONFIG = os.environ.get(
    "FORWARDER_CONFIG", "/opt/zoner-mail/mail-forwarder.json"
)
HANDLERS_DIR = os.environ.get("HANDLERS_DIR", "/opt/zoner-mail/handlers")
DOMAIN_RE = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$", re.I)
HANDLER_RE = re.compile(r"^[A-Za-z0-9._-]+$")

if not TOKEN:
    print("AGENT_TOKEN is required", file=sys.stderr)
    sys.exit(1)

# host_list writes are serialized (ThreadingHTTPServer)
_lock = threading.Lock()


def list_domains():
    try:
        with open(HOST_LIST, encoding="utf-8") as f:
            return sorted({
                line.strip().lower()
                for line in f
                if line.strip() and not line.startswith("#")
            })
    except FileNotFoundError:
        return []


def add_domain(domain):
    with _lock:
        domains = list_domains()
        if domain in domains:
            return False
        with open(HOST_LIST, "a", encoding="utf-8") as f:
            f.write(domain + "\n")
        return True


def remove_domain(domain):
    with _lock:
        domains = list_domains()
        if domain not in domains:
            return False
        remaining = [d for d in domains if d != domain]
        with open(HOST_LIST, "w", encoding="utf-8") as f:
            for d in remaining:
                f.write(d + "\n")
        return True


def list_handlers():
    try:
        return sorted(
            f for f in os.listdir(HANDLERS_DIR)
            if os.path.isfile(os.path.join(HANDLERS_DIR, f))
            and os.access(os.path.join(HANDLERS_DIR, f), os.X_OK)
        )
    except FileNotFoundError:
        return []


def read_forwarder():
    try:
        with open(FORWARDER_CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth_ok(self):
        return self.headers.get("Authorization", "") == f"Bearer {TOKEN}"

    def _domain(self, tail):
        domain = (tail or "").lower().rstrip(".")
        return domain if DOMAIN_RE.match(domain) else None

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
        return body

    def log_message(self, *args):
        pass  # quiet

    # ---------- GET ----------
    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"status": "ok"})
        if not self._auth_ok():
            return self._json(401, {"error": "Unauthorized"})
        if self.path == "/domains":
            return self._json(200, {"domains": list_domains()})
        if self.path == "/handlers":
            return self._json(200, {"handlers": list_handlers()})
        if self.path == "/forwarder":
            cfg = read_forwarder()
            cfg["handlers"] = list_handlers()
            return self._json(200, cfg)
        return self._json(404, {"error": "Not found"})

    # ---------- POST ----------
    def do_POST(self):
        if not self._auth_ok():
            return self._json(401, {"error": "Unauthorized"})
        if self.path != "/domains":
            return self._json(404, {"error": "Not found"})
        try:
            domain = self._domain(self._read_json().get("domain"))
            if not domain:
                return self._json(400, {"error": "Invalid domain name"})
            add_domain(domain)
            return self._json(201, {"message": "Mail domain added"})
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        except Exception:
            return self._json(400, {"error": "Bad request"})

    # ---------- PUT (forwarder config — restricted keys) ----------
    def do_PUT(self):
        if not self._auth_ok():
            return self._json(401, {"error": "Unauthorized"})
        if self.path != "/forwarder":
            return self._json(404, {"error": "Not found"})
        try:
            body = self._read_json()
            # NEVER accept "command" remotely — only a handler from HANDLERS_DIR
            allowed = {"target_url", "auth_token", "worker_name", "headers", "body_format", "handler"}
            config = {k: v for k, v in body.items() if k in allowed}

            if "headers" in config and not isinstance(config["headers"], dict):
                raise ValueError("headers must be an object")
            if "body_format" in config and config["body_format"] not in ("raw", "base64", "json"):
                raise ValueError("body_format must be raw, base64 or json")
            if "handler" in config:
                h = config["handler"]
                if h in (None, ""):
                    config.pop("handler")
                elif not HANDLER_RE.match(h) or h not in list_handlers():
                    raise ValueError(f"Unknown handler: {h}")

            os.makedirs(os.path.dirname(FORWARDER_CONFIG), exist_ok=True)
            with open(FORWARDER_CONFIG, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
            os.chmod(FORWARDER_CONFIG, 0o600)
            cfg = read_forwarder()
            cfg["handlers"] = list_handlers()
            return self._json(200, cfg)
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        except Exception:
            return self._json(400, {"error": "Bad request"})

    # ---------- DELETE ----------
    def do_DELETE(self):
        if not self._auth_ok():
            return self._json(401, {"error": "Unauthorized"})
        prefix = "/domains/"
        if not self.path.startswith(prefix):
            return self._json(404, {"error": "Not found"})
        domain = self._domain(self.path[len(prefix):])
        if not domain:
            return self._json(400, {"error": "Invalid domain name"})
        # idempotent: removing an absent domain is still a success
        # (matches the old mail-domain behavior; the dashboard may drift)
        remove_domain(domain)
        return self._json(200, {"message": "Mail domain removed"})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"zoner mail agent listening on {HOST}:{PORT}", file=sys.stderr)
    server.serve_forever()
