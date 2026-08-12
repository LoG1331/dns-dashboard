#!/usr/bin/env bash
# ============================================================
# test-pdns-podman.sh — E2E test for install-pdns.sh in a disposable
# podman container (Ubuntu 24.04 + systemd).
#
# What it verifies:
#   1. installer runs clean, pdns active via systemd
#   2. systemd-resolved stub listener got disabled (port 53 free)
#   3. pdns bound :53 (udp+tcp), API answers with the API key
#   4. real DNS: zone created via API answers a dig query
#   5. --uninstall removes pdns, restores resolved stub + resolv.conf
#
# Usage:  bash backend/scripts/test-pdns-podman.sh
#         KEEP=1 bash ...   (keep container for debugging)
# ============================================================
set -euo pipefail

IMG="zoner-pdns-test"
NAME="zoner-pdns-test"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_KEY="testkey123"

step() { echo ""; echo "===> $*"; }
fail() { echo ""; echo "TEST FAILED: $*" >&2; exit 1; }

# ---------- build image ----------
step "Building test image $IMG (ubuntu 24.04 + systemd)"
podman build -t "$IMG" -f - <<'EOF' >/dev/null
FROM docker.io/ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
 && apt-get install -y -qq systemd systemd-sysv curl ca-certificates \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
CMD ["/sbin/init"]
EOF

# ---------- run container ----------
podman rm -f "$NAME" >/dev/null 2>&1 || true
step "Starting container (systemd)"
# --privileged: distro pdns.service uses mount-namespace hardening +
# User=pdns, which fails (217/USER) in unprivileged containers that lack
# CAP_SYS_ADMIN. Quirk of testing under podman, not of the script.
podman run -d --name "$NAME" --systemd=always --privileged \
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

step "Pre-check: resolved stub is holding 127.0.0.53:53"
podman exec "$NAME" grep -q '0100007F:0035\|3500007F' /proc/net/udp /proc/net/tcp 2>/dev/null \
  && echo "stub listener present (as expected on stock ubuntu)" \
  || echo "note: no stub listener detected (non-stock image)"

# ---------- install ----------
step "Running install-pdns.sh master"
podman exec -e PEER_IP=10.0.0.12 -e CLIENT_IP=10.0.0.5 -e PDNS_API_KEY="$API_KEY" \
  "$NAME" bash /zoner/backend/scripts/install-pdns.sh master

# ---------- assertions ----------
step "Checking pdns via systemd"
podman exec "$NAME" systemctl is-active --quiet pdns || fail "pdns not active"
echo "pdns active"

step "Checking resolved stub disabled + resolv.conf repointed"
[[ "$(podman exec "$NAME" cat /etc/systemd/resolved.conf.d/zz-zoner-no-stub.conf)" == *"DNSStubListener=no"* ]] \
  || fail "stub drop-in missing"
podman exec "$NAME" bash -c 'readlink -f /etc/resolv.conf | grep -q stub' \
  && fail "resolv.conf still points at the dead stub" || true
echo "stub disabled, resolv.conf repointed"

step "Checking :53 bound (udp+tcp)"
podman exec "$NAME" grep -qs ':0035' /proc/net/udp /proc/net/udp6 || fail "nothing on 53/udp"
podman exec "$NAME" grep -qs ':0035' /proc/net/tcp /proc/net/tcp6 || fail "nothing on 53/tcp"
echo "port 53 bound"

step "API answers with key (bound to private IP, not localhost)"
CT_IP=$(podman exec "$NAME" hostname -I | awk '{print $1}')
podman exec "$NAME" curl -sf -H "X-API-Key: $API_KEY" \
  "http://$CT_IP:8081/api/v1/servers/localhost" >/dev/null || fail "API not answering on $CT_IP"
podman exec "$NAME" curl -sf "http://$CT_IP:8081/api/v1/servers/localhost" >/dev/null 2>&1 \
  && fail "API answered WITHOUT key" || echo "API ok, unauth rejected"
# API must NOT be bound to localhost
podman exec "$NAME" curl -sf -m 2 -H "X-API-Key: $API_KEY" \
  http://127.0.0.1:8081/api/v1/servers/localhost >/dev/null 2>&1 \
  && fail "API unexpectedly reachable on 127.0.0.1" || echo "API not on localhost (as designed)"

step "Real DNS: create zone via API, answer dig"
podman exec "$NAME" curl -sf -X POST -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"example.test.","kind":"Master","nameservers":["ns1.example.test."],
       "rrsets":[{"name":"www.example.test.","type":"A","ttl":60,"changetype":"REPLACE",
                  "records":[{"content":"1.2.3.4","disabled":false}]}]}' \
  "http://$CT_IP:8081/api/v1/servers/localhost/zones" >/dev/null || fail "zone creation failed"
ANSWER=$(podman exec "$NAME" dig +short @127.0.0.1 www.example.test A)
[[ "$ANSWER" == "1.2.3.4" ]] || fail "dig returned '$ANSWER', expected 1.2.3.4"
echo "dig www.example.test -> $ANSWER"

# ---------- uninstall ----------
step "Running --uninstall"
podman exec "$NAME" bash /zoner/backend/scripts/install-pdns.sh --uninstall

step "Residue check"
podman exec "$NAME" bash -c 'command -v pdns_server' >/dev/null 2>&1 && fail "pdns_server still installed"
podman exec "$NAME" bash -c 'ls /etc/powerdns' >/dev/null 2>&1 && fail "/etc/powerdns left behind"
podman exec "$NAME" bash -c 'ls /etc/systemd/resolved.conf.d/zz-zoner-no-stub.conf' >/dev/null 2>&1 \
  && fail "stub drop-in left behind"
podman exec "$NAME" bash -c 'ls -d /var/lib/powerdns' >/dev/null 2>&1 && fail "/var/lib/powerdns left behind"
podman exec "$NAME" bash -c 'ls -d /var/lib/powerdns.bak-zoner' >/dev/null 2>&1 \
  && echo "zone DB backup kept at /var/lib/powerdns.bak-zoner (by design)" || true
podman exec "$NAME" pgrep pdns_server >/dev/null 2>&1 && fail "pdns still running"
echo "no residue"

step "ALL TESTS PASSED"
