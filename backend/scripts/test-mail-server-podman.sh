#!/usr/bin/env bash
# ============================================================
# test-mail-server-podman.sh — E2E test for install-mail-server.sh
# in a disposable podman container (Ubuntu 24.04 + systemd).
#
# What it verifies:
#   1. installer runs clean, both systemd units come up
#   2. Haraka runs as the invoking user (SUDO_USER), NOT root
#   3. port 25 bound via AmbientCapabilities (user != root, port < 1024)
#   4. agent API: add domain -> host_list, auth enforced
#   5. real SMTP: mail to accepted domain -> webhook POST received
#                 mail to subdomains (any depth) -> accepted, original
#                 envelope recipient preserved
#                 mail to unknown/lookalike domain -> rejected (550)
#
# Usage:  bash backend/scripts/test-mail-server-podman.sh
#         KEEP=1 bash ...   (keep container for debugging)
# ============================================================
set -euo pipefail

IMG="zoner-mail-test"
NAME="zoner-mail-test"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_AS="ubuntu"   # uid 1000 user that ships with the ubuntu image

step() { echo ""; echo "===> $*"; }
fail() { echo ""; echo "TEST FAILED: $*" >&2; exit 1; }

# ---------- build image ----------
step "Building test image $IMG (ubuntu 24.04 + systemd)"
podman build -t "$IMG" -f - <<'EOF' >/dev/null
FROM docker.io/ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
 && apt-get install -y -qq systemd systemd-sysv python3 curl ca-certificates xz-utils libcap2-bin \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
CMD ["/sbin/init"]
EOF

# ---------- run container ----------
podman rm -f "$NAME" >/dev/null 2>&1 || true
step "Starting container (systemd)"
podman run -d --name "$NAME" --systemd=always \
  -v "$REPO_ROOT:/zoner:ro" \
  "$IMG" >/dev/null

cleanup() {
  if [[ "${KEEP:-0}" == "1" ]]; then
    echo "KEEP=1 — container '$NAME' left running: podman exec -it $NAME bash"
  else
    podman rm -f "$NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

step "Waiting for systemd"
for i in $(seq 1 30); do
  podman exec "$NAME" systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded' && break
  sleep 1
done

# ---------- run installer ----------
step "Running install-mail-server.sh (SUDO_USER=$RUN_AS)"
podman exec -e SUDO_USER="$RUN_AS" \
  -e MX_HOSTNAME=mx.test \
  -e WEBHOOK_URL=http://127.0.0.1:18080/hook \
  -e AGENT_TOKEN=testtoken123 \
  "$NAME" bash /zoner/backend/scripts/install-mail-server.sh

# ---------- assertions ----------
step "Checking systemd units"
podman exec "$NAME" systemctl is-active --quiet zoner-haraka || fail "zoner-haraka not active"
podman exec "$NAME" systemctl is-active --quiet zoner-mail-agent || fail "zoner-mail-agent not active"
echo "both units active"

step "Checking Haraka runs as '$RUN_AS' and bound :25"
HUSER=$(podman exec "$NAME" ps -eo user,comm,args | grep [h]araka | awk '{print $1}' | head -1)
[[ "$HUSER" == "$RUN_AS" ]] || fail "haraka runs as '$HUSER', expected '$RUN_AS'"
podman exec "$NAME" grep -qs ':0019' /proc/net/tcp /proc/net/tcp6 || fail "nothing listening on port 25 (0x19)"
echo "haraka user=$HUSER, port 25 bound"

step "Starting fake webhook receiver on :18080"
# NOTE: python %-formatting has no %b — build the log line with bytes ops
podman exec -d "$NAME" python3 -c '
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        with open("/tmp/webhook.log", "ab") as f:
            f.write(b"POST " + self.path.encode() + b"\n")
            f.write(b"X-Email-Envelope-To: " + (self.headers.get("X-Email-Envelope-To") or "").encode() + b"\n")
            f.write(body + b"\n---\n")
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", 18080), H).serve_forever()
'
# receiver must actually answer before we rely on it
for i in $(seq 1 10); do
  podman exec "$NAME" curl -sf -m 2 -X POST -d ping http://127.0.0.1:18080/hook -o /dev/null 2>&1 && break
  sleep 1
done
podman exec "$NAME" curl -sf -m 2 -X POST -d ping http://127.0.0.1:18080/hook -o /dev/null \
  || fail "fake webhook receiver not answering"

step "Agent API: auth + add domain"
podman exec "$NAME" curl -sf localhost:9099/domains >/dev/null 2>&1 && fail "agent answered without token"
podman exec "$NAME" curl -sf -H "Authorization: Bearer testtoken123" \
  -X POST -H 'Content-Type: application/json' -d '{"domain":"example.com"}' \
  localhost:9099/domains >/dev/null || fail "add domain failed"
podman exec "$NAME" grep -qx 'example.com' /opt/zoner-mail/haraka/config/host_list || fail "host_list missing example.com"
echo "domain added to host_list, unauth request rejected"

step "SMTP: mail to accepted domain + subdomains -> webhook"
podman exec "$NAME" python3 -c '
import smtplib
targets = [
    "user@example.com",           # apex
    "user@abc.example.com",       # one-level subdomain
    "user@foo.bar.example.com",   # deep subdomain
]
for t in targets:
    s = smtplib.SMTP("127.0.0.1", 25, timeout=15)
    s.sendmail("sender@other.org", [t],
               f"Subject: podman e2e\r\n\r\nhello to {t}\r\n")
    s.quit()
'
for i in $(seq 1 10); do
  podman exec "$NAME" grep -q 'user@foo.bar.example.com' /tmp/webhook.log 2>/dev/null && break
  sleep 1
done
for t in 'user@example.com' 'user@abc.example.com' 'user@foo.bar.example.com'; do
  podman exec "$NAME" grep -q "X-Email-Envelope-To: $t" /tmp/webhook.log 2>/dev/null \
    || fail "webhook never received $t with its original envelope recipient"
done
echo "webhook received all three, envelope recipients preserved"

step "SMTP: mail to unknown/lookalike domain -> rejected"
for t in 'user@nope.net' 'user@evilexample.com'; do
  if podman exec "$NAME" python3 -c "
import smtplib
s = smtplib.SMTP('127.0.0.1', 25, timeout=15)
s.sendmail('sender@other.org', ['$t'], 'Subject: x\r\n\r\nx\r\n')
" 2>/dev/null; then
    fail "mail to $t was accepted"
  fi
done
echo "unlisted + lookalike domains rejected"

step "ALL TESTS PASSED"
