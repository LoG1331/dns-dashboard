#!/usr/bin/env bash
# ============================================================
# Local test: spin up 2 podman containers (ubuntu:24.04) and run
# scripts/install-pdns.sh INSIDE each container — exactly the same
# way you would deploy to 2 real VPSes.
#
# Run:    bash scripts/setup-pdns.sh
# Cleanup: bash scripts/setup-pdns.sh --clean
# ============================================================
set -euo pipefail

API_KEY="${PDNS_E2E_KEY:-e2e-secret-key}"
IMAGE="docker.io/library/ubuntu:24.04"
NETWORK="dnsnet"
BASE_DOMAIN_NS1="ns1.dnstest.local"
BASE_DOMAIN_NS2="ns2.dnstest.local"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" == "--clean" ]]; then
  podman rm -f ns1 ns2 2>/dev/null || true
  podman network rm "$NETWORK" 2>/dev/null || true
  echo "Removed ns1, ns2 and network $NETWORK"
  exit 0
fi

# ---------- 1. Network ----------
podman network exists "$NETWORK" || podman network create "$NETWORK"

# ---------- 2. Containers ----------
run_container () {
  local name="$1" dns_udp="$2" api_port="$3"
  podman rm -f "$name" 2>/dev/null || true
  podman run -d --name "$name" --network "$NETWORK" \
    -p "127.0.0.1:${dns_udp}:53/udp" -p "127.0.0.1:${dns_udp}:53/tcp" \
    -p "127.0.0.1:${api_port}:8081" \
    "$IMAGE" sleep infinity
}

echo "==> Creating container ns1 (DNS :5353, API :8081)"
run_container ns1 5353 8081
echo "==> Creating container ns2 (DNS :5454, API :8082)"
run_container ns2 5454 8082

NS1_IP=$(podman inspect -f '{{.NetworkSettings.Networks.dnsnet.IPAddress}}' ns1)
NS2_IP=$(podman inspect -f '{{.NetworkSettings.Networks.dnsnet.IPAddress}}' ns2)
echo "ns1 IP: $NS1_IP — ns2 IP: $NS2_IP"

# ---------- 3. Copy script inside + run like a real server ----------
podman cp "$SCRIPT_DIR/install-pdns.sh" ns1:/root/install-pdns.sh
podman cp "$SCRIPT_DIR/install-pdns.sh" ns2:/root/install-pdns.sh

echo "==> Installing pdns in both containers (takes a few minutes)..."
podman exec -e PDNS_API_KEY="$API_KEY" -e PEER_IP="$NS2_IP" ns1 bash /root/install-pdns.sh master &
podman exec -e PDNS_API_KEY="$API_KEY" -e PEER_IP="$NS1_IP" ns2 bash /root/install-pdns.sh slave &
wait

# ---------- 4. Seed PowerDNS config into the backend DB (settings table) ----------
# Config lives in the DB (Settings page), not env — write it directly.
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Seeding backend config (backend/data.sqlite)"
( cd "$BACKEND_DIR" && node --input-type=module -e "
import { updateConfig } from './src/config.js';
updateConfig({
  pdnsApiUrl: 'http://127.0.0.1:8081',
  pdnsApiKey: '$API_KEY',
  zoneKind: 'Master',
  nameservers: JSON.stringify(['$BASE_DOMAIN_NS1']),
  secondaries: JSON.stringify([{ name: 'ns2', apiUrl: 'http://127.0.0.1:8082', apiKey: '$API_KEY', ns: '$BASE_DOMAIN_NS2' }]),
  masterAddress: '$NS1_IP',
});
console.log('config seeded');
" )

echo ""
echo "============================================================"
echo "Done! Two PowerDNS servers are running:"
echo "  ns1 (master): DNS 127.0.0.1:5353, API http://127.0.0.1:8081 (LAN IP: $NS1_IP)"
echo "  ns2 (slave):  DNS 127.0.0.1:5454, API http://127.0.0.1:8082 (LAN IP: $NS2_IP)"
echo "  API key:      ${API_KEY}"
echo "Backend config is seeded into the DB (including secondary auto-provisioning)."
echo "The running backend picks it up immediately — no restart needed."
echo "============================================================"
