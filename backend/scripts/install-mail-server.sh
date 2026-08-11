#!/usr/bin/env bash
# ============================================================
# install-mail-server.sh — bootstrap a complete mail receiver server
# (Postfix catch-all -> webhook) + zoner mail agent, in one command.
#
# Everything custom lives in /opt/zoner-mail/ — easy to remove:
#   sudo bash install-mail-server.sh --uninstall
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
#   PIPE_USER       — user the postfix pipe runs as (default: current sudo user)
# ============================================================
set -euo pipefail

AGENT_PORT="${AGENT_PORT:-9099}"
OPT="/opt/zoner-mail"
SERVICE="zoner-mail-agent"
MARK="# zoner-mail"
MASTER_CF="/etc/postfix/master.cf"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/../../agent" && pwd)"

[[ $EUID -ne 0 ]] && { echo "Run with sudo"; exit 1; }

# ---------- uninstall ----------
if [[ "${1:-}" == "--uninstall" ]]; then
  echo "==> Removing zoner mail stack..."
  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE}.service"
  systemctl daemon-reload 2>/dev/null || true
  # Remove the marked block from master.cf
  if [[ -f "$MASTER_CF" ]]; then
    sed -i "/^${MARK}/,/^webhook.*pipe/{/^webhook.*pipe/{n;d}; d}" "$MASTER_CF" 2>/dev/null || true
    sed -i "/^${MARK}/d" "$MASTER_CF" 2>/dev/null || true
  fi
  postconf -X transport_maps 2>/dev/null || true
  postconf -X webhook_destination_recipient_limit 2>/dev/null || true
  rm -rf "$OPT"
  postfix check 2>/dev/null && systemctl reload postfix 2>/dev/null || true
  echo "Removed. /opt/zoner-mail, the systemd unit and master.cf block are gone."
  exit 0
fi

# ---------- inputs ----------
if [[ -z "${MX_HOSTNAME:-}" ]]; then
  read -rp "MX hostname of this server (e.g. mx.example.com): " MX_HOSTNAME
fi
if [[ -z "${WEBHOOK_URL:-}" ]]; then
  read -rp "Webhook target URL (mail is POSTed there): " WEBHOOK_URL
fi
PIPE_USER="${PIPE_USER:-${SUDO_USER:-ubuntu}}"
AGENT_TOKEN="${AGENT_TOKEN:-$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 32 || true)}"

echo "==> MX hostname: $MX_HOSTNAME | agent port: $AGENT_PORT | pipe user: $PIPE_USER"

# ---------- 1. packages ----------
echo "==> Installing postfix + python3..."
export DEBIAN_FRONTEND=noninteractive
debconf-set-selections <<< "postfix postfix/mailname string $MX_HOSTNAME"
debconf-set-selections <<< "postfix postfix/main_mailer_type string 'Internet Site'"
apt-get update -qq
apt-get install -y -qq postfix python3 curl >/dev/null

# ---------- 2. firewall ----------
iptables -C INPUT -p tcp --dport 25 -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null || \
  iptables -I INPUT 5 -p tcp --dport 25 -m conntrack --ctstate NEW -j ACCEPT
echo "==> TCP/25 opened (iptables). Persist: apt install iptables-persistent && netfilter-persistent save"

# ---------- 3. postfix base config ----------
postconf -e "myhostname = $MX_HOSTNAME"
postconf -e 'mydestination = $myhostname, localhost.localdomain, localhost'
postconf -e 'inet_protocols = ipv4'
postconf -e "transport_maps = hash:$OPT/transport"
postconf -e 'webhook_destination_recipient_limit = 1'

# ---------- 4. /opt/zoner-mail ----------
echo "==> Installing custom files into $OPT..."
mkdir -p "$OPT"
touch "$OPT/transport"
cp "$AGENT_DIR/mail-agent.js" "$OPT/mail-agent.js"
cp "$AGENT_DIR/mail-domain" "$OPT/mail-domain"
cp "$AGENT_DIR/mail-forwarder.py" "$OPT/mail-forwarder"
chmod 755 "$OPT/mail-domain" "$OPT/mail-forwarder"
chmod 644 "$OPT/mail-agent.js"

if [[ ! -f "$OPT/mail-forwarder.json" ]]; then
  cat > "$OPT/mail-forwarder.json" <<EOF
{
  "target_url": "${WEBHOOK_URL}",
  "auth_token": "${WEBHOOK_TOKEN:-}",
  "worker_name": "postfix"
}
EOF
  chmod 600 "$OPT/mail-forwarder.json"
fi

# ---------- 5. webhook pipe in master.cf (idempotent, marked) ----------
if ! grep -q "^${MARK}" "$MASTER_CF"; then
  cat >> "$MASTER_CF" <<EOF
${MARK}
webhook   unix  -       n       n       -       -       pipe
  flags=q user=${PIPE_USER} argv=${OPT}/mail-forwarder \$sender \$recipient
EOF
fi

# ---------- 6. mail agent (systemd, root) ----------
echo "==> Installing $SERVICE..."
cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=zoner mail agent
After=network.target postfix.service

[Service]
ExecStart=$(command -v node) ${OPT}/mail-agent.js
Restart=always
RestartSec=3
Environment=AGENT_PORT=${AGENT_PORT}
Environment=AGENT_TOKEN=${AGENT_TOKEN}
Environment=MAIL_CMD=${OPT}/mail-domain

[Install]
WantedBy=multi-user.target
EOF

# Node is required for the agent
if ! command -v node >/dev/null; then
  echo "==> Installing Node.js 22 (agent runtime)..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

systemctl daemon-reload
systemctl enable --now "$SERVICE"

# ---------- 7. postfix check + restart ----------
postfix check
systemctl restart postfix

echo ""
echo "============================================================"
echo "  Mail server installed!"
echo "============================================================"
echo "  SMTP:        ${MX_HOSTNAME}:25"
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
echo "  Uninstall:   sudo bash install-mail-server.sh --uninstall"
echo "============================================================"
