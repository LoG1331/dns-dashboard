#!/usr/bin/env bash
# ============================================================
# install-mail-server.sh — bootstrap a complete mail receiver server
# (Haraka catch-all -> webhook) + zoner mail agent, in one command.
#
# Everything custom lives in /opt/zoner-mail/ — easy to remove:
#   sudo bash install-mail-server.sh --uninstall
#
# Everything (Haraka SMTP on :25 included) runs as the invoking user
# ($SUDO_USER) — no root, no sudoers, no dedicated system user.
# Port 25 is bound via systemd AmbientCapabilities=CAP_NET_BIND_SERVICE.
#
# Usage:
#   sudo MX_HOSTNAME=mx.example.com bash install-mail-server.sh
#
# Env (optional):
#   MX_HOSTNAME     — SMTP hostname of this server (required; asked if missing)
#   WEBHOOK_URL     — where mail is POSTed (asked if missing)
#   WEBHOOK_TOKEN   — Bearer token for the webhook (optional)
#   AGENT_TOKEN     — Bearer token for the mail agent (random if missing)
#   AGENT_PORT      — default 9099
#   NODE_VERSION    — e.g. v22.11.0 (default: latest LTS)
#   RUN_USER        — user the services run as (default: $SUDO_USER, fallback: current user)
# ============================================================
set -euo pipefail

AGENT_PORT="${AGENT_PORT:-9099}"
OPT="/opt/zoner-mail"
AGENT_SERVICE="zoner-mail-agent"
HARAKA_SERVICE="zoner-haraka"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/../../agent" && pwd)"

[[ $EUID -ne 0 ]] && { echo "Run with sudo"; exit 1; }

# ---------- uninstall ----------
if [[ "${1:-}" == "--uninstall" ]]; then
  echo "==> Removing zoner mail stack..."
  systemctl disable --now "$AGENT_SERVICE" 2>/dev/null || true
  systemctl disable --now "$HARAKA_SERVICE" 2>/dev/null || true
  rm -f "/etc/systemd/system/${AGENT_SERVICE}.service" \
        "/etc/systemd/system/${HARAKA_SERVICE}.service"
  systemctl daemon-reload 2>/dev/null || true
  rm -rf "$OPT"
  echo "Removed. /opt/zoner-mail and both systemd units are gone."
  echo "Note: firewall rules for TCP/25 (ufw/iptables) were NOT removed."
  echo "      A legacy Postfix-based install is NOT touched by this."
  exit 0
fi

# ---------- inputs ----------
if [[ -z "${MX_HOSTNAME:-}" ]]; then
  read -rp "MX hostname of this server (e.g. mx.example.com): " MX_HOSTNAME
fi
if [[ -z "${WEBHOOK_URL:-}" ]]; then
  read -rp "Webhook target URL (mail is POSTed there): " WEBHOOK_URL
fi
AGENT_TOKEN="${AGENT_TOKEN:-$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 32 || true)}"

# Run everything as the invoking user (sudo) or the current user
RUN_USER="${RUN_USER:-${SUDO_USER:-$(id -un)}}"
RUN_GROUP="$(id -gn "$RUN_USER")"
[[ "$RUN_USER" == "root" ]] && echo "!! RUN_USER=root — the stack will run with full privileges, not recommended"

echo "==> MX hostname: $MX_HOSTNAME | agent port: $AGENT_PORT | run as: $RUN_USER"

# ---------- 1. packages ----------
echo "==> Installing base packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 curl ca-certificates xz-utils libcap2-bin >/dev/null

# ---------- 2. Node.js (self-contained tarball, no apt repo) ----------
case "$(uname -m)" in
  x86_64)  NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) echo "Unsupported arch: $(uname -m)"; exit 1 ;;
esac
if [[ -z "${NODE_VERSION:-}" ]]; then
  echo "==> Resolving latest Node LTS..."
  NODE_VERSION=$(curl -sf -m 15 https://nodejs.org/dist/index.json | \
    python3 -c "import json,sys; print(next(v['version'] for v in json.load(sys.stdin) if v.get('lts')))")
fi
if [[ ! -x "$OPT/node/bin/node" ]]; then
  echo "==> Installing Node $NODE_VERSION ($NODE_ARCH) into $OPT/node..."
  mkdir -p "$OPT"
  curl -sf -m 300 "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/zoner-node.tar.xz
  mkdir -p "$OPT/node"
  tar -xJf /tmp/zoner-node.tar.xz -C "$OPT/node" --strip-components=1
  rm -f /tmp/zoner-node.tar.xz
fi
NODE="$OPT/node/bin/node"

# ---------- 3. Haraka ----------
if [[ ! -d "$OPT/node_modules" ]]; then
  echo "==> Installing Haraka..."
  PATH="$OPT/node/bin:$PATH" "$OPT/node/bin/npm" --prefix "$OPT" install --omit=dev --no-audit --no-fund Haraka >/dev/null
fi
HARAKA_BIN="$OPT/node_modules/.bin/haraka"

echo "==> Writing Haraka config into $OPT/haraka..."
mkdir -p "$OPT/haraka" "$OPT/handlers"
# start from Haraka's shipped default config — a hand-written minimal
# config dir breaks core (connection.ini sections like [message]/[uuid])
cp -r "$OPT/node_modules/Haraka/config" "$OPT/haraka/config"
mkdir -p "$OPT/haraka/plugins"
cp "$AGENT_DIR/haraka/webhook.js" "$OPT/haraka/plugins/webhook.js"
cp "$AGENT_DIR/mail-agent.py" "$OPT/mail-agent.py"
chmod 755 "$OPT/haraka/plugins/webhook.js" "$OPT/mail-agent.py" "$OPT/handlers"

cat > "$OPT/haraka/config/plugins" <<EOF
# accept mail for domains in host_list (rcpt hook) + deliver via webhook
# (queue hook) — both live in the webhook plugin
webhook
EOF
: > "$OPT/haraka/config/host_list"   # managed by the agent; plugin re-reads it per RCPT
echo "$MX_HOSTNAME" > "$OPT/haraka/config/me"
# smtp.ini: default binds [::] (dual-stack); pin IPv4-only like the old postfix stack
echo 'listen=0.0.0.0:25' >> "$OPT/haraka/config/smtp.ini"

if [[ ! -f "$OPT/mail-forwarder.json" ]]; then
  cat > "$OPT/mail-forwarder.json" <<EOF
{
  "target_url": "${WEBHOOK_URL}",
  "auth_token": "${WEBHOOK_TOKEN:-}",
  "worker_name": "haraka",
  "body_format": "raw"
}
EOF
fi
chmod 600 "$OPT/mail-forwarder.json"

# Everything under $OPT belongs to the run user — SAFE because nothing in
# this stack ever runs as root (no sudo, no setuid, no pipe as root).
chown -R "${RUN_USER}:${RUN_GROUP}" "$OPT"

# ---------- 4. firewall (UFW and/or iptables, whichever exists) ----------
if command -v ufw >/dev/null 2>&1; then
  ufw allow 25/tcp >/dev/null 2>&1 || true
  echo "==> UFW: TCP/25 opened"
fi
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport 25 -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 5 -p tcp --dport 25 -m conntrack --ctstate NEW -j ACCEPT || true
  echo "==> iptables: TCP/25 opened. Persist: apt install iptables-persistent && netfilter-persistent save"
fi
if ! command -v ufw >/dev/null 2>&1 && ! command -v iptables >/dev/null 2>&1; then
  echo "==> No ufw/iptables (container?) — remember to open TCP/25 at the cloud firewall"
fi

# ---------- 5. systemd units ----------
# /run/systemd/system exists iff systemd is PID 1 (sd_booted) — unlike
# `is-system-running`, this is also true in "degraded" state (containers).
if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
  echo "==> Installing $HARAKA_SERVICE + $AGENT_SERVICE (systemd)..."

  # NOTE: no NoNewPrivileges here — the kernel clears ambient capabilities
  # on exec when no_new_privs is set, which would take port 25 away again.
  cat > "/etc/systemd/system/${HARAKA_SERVICE}.service" <<EOF
[Unit]
Description=zoner Haraka SMTP receiver
After=network.target

[Service]
User=${RUN_USER}
Group=${RUN_GROUP}
ExecStart=${NODE} ${HARAKA_BIN} -c ${OPT}/haraka
Environment=FORWARDER_CONFIG=${OPT}/mail-forwarder.json
Environment=HANDLERS_DIR=${OPT}/handlers
Environment=HOST_LIST=${OPT}/haraka/config/host_list
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
ProtectSystem=strict
ReadWritePaths=${OPT}
PrivateTmp=true
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  cat > "/etc/systemd/system/${AGENT_SERVICE}.service" <<EOF
[Unit]
Description=zoner mail agent
After=network.target ${HARAKA_SERVICE}.service

[Service]
User=${RUN_USER}
Group=${RUN_GROUP}
ExecStart=$(command -v python3) ${OPT}/mail-agent.py
Environment=AGENT_HOST=${AGENT_HOST:-0.0.0.0}
Environment=AGENT_PORT=${AGENT_PORT}
Environment=AGENT_TOKEN=${AGENT_TOKEN}
Environment=HOST_LIST=${OPT}/haraka/config/host_list
Environment=FORWARDER_CONFIG=${OPT}/mail-forwarder.json
Environment=HANDLERS_DIR=${OPT}/handlers
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${OPT}
PrivateTmp=true
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "$HARAKA_SERVICE"
  systemctl enable --now "$AGENT_SERVICE"
  # re-running the installer is the upgrade path: code was re-copied above,
  # enable --now alone would leave the old process running
  systemctl restart "$HARAKA_SERVICE" "$AGENT_SERVICE"
else
  echo "==> No systemd — starting via nohup (setcap fallback for port 25)"
  setcap 'cap_net_bind_service=+ep' "$NODE"
  pkill -f 'haraka.*-c' 2>/dev/null || true
  pkill -f mail-agent.py 2>/dev/null || true
  setsid su -s /bin/bash "$RUN_USER" -c "FORWARDER_CONFIG=${OPT}/mail-forwarder.json HANDLERS_DIR=${OPT}/handlers HOST_LIST=${OPT}/haraka/config/host_list ${NODE} ${HARAKA_BIN} -c ${OPT}/haraka" >"$OPT/haraka.log" 2>&1 &
  setsid su -s /bin/bash "$RUN_USER" -c "AGENT_HOST=${AGENT_HOST:-0.0.0.0} AGENT_PORT=${AGENT_PORT} AGENT_TOKEN='${AGENT_TOKEN}' HOST_LIST=${OPT}/haraka/config/host_list FORWARDER_CONFIG=${OPT}/mail-forwarder.json HANDLERS_DIR=${OPT}/handlers python3 ${OPT}/mail-agent.py" >"$OPT/agent.log" 2>&1 &
fi

# ---------- 6. smoke check ----------
sleep 2
for i in $(seq 1 10); do
  curl -sf "http://127.0.0.1:${AGENT_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:${AGENT_PORT}/health" >/dev/null 2>&1 \
  && echo "==> Agent health: OK" \
  || echo "!! Agent not answering on ${AGENT_PORT} — check: journalctl -u ${AGENT_SERVICE}"

echo ""
echo "============================================================"
echo "  Mail server installed! (Haraka, rootless)"
echo "============================================================"
echo "  SMTP:        ${MX_HOSTNAME}:25  (Haraka, user '${RUN_USER}')"
echo "  Mail agent:  http://$(hostname -I | awk '{print $1}'):${AGENT_PORT}"
echo "  Agent token: ${AGENT_TOKEN}   <-- SAVE IT, shown once"
echo ""
echo "  In zoner Settings -> Mail section, set:"
echo "    Agent URL:    http://$(hostname -I | awk '{print $1}'):${AGENT_PORT}"
echo "    Agent token:  ${AGENT_TOKEN}"
echo "    MX Hostname:  ${MX_HOSTNAME}"
echo ""
echo "  DNS needed:  A record ${MX_HOSTNAME} -> this server's public IP"
echo "               (Cloudflare: DNS only, no proxy)"
echo ""
echo "  Recommended: firewall the agent port to the zoner backend only:"
echo "    ufw allow from <zoner-ip> to any port ${AGENT_PORT}"
echo ""
echo "  Uninstall:   sudo bash install-mail-server.sh --uninstall"
echo "============================================================"
