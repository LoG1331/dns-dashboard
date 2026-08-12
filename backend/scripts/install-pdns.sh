#!/usr/bin/env bash
# ============================================================
# Install PowerDNS authoritative server ON a real Ubuntu machine (VPS)
# Run directly on that server, with root/sudo privileges.
#
#   # On the master machine (ns1):
#   sudo bash install-pdns.sh master
#
#   # On the slave machine (ns2):
#   sudo bash install-pdns.sh slave
#
# Environment variables (optional):
#   PDNS_API_KEY   — API key (default: auto-generated randomly and PRINTED)
#   PEER_IP        — private IP of the other machine (default: asked at runtime)
#   CLIENT_IP      — private IP of the backend/dashboard machine (default: asked at runtime)
#   PDNS_API_PORT  — API/webserver port (default 8081)
#
# Full example:
#   sudo PEER_IP=10.0.0.12 CLIENT_IP=10.0.0.5 PDNS_API_KEY=supersecret bash install-pdns.sh master
# ============================================================
set -euo pipefail

ROLE="${1:-}"
API_PORT="${PDNS_API_PORT:-8081}"

[[ "$ROLE" != "--uninstall" ]] && [[ $EUID -ne 0 ]] && { echo "Must run as root (sudo)"; exit 1; }

# ---------- uninstall ----------
if [[ "$ROLE" == "--uninstall" ]]; then
  echo "==> Removing PowerDNS..."
  systemctl disable --now pdns 2>/dev/null || pkill pdns_server 2>/dev/null || true
  apt-get purge -y -qq pdns-server pdns-backend-sqlite3 2>/dev/null || true
  rm -rf /etc/powerdns
  # Zone data: recreated from the zoner dashboard via API, so it is removed
  # here for a clean uninstall. Last copy kept at /var/lib/powerdns.bak-zoner.
  if [[ -d /var/lib/powerdns ]]; then
    rm -rf /var/lib/powerdns.bak-zoner
    mv /var/lib/powerdns /var/lib/powerdns.bak-zoner
    echo "    zone DB moved to /var/lib/powerdns.bak-zoner (delete it when sure)"
  fi
  # Undo the systemd-resolved stub change (only if we made it)
  if [[ -f /etc/systemd/resolved.conf.d/zz-zoner-no-stub.conf ]]; then
    rm -f /etc/systemd/resolved.conf.d/zz-zoner-no-stub.conf
    if [[ -e /etc/resolv.conf.bak-zoner ]]; then
      cp -a /etc/resolv.conf.bak-zoner /etc/resolv.conf
      rm -f /etc/resolv.conf.bak-zoner
      echo "    resolv.conf restored from backup"
    fi
    systemctl restart systemd-resolved 2>/dev/null || true
    echo "    systemd-resolved stub listener re-enabled"
  fi
  echo "Removed. Firewall rules (53 + API port) were NOT removed:"
  echo "  ufw: ufw delete allow 53/udp; ufw delete allow 53/tcp; ufw status numbered"
  echo "  sqlite3/dnsutils/curl left installed (shared packages)."
  exit 0
fi

if [[ "$ROLE" != "master" && "$ROLE" != "slave" ]]; then
  echo "Usage: sudo bash install-pdns.sh [master|slave|--uninstall]"
  echo "  PEER_IP=<private IP of the other machine> CLIENT_IP=<private IP of the backend> PDNS_API_KEY=<key> bash install-pdns.sh master|slave"
  exit 1
fi

# ---------- 0. Input ----------
if [[ -z "${PEER_IP:-}" ]]; then
  read -rp "Private IP of the $([ "$ROLE" = master ] && echo slave || echo master) machine (peer): " PEER_IP
fi

if [[ -z "${CLIENT_IP:-}" ]]; then
  read -rp "Private IP of the backend/dashboard machine (API client): " CLIENT_IP
fi

if [[ -z "${PDNS_API_KEY:-}" ]]; then
  PDNS_API_KEY=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 32 || true)
  GENERATED_KEY=1
fi

MY_IP=$(hostname -I | awk '{print $1}')
# Public IP (Oracle/AWS style: VM only sees private IP, public IP held by NAT)
PUBLIC_IP=$(curl -sf -m 5 https://ifconfig.me 2>/dev/null || curl -sf -m 5 https://api.ipify.org 2>/dev/null || echo "")
if [[ -n "$PUBLIC_IP" && "$PUBLIC_IP" != "$MY_IP" ]]; then
  echo "==> Role: $ROLE | private IP: $MY_IP | public IP: $PUBLIC_IP (NAT) | peer: $PEER_IP | client: $CLIENT_IP"
else
  echo "==> Role: $ROLE | this machine's IP: $MY_IP | peer: $PEER_IP | client: $CLIENT_IP"
fi

# ---------- 1. Install ----------
echo "==> Installing PowerDNS..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq pdns-server pdns-backend-sqlite3 sqlite3 dnsutils curl >/dev/null

# ---------- 2. Config ----------
echo "==> Writing /etc/powerdns/pdns.conf"
mkdir -p /var/lib/powerdns

# NOTE: pdns 4.8 (Ubuntu 24.04) accepts exactly ONE webserver-address —
# no comma list. Bind the private IP; MY_IP is in allow-from so the
# health check below can curl the API from this machine itself.
COMMON=$(cat <<EOF
launch=gsqlite3
gsqlite3-database=/var/lib/powerdns/pdns.sqlite3
api=yes
api-key=${PDNS_API_KEY}
webserver=yes
webserver-address=${MY_IP}
webserver-port=${API_PORT}
webserver-allow-from=127.0.0.0/8,${MY_IP},${PEER_IP},${CLIENT_IP}
local-address=0.0.0.0
EOF
)

if [[ "$ROLE" == "master" ]]; then
  cat > /etc/powerdns/pdns.conf <<EOF
${COMMON}
# master: send NOTIFY + allow AXFR to slave
primary=yes
allow-axfr-ips=${PEER_IP}
also-notify=${PEER_IP}
EOF
else
  cat > /etc/powerdns/pdns.conf <<EOF
${COMMON}
# slave: receive zones from master (slave zones are created by the backend via API)
secondary=yes
autosecondary=yes
allow-notify-from=${PEER_IP}
allow-axfr-ips=
EOF
fi

# ---------- 3. DB ----------
if [[ ! -f /var/lib/powerdns/pdns.sqlite3 ]]; then
  echo "==> Initializing sqlite schema"
  sqlite3 /var/lib/powerdns/pdns.sqlite3 < /usr/share/pdns-backend-sqlite3/schema/schema.sqlite3.sql
fi
chown -R pdns:pdns /var/lib/powerdns

# ---------- 3.5. Free port 53 (systemd-resolved stub listener) ----------
# Stock Ubuntu: systemd-resolved holds 127.0.0.53:53, which blocks pdns from
# binding 0.0.0.0:53. Disable the stub and point resolv.conf at real upstreams.
STUB_CONF=/etc/systemd/resolved.conf.d/zz-zoner-no-stub.conf
if command -v systemctl >/dev/null && systemctl is-active --quiet systemd-resolved 2>/dev/null; then
  if [[ ! -f "$STUB_CONF" ]]; then
    echo "==> Disabling systemd-resolved stub listener (DNSStubListener=no) to free port 53"
    mkdir -p /etc/systemd/resolved.conf.d
    printf '[Resolve]\nDNSStubListener=no\n' > "$STUB_CONF"
    # resolv.conf must no longer point at the now-dead stub (127.0.0.53)
    if [[ -e /run/systemd/resolve/resolv.conf ]] && \
       { [[ "$(readlink -f /etc/resolv.conf 2>/dev/null || true)" == "/run/systemd/resolve/stub-resolv.conf" ]] \
         || grep -q '127\.0\.0\.53' /etc/resolv.conf 2>/dev/null; }; then
      cp -a /etc/resolv.conf /etc/resolv.conf.bak-zoner 2>/dev/null || true
      ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
    fi
    systemctl restart systemd-resolved
    echo "    resolv.conf now uses real upstreams (backup: /etc/resolv.conf.bak-zoner)"
  fi
fi

# ---------- 4. Run (systemd if available, fallback to direct run) ----------
# /run/systemd/system exists iff systemd is PID 1 — unlike `is-system-running`,
# this is also true in "degraded" state (containers, a failed unit, ...).
if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
  systemctl enable pdns >/dev/null 2>&1 || true
  systemctl restart pdns
  echo "==> pdns started via systemd (systemctl status pdns)"
else
  echo "==> No systemd — running pdns_server directly (nohup)"
  pkill pdns_server 2>/dev/null || true
  sleep 1
  nohup pdns_server --daemon=no >/var/log/pdns.log 2>&1 &
fi

# ---------- 5. Firewall (UFW and/or iptables, whichever exists) ----------
if command -v ufw >/dev/null 2>&1; then
  ufw allow 53/udp >/dev/null 2>&1 || true
  ufw allow 53/tcp >/dev/null 2>&1 || true
  ufw allow from "$PEER_IP" to any port "$API_PORT" >/dev/null 2>&1 || true
  ufw allow from "$CLIENT_IP" to any port "$API_PORT" >/dev/null 2>&1 || true
  echo "==> UFW: opened 53/udp+tcp, API ${API_PORT} allowed only from peer ${PEER_IP} and client ${CLIENT_IP}"
fi
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p udp --dport 53 -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 5 -p udp --dport 53 -m conntrack --ctstate NEW -j ACCEPT || true
  iptables -C INPUT -p tcp --dport 53 -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 5 -p tcp --dport 53 -m conntrack --ctstate NEW -j ACCEPT || true
  for SRC in "$PEER_IP" "$CLIENT_IP"; do
    iptables -C INPUT -p tcp --dport "$API_PORT" -s "$SRC" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null || \
      iptables -I INPUT 5 -p tcp --dport "$API_PORT" -s "$SRC" -m conntrack --ctstate NEW -j ACCEPT || true
  done
  echo "==> iptables: opened 53/udp+tcp, API ${API_PORT} allowed only from peer ${PEER_IP} and client ${CLIENT_IP}"
  echo "    Persist: apt install iptables-persistent && netfilter-persistent save"
fi
if ! command -v ufw >/dev/null 2>&1 && ! command -v iptables >/dev/null 2>&1; then
  echo "==> No ufw/iptables (container?) — remember to open 53/udp+tcp at the cloud firewall"
fi

# ---------- 6. Wait for API ----------
for i in $(seq 1 20); do
  curl -sf -H "X-API-Key: ${PDNS_API_KEY}" "http://${MY_IP}:${API_PORT}/api/v1/servers/localhost" >/dev/null 2>&1 && break
  sleep 2
done

echo ""
echo "============================================================"
echo "PowerDNS ($ROLE) is up and running!"
echo "  DNS: ${MY_IP}:53 (udp+tcp)"
echo "  API: http://${MY_IP}:${API_PORT}"
echo "  API key: ${PDNS_API_KEY}"
[[ "${GENERATED_KEY:-0}" == "1" ]] && echo "  ^^ AUTO-GENERATED KEY — save it now!"
echo ""
if [[ -n "$PUBLIC_IP" && "$PUBLIC_IP" != "$MY_IP" ]]; then
  echo "⚠ NAT detected (public IP differs from private IP):"
  echo "  - Replication uses PRIVATE IPs (${MY_IP} <-> ${PEER_IP}) — correct setup"
  echo "  - Glue records at the domain registrar must point to the PUBLIC IP: ${PUBLIC_IP}"
  echo "  - Open Security List/NSG: UDP+TCP 53 ingress for 0.0.0.0/0"
fi
if [[ "$ROLE" == "master" ]]; then
  echo "Then open the dashboard Settings page and fill in:"
  echo "  PowerDNS API URL:  http://${MY_IP}:${API_PORT}"
  echo "  API Key:           ${PDNS_API_KEY}"
  echo "  Zone Kind:         Master"
  echo "  Master Address:    ${MY_IP}"
  echo "  Secondary Servers: ns2, http://${PEER_IP}:${API_PORT}, ${PDNS_API_KEY}"
  echo "  NS1/NS2:           public hostnames of the 2 nameservers"
fi
echo "============================================================"
