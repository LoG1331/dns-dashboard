#!/usr/bin/env python3
# zoner mail agent — tiny HTTP API on the mail server that wraps the
# mail-domain script. The zoner dashboard talks to it remotely.
#
# Env:
#   AGENT_PORT   (default 9099)
#   AGENT_TOKEN  (required — Bearer token)
#   MAIL_CMD     (default /opt/zoner-mail/mail-domain)

import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("AGENT_PORT", "9099"))
TOKEN = os.environ.get("AGENT_TOKEN", "")
MAIL_CMD = os.environ.get("MAIL_CMD", "/opt/zoner-mail/mail-domain")
DOMAIN_RE = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$", re.I)

if not TOKEN:
    print("AGENT_TOKEN is required", file=sys.stderr)
    sys.exit(1)


def run_mail_domain(args):
    # execFile-style: no shell, args passed as a list
    proc = subprocess.run(
        [MAIL_CMD, *args],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "command failed").strip())
    return proc.stdout.strip()


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

    def log_message(self, *args):
        pass  # quiet

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"status": "ok"})
        if not self._auth_ok():
            return self._json(401, {"error": "Unauthorized"})
        if self.path == "/domains":
            try:
                out = run_mail_domain(["list"])
                domains = [d for d in out.split("\n") if d] if out else []
                return self._json(200, {"domains": domains})
            except Exception as e:
                return self._json(500, {"error": str(e)})
        return self._json(404, {"error": "Not found"})

    def do_POST(self):
        if not self._auth_ok():
            return self._json(401, {"error": "Unauthorized"})
        if self.path != "/domains":
            return self._json(404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            domain = self._domain(body.get("domain"))
            if not domain:
                return self._json(400, {"error": "Invalid domain name"})
            run_mail_domain(["add", domain])
            return self._json(201, {"message": "Mail domain added"})
        except RuntimeError as e:
            return self._json(500, {"error": str(e)})
        except Exception:
            return self._json(400, {"error": "Bad request"})

    def do_DELETE(self):
        if not self._auth_ok():
            return self._json(401, {"error": "Unauthorized"})
        prefix = "/domains/"
        if not self.path.startswith(prefix):
            return self._json(404, {"error": "Not found"})
        domain = self._domain(self.path[len(prefix):])
        if not domain:
            return self._json(400, {"error": "Invalid domain name"})
        try:
            run_mail_domain(["remove", domain])
            return self._json(200, {"message": "Mail domain removed"})
        except RuntimeError as e:
            return self._json(500, {"error": str(e)})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"zoner mail agent listening on :{PORT}", file=sys.stderr)
    server.serve_forever()
