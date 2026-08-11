#!/usr/bin/env bash
# ============================================================
# DNS Dashboard — one-command bootstrap, ROOTLESS (no sudo needed)
# ONLY installs the dashboard (backend + frontend). PowerDNS is
# installed separately via backend/scripts/install-pdns.sh on
# the nameservers.
#
#   curl -fsSL <URL-of-this-script> | bash
#
# Environment variables (optional):
#   REPO_URL=...      — release tarball URL (.tar.gz) or local file path
#   INSTALL_DIR=~/.local/share/dns-dashboard
#
# The script automatically: installs Node 22 into ~/.local IF node >= 22
# is not already present, downloads the release, builds the frontend,
# seeds .env (random secrets, printed at the end), and runs via a
# systemd user service (if available) or nohup.
#
# PowerDNS connection (API URL, key, nameservers, secondaries) is
# configured later from the Settings page — stored in the DB, not env.
# ============================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/share/dns-dashboard}"
REPO_URL="${REPO_URL:-https://github.com/CHANGE_ME/dns-dashboard/archive/refs/heads/main.tar.gz}"
BACKEND_PORT=5001
NODE_MAJOR=22

gen_secret() { LC_ALL=C tr -dc "$1" </dev/urandom 2>/dev/null | head -c "$2" || true; }

echo "==> [1/5] Checking Node.js..."
if command -v node >/dev/null 2>&1 && [[ $(node -v | cut -d. -f1 | tr -d v) -ge $NODE_MAJOR ]]; then
  echo "    Found $(node -v) — skipping install"
else
  echo "    No node >= $NODE_MAJOR — downloading official build to ~/.local (no root needed)"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  NODE_ARCH="linux-x64" ;;
    aarch64) NODE_ARCH="linux-arm64" ;;
    *) echo "Architecture $ARCH not supported"; exit 1 ;;
  esac
  mkdir -p "$HOME/.local"
  NODE_VER=$(curl -fsSL "https://nodejs.org/dist/index.json" | grep -o "\"version\":\"v${NODE_MAJOR}[^\"]*\"" | head -1 | cut -d'"' -f4)
  curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-${NODE_ARCH}.tar.xz" \
    | tar -xJ -C "$HOME/.local" --strip-components=1
  export PATH="$HOME/.local/bin:$PATH"
  echo "    Installed $(node -v) into ~/.local"
  echo "    (add to your shell rc for long-term use: export PATH=\"\$HOME/.local/bin:\$PATH\")"
fi

echo "==> [2/5] Downloading release into $INSTALL_DIR..."
TMP_EXTRACT=$(mktemp -d)
if [[ -f "$REPO_URL" ]]; then
  tar -xzf "$REPO_URL" -C "$TMP_EXTRACT"
else
  curl -fsSL "$REPO_URL" | tar -xz -C "$TMP_EXTRACT"
fi
# GitHub tarballs have a single root dir (repo-branch/) — strip it; flat tarballs are used as-is
shopt -s dotglob nullglob
if [[ $(ls -A "$TMP_EXTRACT" | wc -l) -eq 1 && -d "$TMP_EXTRACT/$(ls -A "$TMP_EXTRACT")" ]]; then
  mv "$TMP_EXTRACT/$(ls -A "$TMP_EXTRACT")" "$INSTALL_DIR.tmp"
else
  mv "$TMP_EXTRACT" "$INSTALL_DIR.tmp"
fi
mkdir -p "$INSTALL_DIR"
mv "$INSTALL_DIR.tmp"/* "$INSTALL_DIR/" 2>/dev/null || true
rm -rf "$INSTALL_DIR.tmp" "$TMP_EXTRACT"

echo "==> [3/5] Preparing frontend + backend..."
cd "$INSTALL_DIR/frontend"
# production: frontend calls the API on the same origin
echo "VITE_API_URL=/api" > .env
echo "VITE_ENABLE_TURNSTILE=false" >> .env
if [[ -d dist ]]; then
  echo "    frontend/dist already built in the release — skipping build"
else
  npm ci >/dev/null
  npm run build >/dev/null
fi

cd "$INSTALL_DIR/backend"
npm ci --omit=dev >/dev/null

echo "==> [4/5] Seeding .env (random secrets)..."
JWT_SECRET=$(gen_secret 'A-Za-z0-9' 48)
ADMIN_PASS="Adm!n-$(gen_secret 'A-Za-z0-9!@#%' 16)"

cat > .env <<EOF
PORT=${BACKEND_PORT}
HOST=${HOST:-0.0.0.0}
SERVE_FRONTEND=true
JWT_SECRET=${JWT_SECRET}
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=${ADMIN_PASS}
EOF

echo "==> [5/5] Registering service..."
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-system-running >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/dns-dashboard.service" <<EOF
[Unit]
Description=DNS Dashboard (backend + frontend)
After=network.target

[Service]
WorkingDirectory=${INSTALL_DIR}/backend
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now dns-dashboard
  echo "    systemd user service is running"
  SYSTEMD_USER=1
else
  echo "    No systemd user — running via nohup"
  cd "$INSTALL_DIR/backend"
  pkill -f "node src/index.js" 2>/dev/null || true
  setsid nohup node src/index.js >"$HOME/.local/share/dns-dashboard.log" 2>&1 &
fi

echo ""
echo "============================================================"
echo "  DNS Dashboard installed! (rootless)"
echo "============================================================"
echo "  Web UI:      http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1):${BACKEND_PORT}"
echo "  Admin email: admin@example.com"
echo "  Admin pass:  ${ADMIN_PASS}   <-- SAVE IT NOW, shown only once"
echo ""
echo "  Configure the PowerDNS connection (API URL, API key, nameservers,"
echo "  zone kind, secondary servers) from the Settings page after login."
echo "  It is stored in the DB — not read from env."
if [[ "${SYSTEMD_USER:-0}" == "1" ]]; then
  echo ""
  echo "  To keep the service running even after logout, run:"
  echo "    loginctl enable-linger $USER"
fi
echo "============================================================"
